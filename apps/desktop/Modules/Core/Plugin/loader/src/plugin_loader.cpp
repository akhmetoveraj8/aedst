#include "aedst/plugin/plugin_loader.hpp"

#include "aedst/logging/log_categories.hpp"
#include "aedst/plugin/plugin_manager.hpp"
#include "aedst/plugin/qt_feature_plugin.hpp"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QLibrary>
#include <QPluginLoader>
#include <QString>
#include <QtGlobal>

#include <algorithm>
#include <cstdint>
#include <optional>
#include <set>
#include <span>
#include <utility>

namespace aedst::plugin {
namespace {

constexpr int kAllowlistSchema = 1;
constexpr char kExpectedIid[] = "com.aedst.FeaturePlugin/1";

[[nodiscard]] QString toQString(const std::filesystem::path& path) {
    return QString::fromStdString(path.generic_string());
}

/// The file's whole content is read once through a bounded loop: no unbounded allocation and the
/// size that is hashed is the size that is compared with the allowlist.
struct HashedFile {
    std::string sha256;
    std::uint64_t size{0};
};

[[nodiscard]] std::optional<HashedFile> hashFile(const QString& path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        return std::nullopt;
    }
    QCryptographicHash hash(QCryptographicHash::Sha256);
    std::uint64_t total = 0;
    constexpr qint64 kChunk = 64 * 1024;
    while (!file.atEnd()) {
        const QByteArray chunk = file.read(kChunk);
        if (chunk.isEmpty()) {
            break;
        }
        total += static_cast<std::uint64_t>(chunk.size());
        if (total > static_cast<std::uint64_t>(kMaxPluginFileBytes)) {
            return std::nullopt;
        }
        hash.addData(chunk);
    }
    return HashedFile{.sha256 = hash.result().toHex().toStdString(), .size = total};
}

[[nodiscard]] std::optional<QByteArray> readSmallFile(const QString& path, qint64 maxBytes) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > maxBytes) {
        return std::nullopt;
    }
    return file.readAll();
}

[[nodiscard]] bool isReleaseBuildFlag() noexcept {
#ifdef NDEBUG
    return true;
#else
    return false;
#endif
}

[[nodiscard]] bool signatureVerifies(const QByteArray& message, const QByteArray& signature,
                                     const std::vector<update::TrustedKey>& keys) {
    if (signature.size() != static_cast<qsizetype>(update::kEd25519SignatureBytes)) {
        return false;
    }
    const auto* messageBytes = reinterpret_cast<const std::uint8_t*>(message.constData());
    const auto* signatureBytes = reinterpret_cast<const std::uint8_t*>(signature.constData());
    return std::ranges::any_of(keys, [&](const update::TrustedKey& key) {
        return update::verifyEd25519(key.publicKey, std::span(messageBytes, static_cast<std::size_t>(message.size())),
                                     std::span(signatureBytes, update::kEd25519SignatureBytes));
    });
}

/// The release directory must not be writable by the user running the app: otherwise the user (or
/// malware running as the user) could swap a library between the hash check and the load.
[[nodiscard]] bool directoryIsProtected(const QFileInfo& directory) {
    return !directory.isWritable() && !directory.isSymLink();
}

[[nodiscard]] TrustPolicy buildPolicy(const PluginLoaderConfig& config, const QDir& dir, std::string& problem) {
    TrustPolicy policy;
    policy.releaseBuild = config.releaseBuild;
    policy.allowUnsignedDevPlugins = config.allowUnsignedDevPlugins && !config.releaseBuild;

    const QString allowlistPath = dir.filePath(QString::fromLatin1(kAllowlistFileName));
    if (!QFileInfo::exists(allowlistPath)) {
        return policy;
    }
    policy.allowlistPresent = true;

    const auto allowlist = readSmallFile(allowlistPath, kMaxAllowlistBytes);
    const auto signature = readSmallFile(dir.filePath(QString::fromLatin1(kAllowlistSignatureFileName)),
                                         static_cast<qint64>(update::kEd25519SignatureBytes));
    if (!allowlist || !signature) {
        problem = "allowlist or its signature could not be read";
        return policy;
    }
    if (!signatureVerifies(*allowlist, *signature, config.trustedKeys)) {
        problem = "allowlist signature does not verify against any trusted release key";
        return policy;
    }
    // Parse only after the signature verified: unauthenticated bytes are never interpreted.
    auto entries = parseAllowlist(*allowlist);
    if (!entries) {
        problem = "allowlist is malformed: " + entries.error().message;
        return policy;
    }
    policy.allowlistSignatureValid = true;
    policy.entries = std::move(*entries);
    return policy;
}

} // namespace

