#include "aedst/plugin/plugin_loader.hpp"

#include <QByteArray>
#include <QDir>
#include <QFile>
#include <QString>
#include <QTemporaryDir>

#include <gtest/gtest.h>

#include <filesystem>
#include <string>
#include <vector>

namespace aedst::plugin {
namespace {

const std::string kHash(64, 'c');

QByteArray allowlist(const std::string& entryJson) {
    return QByteArray::fromStdString(R"({"schema":1,"plugins":[)" + entryJson + "]}");
}

std::string entry(const std::string& file, const std::string& id, const std::string& hash = kHash) {
    return R"({"file":")" + file + R"(","sha256":")" + hash + R"(","size":10,"id":")" + id + R"("})";
}

TEST(ParseAllowlist, AcceptsAWellFormedList) {
    const auto parsed = parseAllowlist(allowlist(entry("a.dll", "vendor.a") + "," + entry("b.dll", "vendor.b")));
    ASSERT_TRUE(parsed);
    ASSERT_EQ(parsed->size(), 2U);
    EXPECT_EQ(parsed->front().fileName, "a.dll");
    EXPECT_EQ(parsed->front().pluginId, "vendor.a");
    EXPECT_EQ(parsed->front().size, 10U);
}

TEST(ParseAllowlist, NormalisesHashCase) {
    const auto parsed = parseAllowlist(allowlist(entry("a.dll", "vendor.a", std::string(64, 'C'))));
    ASSERT_TRUE(parsed);
    EXPECT_EQ(parsed->front().sha256, kHash);
}

TEST(ParseAllowlist, IsAllOrNothing) {
    EXPECT_FALSE(parseAllowlist(QByteArray("not json")));
    EXPECT_FALSE(parseAllowlist(QByteArray(R"({"schema":2,"plugins":[]})")));
    EXPECT_FALSE(parseAllowlist(QByteArray(R"({"schema":1})")));
    EXPECT_FALSE(parseAllowlist(allowlist(entry("a.dll", "Bad Id"))));
    EXPECT_FALSE(parseAllowlist(allowlist(entry("a.dll", "vendor.a", "abc"))));
    EXPECT_FALSE(parseAllowlist(allowlist(entry("a.dll", "vendor.a") + "," + entry("a.dll", "vendor.b"))));
    EXPECT_FALSE(parseAllowlist(allowlist(entry("a.dll", "vendor.a") + ",42")));
}

class LoaderDirectory : public ::testing::Test {
protected:
    void SetUp() override { ASSERT_TRUE(dir_.isValid()); }

    void write(const QString& name, const QByteArray& bytes) {
        QFile file(dir_.filePath(name));
        ASSERT_TRUE(file.open(QIODevice::WriteOnly));
        file.write(bytes);
    }

    PluginLoaderConfig config() const {
        PluginLoaderConfig config;
        config.directory = std::filesystem::path(dir_.path().toStdString());
        config.releaseBuild = false; // a temporary directory is writable, which release mode refuses on purpose
        return config;
    }

    QTemporaryDir dir_;
};

TEST_F(LoaderDirectory, MissingDirectoryLoadsNothing) {
    PluginLoaderConfig cfg = config();
    cfg.directory = cfg.directory / "does-not-exist";
    PluginLoader loader(cfg);
    std::vector<LoadReport> report;
    EXPECT_TRUE(loader.loadAll(report).empty());
    EXPECT_TRUE(report.empty());
}

TEST_F(LoaderDirectory, ReleaseModeRefusesAWritableDirectory) {
    write(QStringLiteral("evil.dll"), QByteArray("MZ"));
    PluginLoaderConfig cfg = config();
    cfg.releaseBuild = true;
    PluginLoader loader(cfg);
    std::vector<LoadReport> report;

    EXPECT_TRUE(loader.loadAll(report).empty());
    ASSERT_EQ(report.size(), 1U);
    EXPECT_FALSE(report.front().loaded);
}

TEST_F(LoaderDirectory, UnlistedLibraryIsNotLoadedWithoutAnAllowlist) {
    write(QStringLiteral("evil.dll"), QByteArray("MZ"));
    write(QStringLiteral("evil.so"), QByteArray("\x7f"
                                                "ELF"));
    PluginLoader loader(config()); // dev switch off
    std::vector<LoadReport> report;

    EXPECT_TRUE(loader.loadAll(report).empty());
    EXPECT_FALSE(report.empty());
    for (const LoadReport& line : report) {
        EXPECT_FALSE(line.loaded);
        EXPECT_EQ(line.verdict, TrustVerdict::NoAllowlist);
    }
}

TEST_F(LoaderDirectory, AllowlistWithoutAValidSignatureRejectsEverything) {
    write(QStringLiteral("plugins.allowlist.json"), allowlist(entry("evil.dll", "vendor.evil")));
    write(QStringLiteral("plugins.allowlist.sig"), QByteArray(64, 'x')); // no trusted keys configured
    write(QStringLiteral("evil.dll"), QByteArray("MZ"));
    PluginLoader loader(config());
    std::vector<LoadReport> report;

    EXPECT_TRUE(loader.loadAll(report).empty());
    ASSERT_FALSE(report.empty());
    EXPECT_EQ(report.front().verdict, TrustVerdict::BadSignature);
}

TEST_F(LoaderDirectory, MissingSignatureFileRejectsEverything) {
    write(QStringLiteral("plugins.allowlist.json"), allowlist(entry("evil.dll", "vendor.evil")));
    write(QStringLiteral("evil.dll"), QByteArray("MZ"));
    PluginLoader loader(config());
    std::vector<LoadReport> report;

    EXPECT_TRUE(loader.loadAll(report).empty());
    ASSERT_FALSE(report.empty());
    EXPECT_EQ(report.front().verdict, TrustVerdict::BadSignature);
}

} // namespace
} // namespace aedst::plugin
