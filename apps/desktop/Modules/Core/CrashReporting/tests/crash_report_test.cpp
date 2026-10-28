#include "aedst/crash/crash_report.hpp"
#include "temp_dir_fixture.hpp"

#include <gtest/gtest.h>

#include <filesystem>
#include <string>

namespace aedst::crash {
namespace {

class CrashReportTest : public test_support::TempDirTest {};

TEST_F(CrashReportTest, ListsOnlyNonEmptyCrashFilesOldestFirst) {
    writeFile(root_ / "crash-20240102T000000Z-1.txt", "b");
    writeFile(root_ / "crash-20240101T000000Z-1.dmp", "aa");
    writeFile(root_ / "crash-20240103T000000Z-1.txt", "");                       // unused pre-opened report
    writeFile(root_ / "upload_log.txt", "123\n");                                // not a report
    writeFile(root_ / "crash-20240104T000000Z-1.log", "x");                      // wrong extension
    writeFile(root_ / "notes-crash-20240104T000000Z-1.txt", "x");                // wrong prefix
    std::filesystem::create_directories(root_ / "crash-20240105T000000Z-1.txt"); // directory

    const auto reports = listPendingReports(root_);
    ASSERT_EQ(reports.size(), 2U);
    EXPECT_EQ(reports[0].id, "crash-20240101T000000Z-1.dmp");
    EXPECT_EQ(reports[0].sizeBytes, 2U);
    EXPECT_EQ(reports[1].id, "crash-20240102T000000Z-1.txt");
    EXPECT_EQ(reports[1].sizeBytes, 1U);
}

TEST_F(CrashReportTest, MissingDirectoryYieldsNoReports) {
    EXPECT_TRUE(listPendingReports(root_ / "does-not-exist").empty());
}

TEST(ScrubHomePathsTest, RedactsAccountNames) {
    EXPECT_EQ(scrubHomePaths("/home/alice/.local/bin/aedst(+0x1f)"), "/home/<user>/.local/bin/aedst(+0x1f)");
    EXPECT_EQ(scrubHomePaths("/Users/Bob Smith/x"), "/Users/<user> Smith/x");
    EXPECT_EQ(scrubHomePaths("C:\\Users\\carol\\AppData\\aedst.exe"), "C:\\Users\\<user>\\AppData\\aedst.exe");
    EXPECT_EQ(scrubHomePaths("/opt/aedst/bin (no home)"), "/opt/aedst/bin (no home)");
    EXPECT_EQ(scrubHomePaths("/home/a /home/b"), "/home/<user> /home/<user>");
    EXPECT_EQ(scrubHomePaths(""), "");
}

} // namespace
} // namespace aedst::crash
