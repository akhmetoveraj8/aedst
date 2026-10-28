#include "aedst/platform/notification_service.hpp"
#include "aedst/platform/toast_xml.hpp"

#include <gtest/gtest.h>

#include <string>
#include <vector>

namespace aedst::platform {
namespace {

bool contains(const std::wstring& text, const std::wstring& part) {
    return text.find(part) != std::wstring::npos;
}

TEST(ToastXmlTest, AnInformationalToastHasTextAndNoActivation) {
    const std::wstring xml = buildToastXml({.title = "Build finished", .body = "All green"});
    EXPECT_TRUE(contains(xml, L"<toast><visual>")) << "no launch attribute without a link";
    EXPECT_TRUE(contains(xml, L"<text>Build finished</text><text>All green</text>"));
    EXPECT_FALSE(contains(xml, L"<actions>"));
    EXPECT_FALSE(contains(xml, L"launch="));
}

TEST(ToastXmlTest, ALinkAddsLaunchArgumentsAndAnActionButton) {
    const std::wstring xml = buildToastXml({.title = "Task done", .body = "Deploy", .link = "/tasks/42"});
    EXPECT_TRUE(contains(xml, L"activationType=\"foreground\" launch=\"/tasks/42\""));
    EXPECT_TRUE(contains(xml, L"<action activationType=\"foreground\" content=\"Open\" arguments=\"/tasks/42\"/>"));
}

TEST(ToastXmlTest, TheActionLabelIsCustomisableAndEscaped) {
    const std::wstring xml = buildToastXml({.title = "t", .link = "/x", .actionLabel = "View <now>"});
    EXPECT_TRUE(contains(xml, L"content=\"View &lt;now&gt;\""));
}

TEST(ToastXmlTest, ServerTextCannotInjectMarkup) {
    const std::wstring xml = buildToastXml({.title = "<script>alert(1)</script>", .body = "a & b \"quoted\""});
    EXPECT_FALSE(contains(xml, L"<script>"));
    EXPECT_TRUE(contains(xml, L"&lt;script&gt;"));
    EXPECT_TRUE(contains(xml, L"a &amp; b &quot;quoted&quot;"));
}

TEST(ToastXmlTest, ControlCharactersThatBreakXmlAreRemoved) {
    const std::wstring xml = buildToastXml({.title = std::string("A\x01") + "B\x1f" + "C", .body = "line1\nline2"});
    EXPECT_TRUE(contains(xml, L"<text>ABC</text>"));
    EXPECT_TRUE(contains(xml, L"line1\nline2")) << "newlines are valid XML and kept";
}

TEST(ToastXmlTest, OverlongTextIsTruncated) {
    const std::wstring xml = buildToastXml({.title = std::string(5000, 'T'), .body = std::string(5000, 'B')});
    EXPECT_LT(xml.size(), 3000U);
}

TEST(ToastXmlTest, UnsafeLinksAreDroppedButTheToastStillShows) {
    for (const char* bad : {"https://evil.example/x", "//evil.example/x", "tasks/1", "/a\"b", "/a<b", "/a&b", "/a\\b",
                            "/a\nb", "javascript:alert(1)"}) {
        const std::wstring xml = buildToastXml({.title = "t", .body = "b", .link = bad});
        EXPECT_FALSE(contains(xml, L"launch=")) << bad;
        EXPECT_FALSE(contains(xml, L"<actions>")) << bad;
        EXPECT_TRUE(contains(xml, L"<text>t</text>")) << bad;
    }
}

TEST(ToastXmlTest, ActivatableLinkRules) {
    EXPECT_TRUE(isActivatableLink("/"));
    EXPECT_TRUE(isActivatableLink("/tasks/1f0c"));
    EXPECT_TRUE(isActivatableLink("/notifications?filter=unread"));
    EXPECT_FALSE(isActivatableLink(""));
    EXPECT_FALSE(isActivatableLink("//host"));
    EXPECT_FALSE(isActivatableLink("/" + std::string(kMaxToastLinkChars, 'a'))) << "one char over the limit";
    EXPECT_TRUE(isActivatableLink("/" + std::string(kMaxToastLinkChars - 1, 'a')));
}

// --- NotificationService defaults ----------------------------------------------------------------

class RecordingService final : public NotificationService {
public:
    [[nodiscard]] bool isAvailable() const override { return true; }

    void show(std::string_view title, std::string_view body, NotificationSeverity severity) override {
        shown.push_back(std::string(title) + "|" + std::string(body) + "|" + std::string(toString(severity)));
    }

    void activate(const std::string& link) { notifyActivated(link); }

    std::vector<std::string> shown;
};

TEST(NotificationServiceTest, ShowRequestDefaultsToThePlainShow) {
    RecordingService service;
    service.showRequest({.title = "T", .body = "B", .severity = NotificationSeverity::Warning, .link = "/x"});
    ASSERT_EQ(service.shown.size(), 1U);
    EXPECT_EQ(service.shown.front(), "T|B|warning");
}

TEST(NotificationServiceTest, ActivationReachesTheHandlerOnlyForNonEmptyLinks) {
    RecordingService service;
    std::vector<std::string> links;
    service.setActivationHandler([&links](const std::string& link) { links.push_back(link); });

    service.activate("/tasks/9");
    service.activate("");

    EXPECT_EQ(links, (std::vector<std::string>{"/tasks/9"}));
}

TEST(NotificationServiceTest, ActivationWithoutAHandlerIsHarmless) {
    RecordingService service;
    service.activate("/tasks/9");
    SUCCEED();
}

} // namespace
} // namespace aedst::platform
