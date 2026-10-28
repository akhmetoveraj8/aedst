#include "key_file.hpp"

#include <openssl/rand.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <ios>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#else
#include <cerrno>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace aedst::persistence::detail {

core::Outcome<std::optional<std::vector<std::uint8_t>>> readFileBytes(const std::filesystem::path& file,
                                                                      std::size_t maxSize) {
    std::error_code ec;
    const bool exists = std::filesystem::exists(file, ec);
    if (ec) {
        return core::fail(core::Error::storage("cannot stat file: " + ec.message()));
    }
    if (!exists) {
        return std::optional<std::vector<std::uint8_t>>{};
    }

    const std::uintmax_t size = std::filesystem::file_size(file, ec);
    if (ec) {
        return core::fail(core::Error::storage("cannot determine file size: " + ec.message()));
    }
    if (size > maxSize) {
        return core::fail(core::Error::storage("file is larger than expected"));
    }

    std::ifstream in(file, std::ios::binary);
    if (!in) {
        return core::fail(core::Error::storage("cannot open file for reading"));
    }
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
    in.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (in.gcount() != static_cast<std::streamsize>(bytes.size())) {
        core::secureWipe(bytes);
        return core::fail(core::Error::storage("short read"));
    }
    return std::optional<std::vector<std::uint8_t>>{std::move(bytes)};
}

core::Outcome<std::optional<SecretBytes>> readKeyFile(const std::filesystem::path& file) {
    auto bytes = readFileBytes(file, kMasterKeySize);
    if (!bytes) {
        return core::fail(
            core::Error::storage("secure storage key file is unreadable or corrupt: " + bytes.error().message));
    }
    if (!*bytes) {
        return std::optional<SecretBytes>{};
    }
    if ((*bytes)->size() != kMasterKeySize) {
        core::secureWipe(**bytes);
        return core::fail(core::Error::storage("secure storage key file is corrupt (unexpected size)"));
    }
    return std::optional<SecretBytes>{SecretBytes{std::move(**bytes)}};
}

core::Outcome<SecretBytes> generateMasterKey() {
    std::vector<std::uint8_t> key(kMasterKeySize);
    if (RAND_bytes(key.data(), static_cast<int>(key.size())) != 1) {
        core::secureWipe(key);
        return core::fail(core::Error::storage("RAND_bytes failed"));
    }
    return SecretBytes{std::move(key)};
}

core::VoidOutcome secureDeleteFile(const std::filesystem::path& file) {
    std::error_code ec;
    const bool exists = std::filesystem::exists(file, ec);
    if (!ec && !exists) {
        return core::ok();
    }

    bool overwritten = false;
    const std::uintmax_t size = std::filesystem::file_size(file, ec);
    if (!ec) {
        std::fstream stream(file, std::ios::in | std::ios::out | std::ios::binary);
        if (stream) {
            const std::array<char, 4096> zeros{};
            std::uintmax_t remaining = size;
            while (remaining > 0 && stream) {
                const auto chunk = static_cast<std::size_t>(std::min<std::uintmax_t>(remaining, zeros.size()));
                stream.write(zeros.data(), static_cast<std::streamsize>(chunk));
                remaining -= chunk;
            }
            stream.flush();
            overwritten = static_cast<bool>(stream);
        }
    }

    // Remove even when the overwrite failed: leaving the key behind is worse.
    std::filesystem::remove(file, ec);
    if (ec) {
        return core::fail(core::Error::storage("cannot remove key file: " + ec.message()));
    }
    if (!overwritten) {
        return core::fail(core::Error::storage("key file removed but could not be overwritten first"));
    }
    return core::ok();
}

#if defined(_WIN32)

core::Outcome<bool> createFileExclusive(const std::filesystem::path& file, std::span<const std::uint8_t> bytes) {
    std::error_code ec;
    if (file.has_parent_path()) {
        std::filesystem::create_directories(file.parent_path(), ec);
    }
    std::filesystem::path temp = file;
    temp += ".tmp";
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        out.flush();
        if (!out) {
            return core::fail(core::Error::storage("failed to write key file"));
        }
    }
    // No MOVEFILE_REPLACE_EXISTING: fails when `file` already exists, which
    // makes the publish step exclusive and atomic.
    if (MoveFileExW(temp.c_str(), file.c_str(), 0) == FALSE) {
        const DWORD error = GetLastError();
        std::filesystem::remove(temp, ec);
        if (error == ERROR_ALREADY_EXISTS || error == ERROR_FILE_EXISTS) {
            return false;
        }
        return core::fail(core::Error::storage("MoveFileExW failed: " + std::to_string(error)));
    }
    return true;
}

#else

core::Outcome<bool> createFileExclusive(const std::filesystem::path& file, std::span<const std::uint8_t> bytes) {
    std::error_code ec;
    if (file.has_parent_path()) {
        std::filesystem::create_directories(file.parent_path(), ec);
    }

    const std::string target = file.string();
    const std::string temp = target + ".tmp." + std::to_string(static_cast<long long>(::getpid()));
    // The temp name embeds our PID; a leftover from a crashed earlier run of the
    // same PID is ours to discard.
    ::unlink(temp.c_str());

    constexpr mode_t kOwnerOnly = S_IRUSR | S_IWUSR;
    const int fd = ::open(temp.c_str(), O_CREAT | O_EXCL | O_WRONLY | O_CLOEXEC, kOwnerOnly);
    if (fd < 0) {
        return core::fail(core::Error::storage("cannot create key file: " +
                                               std::error_code(errno, std::generic_category()).message()));
    }

    int failure = 0;
    std::size_t written = 0;
    while (written < bytes.size()) {
        const ssize_t count = ::write(fd, bytes.data() + written, bytes.size() - written);
        if (count < 0) {
            if (errno == EINTR) {
                continue;
            }
            failure = errno;
            break;
        }
        written += static_cast<std::size_t>(count);
    }
    // fchmod is umask-independent, unlike the mode passed to open().
    if (failure == 0 && ::fchmod(fd, kOwnerOnly) != 0) {
        failure = errno;
    }
    if (failure == 0 && ::fsync(fd) != 0) {
        failure = errno;
    }
    if (::close(fd) != 0 && failure == 0) {
        failure = errno;
    }
    if (failure != 0) {
        ::unlink(temp.c_str());
        return core::fail(core::Error::storage("cannot write key file: " +
                                               std::error_code(failure, std::generic_category()).message()));
    }

    // link(2) fails with EEXIST instead of replacing, so a concurrent creator
    // wins cleanly and the key file never appears half-written.
    if (::link(temp.c_str(), target.c_str()) == 0) {
        ::unlink(temp.c_str());
        return true;
    }
    const int linkError = errno;
    if (linkError == EEXIST) {
        ::unlink(temp.c_str());
        return false;
    }
    // Filesystems without hard links (e.g. FAT/some FUSE mounts): fall back to
    // rename, guarded by an existence check.
    if (!std::filesystem::exists(file, ec) && ::rename(temp.c_str(), target.c_str()) == 0) {
        return true;
    }
    ::unlink(temp.c_str());
    return core::fail(core::Error::storage("cannot publish key file: " +
                                           std::error_code(linkError, std::generic_category()).message()));
}

#endif

} // namespace aedst::persistence::detail
