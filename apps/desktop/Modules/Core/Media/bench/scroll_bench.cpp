// Scroll-smoothness benchmark for the media grid (the heaviest list in the app: async image tiles).
//
// What it does: loads the real MediaGrid (Aedst.Media) over a synthetic 5 000-row model whose thumbnails come from an
// in-process async image provider (so the Image -> decode thread -> texture path is exercised without a server), then
// scrolls the grid at constant speed for kFrames frames and records the time between consecutive frameSwapped signals.
// The result is one JSON line on stdout:
//
//   {"benchmark":"media_grid_scroll","frames":300,"p50_ms":6.1,"p95_ms":9.8,"p99_ms":14.2,"max_ms":21.0,
//    "dropped_over_20ms":2,"rss_mib":143.2}
//
// and the exit code is non-zero when a budget given with --budget-p95-ms / --budget-p99-ms / --budget-rss-mib is
// exceeded. scripts/perf/run-perf.mjs runs this and compares with perf/budgets.json.
//
// Needs a real window system for meaningful frame times (the offscreen platform with the software backend only
// verifies that it runs). Build with -DAEDST_BUILD_BENCHMARKS=ON, Release.
#include "aedst/designsystem/theme_controller.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QAbstractListModel>
#include <QColor>
#include <QCommandLineParser>
#include <QElapsedTimer>
#include <QGuiApplication>
#include <QImage>
#include <QQmlComponent>
#include <QQmlContext>
#include <QQmlEngine>
#include <QQuickImageProvider>
#include <QQuickItem>
#include <QQuickWindow>
#include <QTimer>
#include <QUrl>

#include <algorithm>
#include <cstdio>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
// psapi.h needs windows.h first
#include <psapi.h>
#elif defined(__linux__)
#include <QFile>
#endif

namespace {

constexpr int kRows = 5000;
constexpr int kFrames = 300;
constexpr double kScrollPixelsPerFrame = 24.0;

/// Same roles as aedst::media::MediaListModel, which is what MediaGrid's delegate declares as required properties.
class SyntheticTiles final : public QAbstractListModel {
    Q_OBJECT

public:
    enum Role {
        MediaId = Qt::UserRole + 1,
        Kind,
        Status,
        ThumbnailSource,
        FileName,
        FailureReason
    };

    [[nodiscard]] int rowCount(const QModelIndex& parent = {}) const override { return parent.isValid() ? 0 : kRows; }

    [[nodiscard]] QVariant data(const QModelIndex& index, int role) const override {
        if (!index.isValid() || index.row() >= kRows) {
            return {};
        }
        switch (role) {
        case MediaId:
            return QString::number(index.row());
        case Kind:
            return index.row() % 7 == 0 ? QStringLiteral("video") : QStringLiteral("image");
        case Status:
            return QStringLiteral("ready");
        case ThumbnailSource:
            return QUrl(QStringLiteral("image://perf/%1").arg(index.row()));
        case FileName:
            return QStringLiteral("photo-%1.jpg").arg(index.row());
        case FailureReason:
            return QString();
        default:
            return {};
        }
    }

    [[nodiscard]] QHash<int, QByteArray> roleNames() const override {
        return {{MediaId, "mediaId"},   {Kind, "kind"},
                {Status, "status"},     {ThumbnailSource, "thumbnailSource"},
                {FileName, "fileName"}, {FailureReason, "failureReason"}};
    }
};

/// Solid-colour tiles decoded on the QML image thread, like the real provider's output (a QImage at the requested
/// size).
class PerfImageProvider final : public QQuickImageProvider {
public:
    PerfImageProvider() : QQuickImageProvider(QQuickImageProvider::Image) {}

    QImage requestImage(const QString& id, QSize* size, const QSize& requestedSize) override {
        const QSize wanted = requestedSize.isValid() && !requestedSize.isEmpty() ? requestedSize : QSize(140, 140);
        QImage image(wanted, QImage::Format_RGBA8888_Premultiplied);
        const int seed = id.toInt();
        image.fill(QColor::fromHsv((seed * 37) % 360, 120, 200));
        if (size != nullptr) {
            *size = wanted;
        }
        return image;
    }
};

double percentile(std::vector<double> sorted, double fraction) {
    if (sorted.empty()) {
        return 0.0;
    }
    std::sort(sorted.begin(), sorted.end());
    const auto index = static_cast<std::size_t>(fraction * static_cast<double>(sorted.size() - 1) + 0.5);
    return sorted[std::min(index, sorted.size() - 1)];
}

double residentMiB() {
#if defined(_WIN32)
    PROCESS_MEMORY_COUNTERS counters{};
    if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters)) != 0) {
        return static_cast<double>(counters.WorkingSetSize) / (1024.0 * 1024.0);
    }
