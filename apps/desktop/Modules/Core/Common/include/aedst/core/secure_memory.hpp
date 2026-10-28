#pragma once

#include <cstddef>
#include <string>
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
#include <cstring>
#if defined(__linux__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
#include <string.h>  // NOLINT(modernize-deprecated-headers): explicit_bzero is C, not std::
#include <strings.h> // NOLINT(modernize-deprecated-headers): explicit_bzero on BSD-derived libcs
#endif
#endif

namespace aedst::core {

/// Overwrites `size` bytes at `data` in a way the optimiser may not elide
/// (SecureZeroMemory on Windows, explicit_bzero on Linux/BSD, volatile memset elsewhere).
inline void secureWipe(void* data, std::size_t size) noexcept {
    if (data == nullptr || size == 0) {
        return;
    }
#if defined(_WIN32)
    SecureZeroMemory(data, size);
#elif defined(__linux__) || defined(__FreeBSD__) || defined(__OpenBSD__) || defined(__NetBSD__)
    explicit_bzero(data, size); // glibc >= 2.25 (g++ defines _GNU_SOURCE), musl >= 1.1.20, BSDs
#else
    // Anything else (no explicit_bzero / SecureZeroMemory): memset_s is only declared under optional feature macros,
    // so call memset through a volatile function pointer the optimiser cannot see through.
    static void* (*const volatile wipe)(void*, int, std::size_t) = std::memset;
    wipe(data, 0, size);
#endif
}

/// Wipes a string's characters, then releases its storage.
inline void secureWipe(std::string& text) noexcept {
    secureWipe(text.data(), text.size());
    text.clear();
    text.shrink_to_fit();
}

inline void secureWipe(std::vector<unsigned char>& bytes) noexcept {
    secureWipe(bytes.data(), bytes.size());
    bytes.clear();
    bytes.shrink_to_fit();
}

/// A std::string that wipes itself on destruction; for tokens/passwords held
/// in C++ (Qt's QString cannot be wiped reliably because of implicit sharing —
/// see QString handling in LoginViewModel).
class SecretString final {
public:
    SecretString() = default;

    // NOLINTNEXTLINE(google-explicit-constructor): lets aggregates take string literals
    SecretString(std::string value) : value_(std::move(value)) {}

    SecretString(const char* value) : value_(value != nullptr ? value : "") {} // NOLINT(google-explicit-constructor)

    SecretString(const SecretString&) = default;

    SecretString& operator=(const SecretString& other) {
        if (this != &other) {
            secureWipe(value_);
            value_ = other.value_;
        }
        return *this;
    }

    /// Content equality (not constant-time: used for session bookkeeping and tests, never to authenticate a caller).
    friend bool operator==(const SecretString& a, const SecretString& b) noexcept { return a.value_ == b.value_; }

    SecretString(SecretString&& other) noexcept : value_(std::move(other.value_)) { other.value_.clear(); }

    SecretString& operator=(SecretString&& other) noexcept {
        if (this != &other) {
            secureWipe(value_);
            value_ = std::move(other.value_);
            other.value_.clear();
        }
        return *this;
    }

    ~SecretString() { secureWipe(value_); }

    [[nodiscard]] const std::string& reveal() const noexcept { return value_; }

    [[nodiscard]] bool empty() const noexcept { return value_.empty(); }

    void clear() noexcept { secureWipe(value_); }

private:
    std::string value_;
};

} // namespace aedst::core
