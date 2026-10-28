#include "aedst/core/logger.hpp"

#include "aedst/core/correlation.hpp"
#include "aedst/core/redaction.hpp"
#include "redacting_sink.hpp"

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#endif

#include <spdlog/details/log_msg.h>
#include <spdlog/details/os.h>
#include <spdlog/formatter.h>
#include <spdlog/pattern_formatter.h>
#include <spdlog/sinks/rotating_file_sink.h>
#include <spdlog/sinks/stdout_color_sinks.h>

#include <array>
#include <chrono>
#include <cstddef>
#include <cstdio>
#include <ctime>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>

namespace aedst::core {
namespace {

// %C is our custom flag (calling thread's correlation id); the year is %Y, so
// spdlog's built-in %C (two-digit year) is not needed.
constexpr auto kTextPattern = "[%Y-%m-%d %H:%M:%S.%e] [%^%l%$] [%n] [t:%t] [cid:%C] %v";

/// `%C`: the correlation id of the thread that logs (loggers are synchronous, so
/// format() runs on that thread), or "-" outside a CorrelationScope.
class CorrelationFlag final : public spdlog::custom_flag_formatter {
public:
    void format(const spdlog::details::log_msg& /*msg*/, const std::tm& /*time*/, spdlog::memory_buf_t& dest) override {
        const std::string_view id = currentCorrelationId();
        const std::string_view text = id.empty() ? std::string_view{"-"} : id;
        dest.append(text.data(), text.data() + text.size());
    }

    [[nodiscard]] std::unique_ptr<custom_flag_formatter> clone() const override {
        return std::make_unique<CorrelationFlag>();
    }
};

void appendJsonEscaped(std::string& out, std::string_view text) {
    for (const char raw : text) {
        const auto c = static_cast<unsigned char>(raw);
        if (c == '"') {
            out += "\\\"";
        } else if (c == '\\') {
            out += "\\\\";
        } else if (c == '\n') {
            out += "\\n";
        } else if (c == '\r') {
            out += "\\r";
        } else if (c == '\t') {
            out += "\\t";
        } else if (c == '\b') {
            out += "\\b";
        } else if (c == '\f') {
            out += "\\f";
        } else if (c < 0x20) {
            std::array<char, 8> escaped{};
            const int written = std::snprintf(escaped.data(), escaped.size(), "\\u%04x", static_cast<unsigned>(c));
            if (written > 0) {
                out.append(escaped.data(), static_cast<std::size_t>(written));
            }
        } else {
            out.push_back(raw); // UTF-8 bytes pass through unchanged
        }
    }
}

void appendJsonTimestamp(std::string& out, spdlog::log_clock::time_point time) {
    const auto seconds = std::chrono::time_point_cast<std::chrono::seconds>(time);
    const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(time - seconds).count();
    const std::time_t epochSeconds = spdlog::log_clock::to_time_t(seconds);
    const std::tm utc = spdlog::details::os::gmtime(epochSeconds);
    std::array<char, 40> text{};
    const int written =
        std::snprintf(text.data(), text.size(), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", utc.tm_year + 1900,
                      utc.tm_mon + 1, utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec, static_cast<int>(millis));
    if (written > 0) {
        out.append(text.data(), static_cast<std::size_t>(written));
    }
}

/// One JSON object per line. Written by hand instead of with a pattern because a
/// pattern cannot escape the message (a quote or newline would break the record).
class JsonFormatter final : public spdlog::formatter {
public:
    void format(const spdlog::details::log_msg& msg, spdlog::memory_buf_t& dest) override {
        std::string line;
        line.reserve(msg.payload.size() + 160);
        line += "{\"ts\":\"";
        appendJsonTimestamp(line, msg.time);
        line += "\",\"level\":\"";
        const auto level = spdlog::level::to_string_view(msg.level);
        line.append(level.data(), level.size());
        line += "\",\"logger\":\"";
        appendJsonEscaped(line, std::string_view(msg.logger_name.data(), msg.logger_name.size()));
        line += "\",\"thread\":";
        line += std::to_string(msg.thread_id);
        const std::string_view correlationId = currentCorrelationId();
        if (!correlationId.empty()) {
            line += ",\"cid\":\"";
            appendJsonEscaped(line, correlationId);
            line += '"';
        }
        line += ",\"msg\":\"";
        appendJsonEscaped(line, std::string_view(msg.payload.data(), msg.payload.size()));
        line += "\"}\n";
        dest.append(line.data(), line.data() + line.size());
    }

    [[nodiscard]] std::unique_ptr<spdlog::formatter> clone() const override {
        return std::make_unique<JsonFormatter>();
    }
};

/// Redacts the message payload, then delegates to the wrapped formatter, so the
/// redaction applies to text and JSON output and to every sink (console, file,
/// and the ones tests inject) alike.
class RedactingFormatter final : public spdlog::formatter {
public:
    explicit RedactingFormatter(std::unique_ptr<spdlog::formatter> inner) : inner_(std::move(inner)) {}

