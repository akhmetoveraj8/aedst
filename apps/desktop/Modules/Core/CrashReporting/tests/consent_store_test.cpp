#include "aedst/crash/consent_store.hpp"
#include "temp_dir_fixture.hpp"

#include <gtest/gtest.h>

namespace aedst::crash {
namespace {

class ConsentStoreTest : public test_support::TempDirTest {};

TEST_F(ConsentStoreTest, DefaultsToUnknownWhenNothingIsStored) {
    const FileConsentStore store{root_ / "consent"};
    EXPECT_EQ(store.state(), ConsentState::Unknown);
}

TEST_F(ConsentStoreTest, PersistsGrantedAndDeniedAcrossInstances) {
    {
        FileConsentStore store{root_ / "nested" / "consent"};
        ASSERT_TRUE(store.setState(ConsentState::Granted).has_value());
        EXPECT_EQ(store.state(), ConsentState::Granted);
    }
    FileConsentStore reopened{root_ / "nested" / "consent"};
    EXPECT_EQ(reopened.state(), ConsentState::Granted);
    ASSERT_TRUE(reopened.setState(ConsentState::Denied).has_value());
    EXPECT_EQ(reopened.state(), ConsentState::Denied);
}

TEST_F(ConsentStoreTest, UnknownClearsTheDecision) {
    FileConsentStore store{root_ / "consent"};
    ASSERT_TRUE(store.setState(ConsentState::Granted).has_value());
    ASSERT_TRUE(store.setState(ConsentState::Unknown).has_value());
    EXPECT_EQ(store.state(), ConsentState::Unknown);
    // Clearing twice is fine.
    EXPECT_TRUE(store.setState(ConsentState::Unknown).has_value());
}

TEST_F(ConsentStoreTest, GarbageOrOversizeFilesReadAsUnknown) {
    writeFile(root_ / "consent", "yes please");
    EXPECT_EQ(FileConsentStore{root_ / "consent"}.state(), ConsentState::Unknown);
    writeFile(root_ / "consent", std::string(1000, 'g'));
    EXPECT_EQ(FileConsentStore{root_ / "consent"}.state(), ConsentState::Unknown);
    writeFile(root_ / "consent", "  granted \r\n");
    EXPECT_EQ(FileConsentStore{root_ / "consent"}.state(), ConsentState::Granted);
}

} // namespace
} // namespace aedst::crash