PluginLoaderConfig PluginLoaderConfig::forApplication(std::filesystem::path directory) {
    PluginLoaderConfig config;
    config.directory = std::move(directory);
    config.trustedKeys = update::embeddedTrustedKeys();
    config.releaseBuild = isReleaseBuildFlag();
#ifndef NDEBUG
    config.allowUnsignedDevPlugins = qEnvironmentVariable("AEDST_ALLOW_UNSIGNED_PLUGINS") == QLatin1String("1");
#endif
    return config;
}

core::Outcome<std::vector<AllowlistEntry>> parseAllowlist(const QByteArray& json) {
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(json, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        return core::fail(core::Error::invalidInput("not a JSON object"));
    }
    const QJsonObject root = document.object();
    if (root.value(QLatin1String("schema")).toInt(-1) != kAllowlistSchema) {
        return core::fail(core::Error::invalidInput("unsupported schema"));
    }
    const QJsonValue plugins = root.value(QLatin1String("plugins"));
    if (!plugins.isArray()) {
        return core::fail(core::Error::invalidInput("'plugins' must be an array"));
    }

    std::vector<AllowlistEntry> entries;
    std::set<std::string, std::less<>> seen;
    for (const QJsonValue& value : plugins.toArray()) {
        if (!value.isObject()) {
            return core::fail(core::Error::invalidInput("every plugin entry must be an object"));
        }
        const QJsonObject object = value.toObject();
        AllowlistEntry entry;
        entry.fileName = object.value(QLatin1String("file")).toString().toStdString();
        entry.sha256 = object.value(QLatin1String("sha256")).toString().toLower().toStdString();
        entry.pluginId = object.value(QLatin1String("id")).toString().toStdString();
        const double size = object.value(QLatin1String("size")).toDouble(-1);
        if (entry.fileName.empty() || entry.sha256.size() != 64 || size < 0 || !isValidPluginId(entry.pluginId)) {
            return core::fail(core::Error::invalidInput("entry needs file, 64-hex sha256, size and a valid id"));
        }
        entry.size = static_cast<std::uint64_t>(size);
        if (!seen.insert(entry.fileName).second) {
            return core::fail(core::Error::invalidInput("duplicate file name: " + entry.fileName));
        }
        entries.push_back(std::move(entry));
    }
    return entries;
}

PluginLoader::PluginLoader(PluginLoaderConfig config) : config_(std::move(config)) {}

PluginLoader::~PluginLoader() = default;