    void format(const spdlog::details::log_msg& msg, spdlog::memory_buf_t& dest) override {
        const std::string_view original(msg.payload.data(), msg.payload.size());
        const std::string redacted = redactSecrets(original);
        if (redacted == original) {
            inner_->format(msg, dest);
            return;
        }
        spdlog::details::log_msg copy(msg);
        copy.payload = spdlog::string_view_t(redacted.data(), redacted.size());
        inner_->format(copy, dest);
        // `%^`/`%$` record the colour range on the message they format; hand it
        // back to the original so the console sink still colours the level.
        msg.color_range_start = copy.color_range_start;
        msg.color_range_end = copy.color_range_end;
    }

    [[nodiscard]] std::unique_ptr<spdlog::formatter> clone() const override {
        return std::make_unique<RedactingFormatter>(inner_->clone());
    }

private:
    std::unique_ptr<spdlog::formatter> inner_;
};

std::unique_ptr<spdlog::formatter> makeFormatter(LogFormat format, bool redact) {
    std::unique_ptr<spdlog::formatter> base;
    if (format == LogFormat::Json) {
        base = std::make_unique<JsonFormatter>();
    } else {
        auto pattern = std::make_unique<spdlog::pattern_formatter>();
        pattern->add_flag<CorrelationFlag>('C').set_pattern(kTextPattern);
        base = std::move(pattern);
    }
    if (!redact) {
        return base;
    }
    return std::make_unique<RedactingFormatter>(std::move(base));
}

std::mutex& loggerMutex() {
    static std::mutex mutex;
    return mutex;
}

std::shared_ptr<spdlog::logger>& loggerInstance() {
    static std::shared_ptr<spdlog::logger> instance;
    return instance;
}

spdlog::level::level_enum toSpdlog(LogLevel level) {
    switch (level) {
    case LogLevel::Trace:
        return spdlog::level::trace;
    case LogLevel::Debug:
        return spdlog::level::debug;
    case LogLevel::Info:
        return spdlog::level::info;
    case LogLevel::Warn:
        return spdlog::level::warn;
    case LogLevel::Error:
        return spdlog::level::err;
    case LogLevel::Critical:
        return spdlog::level::critical;
    case LogLevel::Off:
        return spdlog::level::off;
    }
    return spdlog::level::info;
}

std::shared_ptr<spdlog::logger> makeFallbackLogger() {
    auto logger = std::make_shared<spdlog::logger>("aedst", std::make_shared<spdlog::sinks::stdout_color_sink_mt>());
    logger->set_formatter(makeFormatter(LogFormat::Text, true));
    return logger;
}

} // namespace

namespace {

/// spdlog opens files through the ANSI code page on Windows, so a profile path with
/// non-ASCII characters (e.g. a Cyrillic user name) cannot be opened directly.
/// The parent directory's 8.3 short name is ASCII; the file name itself is ours.
std::string fileSinkPath(const std::filesystem::path& file) {
#if defined(_WIN32)
    const std::wstring parent = file.parent_path().wstring();
    bool ascii = true;
    for (const wchar_t c : parent) {
        ascii = ascii && c < 0x80;
    }
    if (!ascii) {
        std::wstring shortPath(MAX_PATH, L' ');
        const DWORD length = GetShortPathNameW(parent.c_str(), shortPath.data(), static_cast<DWORD>(shortPath.size()));
        if (length > 0 && length < shortPath.size()) {
            shortPath.resize(length);
            return (std::filesystem::path(shortPath) / file.filename()).string();
        }
    }
#endif
    return file.string();
}

} // namespace

void AedstLogger::init(const LoggerConfig& config, std::vector<spdlog::sink_ptr> extraSinks) {
    std::vector<spdlog::sink_ptr> sinks;
    if (config.console) {
        sinks.push_back(std::make_shared<spdlog::sinks::stdout_color_sink_mt>());
    }
    if (!config.logFile.empty()) {
        if (config.logFile.has_parent_path()) {
            std::error_code ignored;
            std::filesystem::create_directories(config.logFile.parent_path(), ignored);
        }
        sinks.push_back(std::make_shared<spdlog::sinks::rotating_file_sink_mt>(
            fileSinkPath(config.logFile), config.maxFileSizeBytes, config.maxFiles));
    }
    for (auto& sink : extraSinks) {
        sinks.push_back(std::move(sink));
    }

    // ONE redaction pass for all sinks (RedactingSink); the per-sink formatters only format.
    auto logger =
        std::make_shared<spdlog::logger>(config.name, std::make_shared<RedactingSink>(std::move(sinks), config.redact));
    logger->set_level(toSpdlog(config.level));
    logger->set_formatter(makeFormatter(config.format, false)); // cloned onto every wrapped sink
    logger->flush_on(spdlog::level::warn);

    const std::scoped_lock lock(loggerMutex());
    loggerInstance() = std::move(logger);
}

void AedstLogger::setLevel(LogLevel level) {
    get()->set_level(toSpdlog(level));
}

void AedstLogger::flush() {
    get()->flush();
}

void AedstLogger::shutdown() {
    const std::scoped_lock lock(loggerMutex());
    if (auto& instance = loggerInstance()) {
        instance->flush();
        instance.reset();
    }
}

std::shared_ptr<spdlog::logger> AedstLogger::get() {
    const std::scoped_lock lock(loggerMutex());
    auto& instance = loggerInstance();
    if (!instance) {
        instance = makeFallbackLogger();
    }
    return instance;
}

} // namespace aedst::core
