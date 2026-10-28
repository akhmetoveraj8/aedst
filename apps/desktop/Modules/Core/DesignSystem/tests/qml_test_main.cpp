// QtQuickTest runner for the design system: tst_designsystem.qml instantiates every Aedst* component and checks the
// behaviour added with the accessibility work. The only native singleton the module needs is ThemeController (real
// class).
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QQmlEngine>
#include <QtQuickTest>

namespace {

class Setup final : public QObject {
    Q_OBJECT

public slots:

    void qmlEngineAvailable(QQmlEngine* /*engine*/) {
        aedst::qmlsupport::SingletonSlot<aedst::designsystem::ThemeController>::provide(&theme_);
    }

private:
    aedst::designsystem::ThemeController theme_;
};

} // namespace

QUICK_TEST_MAIN_WITH_SETUP(tst_designsystem, Setup)

#include "qml_test_main.moc"
