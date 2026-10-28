#include "aedst/designsystem/translation_loader.hpp"

#include "aedst/designsystem/language_resolver.hpp"

#include <QCoreApplication>
#include <QGuiApplication>
#include <QLibraryInfo>
#include <QLocale>
#include <QTranslator>

#include <string>
#include <utility>
#include <vector>

namespace aedst::designsystem {
namespace {

std::vector<std::string> toStdList(const QStringList& list) {
    std::vector<std::string> out;
    out.reserve(static_cast<std::size_t>(list.size()));
    for (const QString& item : list) {
        out.push_back(item.toStdString());
    }
    return out;
}

} // namespace

TranslationLoader::TranslationLoader(QStringList catalogs, QObject* parent)
    : QObject(parent), catalogs_(std::move(catalogs)) {}

TranslationLoader::~TranslationLoader() {
    removeTranslators();
}

void TranslationLoader::installSystemLanguage() {
    setLanguage(
        QString::fromStdString(resolveLanguage(toStdList(QLocale::system().uiLanguages()), supportedLanguages())));
}

QString TranslationLoader::setLanguage(const QString& language) {
    const QString resolved = QString::fromStdString(resolveLanguage({language.toStdString()}, supportedLanguages()));
    if (resolved == language_) {
        return resolved;
    }

    removeTranslators();
    // English is the source language of every qsTr(); the *_en catalogs exist only
    // so lupdate has a target, and loading them is harmless.
    for (const QString& catalog : std::as_const(catalogs_)) {
        auto* translator = new QTranslator(this);
        if (translator->load(QStringLiteral(":/i18n/%1_%2.qm").arg(catalog, resolved))) {
            QCoreApplication::installTranslator(translator);
            translators_.append(translator);
        } else {
            delete translator;
        }
    }

    loadQtTranslations(resolved);

    language_ = resolved;
    const QLocale locale(resolved);
    QLocale::setDefault(locale);
    if (qobject_cast<QGuiApplication*>(QCoreApplication::instance()) != nullptr) {
        QGuiApplication::setLayoutDirection(isRightToLeftLanguage(resolved.toStdString()) ? Qt::RightToLeft
                                                                                          : Qt::LeftToRight);
    }
    emit languageChanged();
    return resolved;
}

QString TranslationLoader::language() const {
    return language_;
}

void TranslationLoader::loadQtTranslations(const QString& language) {
    // Qt's own strings (standard dialog buttons, text-edit context menu, QML Controls) ship as qtbase_<lang>.qm and
    // qtdeclarative_<lang>.qm. They are found next to the executable (deployed `translations/`, what windeployqt and
    // the Linux bundles produce) or in the Qt installation. Qt has no catalog for every language (for example Tajik):
    // a missing one is simply skipped and those strings stay English.
    const QStringList directories{QCoreApplication::applicationDirPath() + QStringLiteral("/translations"),
                                  QLibraryInfo::path(QLibraryInfo::TranslationsPath)};
    for (const QString& base : {QStringLiteral("qtbase"), QStringLiteral("qtdeclarative")}) {
        auto* translator = new QTranslator(this);
        bool loaded = false;
        for (const QString& directory : directories) {
            if (translator->load(QStringLiteral("%1_%2").arg(base, language), directory)) {
                loaded = true;
                break;
            }
        }
        if (loaded) {
            QCoreApplication::installTranslator(translator);
            translators_.append(translator);
        } else {
            delete translator;
        }
    }
}

void TranslationLoader::removeTranslators() {
    for (QTranslator* translator : std::as_const(translators_)) {
        QCoreApplication::removeTranslator(translator);
        delete translator;
    }
    translators_.clear();
}

} // namespace aedst::designsystem
