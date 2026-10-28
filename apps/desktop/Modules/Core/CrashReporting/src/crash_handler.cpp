#include "aedst/crash/crash_handler.hpp"

#include <fmt/format.h>

#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <string>
#include <string_view>
#include <system_error>

#if defined(_WIN32)
#include <cwchar>

#include <windows.h>
// dbghelp.h must come after windows.h.
#include <dbghelp.h>
#else
#include <fcntl.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#if defined(__has_include)
#if __has_include(<execinfo.h>)
#include <execinfo.h>
#define AEDST_CRASH_HAS_EXECINFO 1
#endif
#endif
#endif

namespace aedst::crash {
namespace {

using Seconds = std::chrono::seconds;

// Howard Hinnant's civil_from_days: days since 1970-01-01 -> (year, month, day).
struct CivilDate {
    std::int64_t year;
    unsigned month;
    unsigned day;
};

CivilDate civilFromDays(std::int64_t daysSinceEpoch) {
    const std::int64_t z = daysSinceEpoch + 719468;
    const std::int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const auto dayOfEra = static_cast<unsigned>(z - era * 146097);
    const unsigned yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146096) / 365;
    const std::int64_t y = static_cast<std::int64_t>(yearOfEra) + era * 400;
    const unsigned dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100);
    const unsigned mp = (5 * dayOfYear + 2) / 153;
    const unsigned day = dayOfYear - (153 * mp + 2) / 5 + 1;
    const unsigned month = mp < 10 ? mp + 3 : mp - 9;
    return CivilDate{month <= 2 ? y + 1 : y, month, day};
}

#if !defined(_WIN32)
/// Restricts the embedded version to a safe alphabet; the POSIX handler writes
/// it verbatim.
std::string sanitizeVersion(std::string_view version, std::size_t maxLength) {
    std::string out;
    for (const char c : version) {
        const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' ||
                        c == '_' || c == '+' || c == '-';
        if (ok && out.size() < maxLength) {
            out.push_back(c);
        }
    }
    return out;
}
#endif

// All state the fatal-signal path touches lives in this one object: a handler
// cannot take parameters, and it must not allocate or lock.
// NOLINTNEXTLINE(cppcoreguidelines-avoid-non-const-global-variables)
struct GlobalState {
    std::atomic<bool> installed{false};
    std::atomic_flag handling;
    std::filesystem::path crashesDirectory;
    std::filesystem::path preopenedReport;
#if defined(_WIN32)
    LPTOP_LEVEL_EXCEPTION_FILTER previousFilter{nullptr};
    std::array<wchar_t, 520> directory{};
#else
    static constexpr std::size_t kAltStackBytes = 64U * 1024U;
    static constexpr std::size_t kVersionCapacity = 64;
    int fd{-1};
    std::array<char, kVersionCapacity> version{};
    std::size_t versionLength{0};
    alignas(16) std::array<char, kAltStackBytes> altStack{};
#endif
};

GlobalState& state() {
    // Constructed on first use from install(), i.e. before any crash can be handled.
    static GlobalState instance;
    return instance;
}

#if defined(_WIN32)

LONG WINAPI unhandledExceptionFilter(EXCEPTION_POINTERS* exceptionInfo) {
    GlobalState& s = state();
    if (!s.handling.test_and_set()) {
        SYSTEMTIME t{};
        GetSystemTime(&t);
        std::array<wchar_t, 64> name{};
        swprintf_s(name.data(), name.size(), L"\\crash-%04u%02u%02uT%02u%02u%02uZ-%lu.dmp",
                   static_cast<unsigned>(t.wYear), static_cast<unsigned>(t.wMonth), static_cast<unsigned>(t.wDay),
                   static_cast<unsigned>(t.wHour), static_cast<unsigned>(t.wMinute), static_cast<unsigned>(t.wSecond),
                   static_cast<unsigned long>(GetCurrentProcessId()));
        std::array<wchar_t, 600> path{};
        wcscpy_s(path.data(), path.size(), s.directory.data());
        wcscat_s(path.data(), path.size(), name.data());
        const HANDLE file =
            CreateFileW(path.data(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file != INVALID_HANDLE_VALUE) {
            MINIDUMP_EXCEPTION_INFORMATION mei{};
            mei.ThreadId = GetCurrentThreadId();
            mei.ExceptionPointers = exceptionInfo;
            mei.ClientPointers = FALSE;
            // MiniDumpNormal: thread stacks + module list, no heap.
            MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), file, MiniDumpNormal, &mei, nullptr, nullptr);
            CloseHandle(file);
        }
    }
    return EXCEPTION_EXECUTE_HANDLER;
}