std::vector<LoadedPlugin> PluginLoader::loadAll(std::vector<LoadReport>& report) {
    std::vector<LoadedPlugin> loaded;

    const QString dirPath = toQString(config_.directory);
    const QFileInfo dirInfo(dirPath);
    if (config_.directory.empty() || !dirInfo.isDir()) {
        return loaded; // no plugin directory is the normal case
    }
    if (config_.releaseBuild && !directoryIsProtected(dirInfo)) {
        report.push_back({.fileName = {},
                          .verdict = TrustVerdict::NoAllowlist,
                          .loaded = false,
                          .detail = "plugin directory is writable by the current user; refusing to load from it"});
        qCWarning(lcApp, "Plugins are not loaded: the plugin directory is writable by the current user");
        return loaded;
    }

    const QDir dir(dirPath);
    std::string policyProblem;
    const TrustPolicy policy = buildPolicy(config_, dir, policyProblem);
    if (!policyProblem.empty()) {
        report.push_back(
            {.fileName = {}, .verdict = TrustVerdict::BadSignature, .loaded = false, .detail = policyProblem});
        qCWarning(lcApp, "Plugins are not loaded: %s", policyProblem.c_str());
        return loaded;
    }

    const QFileInfoList files = dir.entryInfoList(QDir::Files | QDir::NoDotAndDotDot, QDir::Name);
    int seen = 0;
    for (const QFileInfo& file : files) {
        if (!QLibrary::isLibrary(file.fileName())) {
            continue; // the allowlist and signature files, READMEs, ...
        }
        if (++seen > kMaxPluginFiles) {
            report.push_back({.fileName = {},
                              .verdict = TrustVerdict::NotListed,
                              .loaded = false,
                              .detail = "too many plugin files; the rest were ignored"});
            break;
        }
        const std::string fileName = file.fileName().toStdString();
        if (file.isSymLink()) {
            report.push_back({.fileName = fileName,
                              .verdict = TrustVerdict::NotListed,
                              .loaded = false,
                              .detail = "symbolic links are never loaded"});
            continue;
        }
        const auto hashed = hashFile(file.absoluteFilePath());
        if (!hashed) {
            report.push_back({.fileName = fileName,
                              .verdict = TrustVerdict::HashMismatch,
                              .loaded = false,
                              .detail = "file could not be read or is too large"});
            continue;
        }
        const TrustDecision decision = evaluateCandidate(
            policy, CandidateFile{.fileName = fileName, .sha256 = hashed->sha256, .size = hashed->size});
        if (!decision.loadable()) {
            report.push_back({.fileName = fileName,
                              .verdict = decision.verdict,
                              .loaded = false,
                              .detail = std::string(toString(decision.verdict))});
            qCWarning(lcApp, "Plugin %s was not loaded: %s", fileName.c_str(),
                      std::string(toString(decision.verdict)).c_str());
            continue;
        }

        // The file is trusted (signed allowlist, or an explicit Debug-only switch). Qt still checks
        // the IID, so a library built for another plugin API is refused before its code is used.
        auto qtLoader = std::make_unique<QPluginLoader>(file.absoluteFilePath());
        const QString iid = qtLoader->metaData().value(QLatin1String("IID")).toString();
        const QJsonObject pluginMeta = qtLoader->metaData().value(QLatin1String("MetaData")).toObject();
        const std::string declaredId = pluginMeta.value(QLatin1String("id")).toString().toStdString();
        if (iid != QLatin1String(kExpectedIid) || !isValidPluginId(declaredId) ||
            (decision.entry != nullptr && decision.entry->pluginId != declaredId)) {
            report.push_back({.fileName = fileName,
                              .verdict = decision.verdict,
                              .loaded = false,
                              .detail = "plugin metadata (IID or id) does not match the allowlist"});
            continue;
        }
        QObject* instance = qtLoader->instance();
        auto* factory = qobject_cast<QtFeaturePluginFactory*>(instance);
        if (factory == nullptr) {
            report.push_back({.fileName = fileName,
                              .verdict = decision.verdict,
                              .loaded = false,
                              .detail = qtLoader->errorString().toStdString()});
            continue;
        }
        std::unique_ptr<IFeaturePlugin> plugin = factory->create();
        if (!plugin || plugin->descriptor().id != declaredId) {
            report.push_back({.fileName = fileName,
                              .verdict = decision.verdict,
                              .loaded = false,
                              .detail = "plugin did not create an IFeaturePlugin with the declared id"});
            continue;
        }
        report.push_back({.fileName = fileName, .verdict = decision.verdict, .loaded = true, .detail = {}});
        qCInfo(lcApp, "Plugin %s loaded from %s", declaredId.c_str(), fileName.c_str());
        loaders_.push_back(std::move(qtLoader));
        loaded.push_back(LoadedPlugin{.plugin = std::move(plugin), .fileName = fileName});
    }
    return loaded;
}

} // namespace aedst::plugin
