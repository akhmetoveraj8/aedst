#pragma once

// Private helpers shared by the key providers; not part of the public API.

#include "aedst/core/outcome.hpp"
#include "aedst/persistence/master_key_provider.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <vector>

namespace aedst::persistence::detail {

/// Reads the whole file, failing if it is larger than `maxSize`. nullopt when the
/// file does not exist. The returned buffer is NOT wiped: callers holding secrets
/// must wipe it (readKeyFile does).
[[nodiscard]] core::Outcome<std::optional<std::vector<std::uint8_t>>> readFileBytes(const std::filesystem::path& file,
                                                                                    std::size_t maxSize);

/// Reads a raw 32-byte key file. nullopt when absent; Error when the size is not
/// exactly kMasterKeySize (corrupt file: never silently replaced).
[[nodiscard]] core::Outcome<std::optional<SecretBytes>> readKeyFile(const std::filesystem::path& file);

/// Writes `bytes` to a new file that becomes visible at `file` atomically and
/// only if `file` does not exist yet (POSIX: 0600 temp file + fsync + link(2)).
/// Returns false (not an error) when someone else created `file` first.
[[nodiscard]] core::Outcome<bool> createFileExclusive(const std::filesystem::path& file,
                                                      std::span<const std::uint8_t> bytes);

/// Cryptographically random key of kMasterKeySize bytes.
[[nodiscard]] core::Outcome<SecretBytes> generateMasterKey();

/// Overwrites the file with zeros, flushes, then removes it. Best effort: it
/// cannot defeat copy-on-write filesystems or SSD wear levelling.
[[nodiscard]] core::VoidOutcome secureDeleteFile(const std::filesystem::path& file);

// Platform keyring backend, defined in its own translation unit. Returns
// nullptr when the platform/build has no such backend.
[[nodiscard]] std::unique_ptr<KeyringBackend> makeLibsecretBackend();

} // namespace aedst::persistence::detail