#elif defined(__linux__)
    QFile status(QStringLiteral("/proc/self/status"));
    if (status.open(QIODevice::ReadOnly)) {
        while (!status.atEnd()) {
            const QByteArray line = status.readLine();
            if (line.startsWith("VmRSS:")) {
                return line.mid(6).trimmed().split(' ').first().toDouble() / 1024.0; // kB -> MiB
            }
        }
    }
#endif
    return 0.0;
}

} // namespace

int main(int argc, char* argv[]) {
    QGuiApplication app(argc, argv);

    QCommandLineParser parser;
    const QCommandLineOption p95("budget-p95-ms", "Fail when the 95th percentile frame time exceeds this.", "ms", "0");
    const QCommandLineOption p99("budget-p99-ms", "Fail when the 99th percentile frame time exceeds this.", "ms", "0");
    const QCommandLineOption rss("budget-rss-mib", "Fail when the resident memory after the run exceeds this.", "mib",
                                 "0");
    parser.addOptions({p95, p99, rss});
    parser.process(app);

    aedst::designsystem::ThemeController theme;
    aedst::qmlsupport::SingletonSlot<aedst::designsystem::ThemeController>::provide(&theme);

    QQmlEngine engine;
    engine.addImageProvider(QStringLiteral("perf"), new PerfImageProvider); // owned by the engine
    SyntheticTiles tiles;
    engine.rootContext()->setContextProperty(QStringLiteral("tiles"), &tiles);

    QQmlComponent component(&engine);
    component.setData(R"(
        import QtQuick
        import Aedst.Media
        Item {
            width: 1280; height: 800
            property alias grid: mediaGrid
            MediaGrid { id: mediaGrid; anchors.fill: parent; model: tiles }
        }
    )",
                      QUrl(QStringLiteral("qrc:/perf/ScrollScene.qml")));
    auto* scene = qobject_cast<QQuickItem*>(component.create());
    if (scene == nullptr) {
        std::fprintf(stderr, "cannot create the scene: %s\n", qPrintable(component.errorString()));
        return 2;
    }

    QQuickWindow window;
    window.resize(1280, 800);
    scene->setParentItem(window.contentItem());
    window.show();

    auto* grid = scene->property("grid").value<QQuickItem*>();
    std::vector<double> frameMs;
    frameMs.reserve(kFrames);
    QElapsedTimer sinceLast;
    bool measuring = false;

    QObject::connect(&window, &QQuickWindow::frameSwapped, &app, [&]() {
        if (!measuring) {
            return;
        }
        if (sinceLast.isValid()) {
            frameMs.push_back(static_cast<double>(sinceLast.nsecsElapsed()) / 1.0e6);
        }
        sinceLast.restart();
        const double y = grid->property("contentY").toDouble();
        grid->setProperty("contentY", y + kScrollPixelsPerFrame); // constant-speed scroll, one step per frame
        if (static_cast<int>(frameMs.size()) >= kFrames) {
            measuring = false;
            QCoreApplication::quit();
        }
    });

    // Let the first screenful settle (first frame, first image decodes) before measuring.
    QTimer::singleShot(1500, &app, [&]() {
        measuring = true;
        window.update();
    });
    // A stalled run (no frames at all) must not hang CI.
    QTimer::singleShot(120'000, &app, []() { QCoreApplication::exit(3); });

    const int code = QCoreApplication::exec();
    if (code != 0 || frameMs.size() < static_cast<std::size_t>(kFrames)) {
        std::fprintf(stderr, "benchmark did not finish (exit %d, %zu frames)\n", code, frameMs.size());
        return code != 0 ? code : 3;
    }

    const double p50v = percentile(frameMs, 0.50);
    const double p95v = percentile(frameMs, 0.95);
    const double p99v = percentile(frameMs, 0.99);
    const double maxv = *std::max_element(frameMs.begin(), frameMs.end());
    const auto dropped =
        static_cast<int>(std::count_if(frameMs.begin(), frameMs.end(), [](double v) { return v > 20.0; }));
    const double memory = residentMiB();
    std::printf("{\"benchmark\":\"media_grid_scroll\",\"frames\":%d,\"p50_ms\":%.2f,\"p95_ms\":%.2f,\"p99_ms\":%.2f,"
                "\"max_ms\":%.2f,\"dropped_over_20ms\":%d,\"rss_mib\":%.1f}\n",
                kFrames, p50v, p95v, p99v, maxv, dropped, memory);

    int failures = 0;
    const auto check = [&failures](const char* name, double value, double budget) {
        if (budget > 0.0 && value > budget) {
            std::fprintf(stderr, "BUDGET EXCEEDED: %s = %.2f > %.2f\n", name, value, budget);
            ++failures;
        }
    };
    check("p95_ms", p95v, parser.value(p95).toDouble());
    check("p99_ms", p99v, parser.value(p99).toDouble());
    check("rss_mib", memory, parser.value(rss).toDouble());
    return failures == 0 ? 0 : 1;
}

#include "scroll_bench.moc"
