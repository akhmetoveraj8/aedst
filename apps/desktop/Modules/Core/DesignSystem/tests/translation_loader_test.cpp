#include "aedst/designsystem/language_resolver.hpp"
#include "aedst/designsystem/translation_loader.hpp"

#include <QGuiApplication>
#include <QLocale>
#include <QSignalSpy>
#include <QTest>

#include <string>
#include <vector>

namespace aedst::designsystem {

class TranslationLoaderTest : public QObject {
    Q_OBJECT

private slots:

    void resolvesFirstSupportedUiLanguage() {
        const std::vector<std::string> available{"en", "ru", "ar", "tg", "uz"};
        QCOMPARE(QString::fromStdString(resolveLanguage({"ru-RU", "en-US"}, available)), QStringLiteral("ru"));
        QCOMPARE(QString::fromStdString(resolveLanguage({"de-DE", "uz-Latn-UZ"}, available)), QStringLiteral("uz"));
        QCOMPARE(QString::fromStdString(resolveLanguage({"TG_tj"}, available)), QStringLiteral("tg"));
        QCOMPARE(QString::fromStdString(resolveLanguage({"ar"}, available)), QStringLiteral("ar"));
    }

    void fallsBackToEnglish() {
        const std::vector<std::string> available{"en", "ru"};
        QCOMPARE(QString::fromStdString(resolveLanguage({}, available)), QStringLiteral("en"));
        QCOMPARE(QString::fromStdString(resolveLanguage({"fr-FR", "ja"}, available)), QStringLiteral("en"));
        QCOMPARE(QString::fromStdString(resolveLanguage({""}, available)), QStringLiteral("en"));
        QCOMPARE(QString::fromStdString(resolveLanguage({"ar"}, available)), QStringLiteral("en"));
    }

    void detectsRightToLeftLanguages() {
        QVERIFY(isRightToLeftLanguage("ar"));
        QVERIFY(isRightToLeftLanguage("ar-SA"));
        QVERIFY(!isRightToLeftLanguage("ru-RU"));
        QVERIFY(!isRightToLeftLanguage("uz-Latn"));
    }

    void setLanguageAppliesLocaleAndLayoutDirection() {
        TranslationLoader loader({QStringLiteral("designsystem")});
        QSignalSpy changed(&loader, &TranslationLoader::languageChanged);

        QCOMPARE(loader.setLanguage(QStringLiteral("ar")), QStringLiteral("ar"));
        QCOMPARE(QGuiApplication::layoutDirection(), Qt::RightToLeft);
        QCOMPARE(changed.count(), 1);

        QCOMPARE(loader.setLanguage(QStringLiteral("ar")), QStringLiteral("ar")); // no-op
        QCOMPARE(changed.count(), 1);

        QCOMPARE(loader.setLanguage(QStringLiteral("ru-RU")), QStringLiteral("ru"));
        QCOMPARE(QGuiApplication::layoutDirection(), Qt::LeftToRight);

        QCOMPARE(loader.setLanguage(QStringLiteral("xx")), QStringLiteral("en"));
        QCOMPARE(loader.language(), QStringLiteral("en"));
        QCOMPARE(changed.count(), 3);
    }

    void cleanupTestCase() {
        QLocale::setDefault(QLocale::c());
        QGuiApplication::setLayoutDirection(Qt::LeftToRight);
    }
};

} // namespace aedst::designsystem

QTEST_MAIN(aedst::designsystem::TranslationLoaderTest)
#include "translation_loader_test.moc"