#else

constexpr std::array<int, 5> kFatalSignals{SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL};
// ---- async-signal-safe helpers: no allocation, no stdio, no locks ----------

void writeAll(int fd, const char* data, std::size_t length) {
    while (length > 0) {
        const ssize_t written = ::write(fd, data, length);
        if (written < 0) {
            if (errno == EINTR) {
                continue;
            }
            return;
        }
        data += written;
        length -= static_cast<std::size_t>(written);
    }
}

void writeText(int fd, const char* text) {
    writeAll(fd, text, std::strlen(text));
}

void writeUnsigned(int fd, unsigned long long value) {
    std::array<char, 24> buffer{};
    std::size_t pos = buffer.size();
    do {
        --pos;
        buffer[pos] = static_cast<char>('0' + value % 10U);
        value /= 10U;
    } while (value != 0 && pos > 0);
    writeAll(fd, buffer.data() + pos, buffer.size() - pos);
}

const char* signalName(int signalNumber) {
    switch (signalNumber) {
    case SIGSEGV:
        return "SIGSEGV";
    case SIGABRT:
        return "SIGABRT";
    case SIGBUS:
        return "SIGBUS";
    case SIGFPE:
        return "SIGFPE";
    case SIGILL:
        return "SIGILL";
    default:
        return "UNKNOWN";
    }
}

void handleFatalSignal(int signalNumber) {
    GlobalState& s = state();
    if (!s.handling.test_and_set() && s.fd >= 0) {
        const int fd = s.fd;
        writeText(fd, "AEDST crash report\nversion: ");
        writeAll(fd, s.version.data(), s.versionLength);
        writeText(fd, "\nsignal: ");
        writeUnsigned(fd, static_cast<unsigned long long>(signalNumber));
        writeText(fd, " (");
        writeText(fd, signalName(signalNumber));
        writeText(fd, ")\ntime_utc_epoch: ");
        writeUnsigned(fd, static_cast<unsigned long long>(::time(nullptr)));
        writeText(fd, "\nbacktrace:\n");
#if defined(AEDST_CRASH_HAS_EXECINFO)
        constexpr std::size_t kMaxFrames = 64;
        std::array<void*, kMaxFrames> frames{};
        const int count = ::backtrace(frames.data(), static_cast<int>(frames.size()));
        if (count > 0) {
            ::backtrace_symbols_fd(frames.data(), count, fd);
        }
#endif
        ::fsync(fd);
        ::close(fd);
        s.fd = -1;
    }
    // Restore the default disposition and re-raise so the OS still terminates
    // the process (and writes its own core/crash report) as usual.
    struct sigaction dfl{};
    dfl.sa_handler = SIG_DFL;
    ::sigemptyset(&dfl.sa_mask);
    ::sigaction(signalNumber, &dfl, nullptr);
    ::raise(signalNumber);
}

void resetDefaultHandlers() {
    struct sigaction dfl{};
    dfl.sa_handler = SIG_DFL;
    ::sigemptyset(&dfl.sa_mask);
    for (const int signalNumber : kFatalSignals) {
        ::sigaction(signalNumber, &dfl, nullptr);
    }
}

#endif

/// Empty `crash-*` files are pre-opened reports of sessions that never crashed
/// (or were killed); remove them so they do not accumulate.
void purgeEmptyReports(const std::filesystem::path& crashesDirectory) {
    std::error_code ec;
    std::filesystem::directory_iterator it(crashesDirectory, ec);
    if (ec) {
        return;
    }
    for (const std::filesystem::directory_iterator end; it != end; it.increment(ec)) {
        if (ec) {
            return;
        }
        std::error_code entryError;
        const std::string name = it->path().filename().string();
        if (name.starts_with("crash-") && it->is_regular_file(entryError) && !entryError &&
            it->file_size(entryError) == 0 && !entryError) {
            std::error_code removeError;
            std::filesystem::remove(it->path(), removeError);
        }
    }
}

} // namespace

std::string formatCrashTimestamp(std::chrono::system_clock::time_point when) {
    std::int64_t seconds = std::chrono::duration_cast<Seconds>(when.time_since_epoch()).count();
    constexpr std::int64_t kDay = 86400;
    std::int64_t days = seconds / kDay;
    std::int64_t secondOfDay = seconds % kDay;
    if (secondOfDay < 0) {
        secondOfDay += kDay;
        --days;
    }
    const CivilDate date = civilFromDays(days);
    return fmt::format("{:04}{:02}{:02}T{:02}{:02}{:02}Z", date.year, date.month, date.day, secondOfDay / 3600,
                       (secondOfDay % 3600) / 60, secondOfDay % 60);
}

std::string crashFileName(std::chrono::system_clock::time_point when, unsigned long processId,
                          std::string_view extension) {
    return fmt::format("crash-{}-{}{}", formatCrashTimestamp(when), processId, extension);
}

core::VoidOutcome CrashHandler::install(const std::filesystem::path& directory, std::string_view appVersion) {
    GlobalState& s = state();
    if (s.installed.load()) {
        return core::ok();
    }
    const std::filesystem::path crashes = directory / "crashes";
    std::error_code ec;
    std::filesystem::create_directories(crashes, ec);
    if (ec) {
        return core::fail(core::Error::storage("crash handler: cannot create directory: " + ec.message()));
    }
    purgeEmptyReports(crashes);
    s.crashesDirectory = crashes;

#if defined(_WIN32)
    const std::wstring wide = crashes.wstring();
    if (wide.size() + 1 > s.directory.size()) {
        return core::fail(core::Error::invalidInput("crash handler: directory path too long"));
    }
    std::wmemcpy(s.directory.data(), wide.c_str(), wide.size() + 1);
    static_cast<void>(appVersion);
    s.handling.clear();
    s.previousFilter = SetUnhandledExceptionFilter(&unhandledExceptionFilter);
#else
    const std::string version = sanitizeVersion(appVersion, GlobalState::kVersionCapacity);
    std::memcpy(s.version.data(), version.data(), version.size());
    s.versionLength = version.size();

    s.preopenedReport =
        crashes / crashFileName(std::chrono::system_clock::now(), static_cast<unsigned long>(::getpid()), ".txt");
    s.fd = ::open(s.preopenedReport.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (s.fd < 0) {
        return core::fail(core::Error::storage("crash handler: cannot open the report file"));
    }

#if defined(AEDST_CRASH_HAS_EXECINFO)
    // The first backtrace() call may load libgcc dynamically (allocating); do it
    // now so the handler never has to.
    std::array<void*, 4> warmup{};
    static_cast<void>(::backtrace(warmup.data(), static_cast<int>(warmup.size())));
#endif

    stack_t altStack{};
    altStack.ss_sp = s.altStack.data();
    altStack.ss_size = s.altStack.size();
    altStack.ss_flags = 0;
    ::sigaltstack(&altStack, nullptr);

    struct sigaction action{};
    action.sa_handler = &handleFatalSignal;
    ::sigemptyset(&action.sa_mask);
    // SA_RESETHAND/SA_NODEFER: the second fatal signal (including the re-raise)
    // takes the default action instead of recursing.
    action.sa_flags = SA_ONSTACK | SA_RESETHAND | SA_NODEFER;
    s.handling.clear();
    for (const int signalNumber : kFatalSignals) {
        ::sigaction(signalNumber, &action, nullptr);
    }
#endif
    s.installed.store(true);
    return core::ok();
}

void CrashHandler::uninstall() {
    GlobalState& s = state();
    if (!s.installed.exchange(false)) {
        return;
    }
#if defined(_WIN32)
    SetUnhandledExceptionFilter(s.previousFilter);
#else
    resetDefaultHandlers();
    if (s.fd >= 0) {
        ::close(s.fd);
        s.fd = -1;
    }
    std::error_code ec;
    if (!s.preopenedReport.empty() && std::filesystem::exists(s.preopenedReport, ec) &&
        std::filesystem::file_size(s.preopenedReport, ec) == 0 && !ec) {
        std::filesystem::remove(s.preopenedReport, ec);
    }
#endif
}

bool CrashHandler::isInstalled() {
    return state().installed.load();
}

std::filesystem::path CrashHandler::crashesDirectory() {
    return state().crashesDirectory;
}

} // namespace aedst::crash
