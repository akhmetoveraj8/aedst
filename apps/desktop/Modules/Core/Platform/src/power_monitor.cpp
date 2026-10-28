#include "aedst/platform/power_monitor.hpp"

#include "aedst/logging/log_categories.hpp"

namespace aedst::platform {

PowerMonitor::PowerMonitor(std::chrono::milliseconds interval, QObject* parent) : QObject(parent), detector_(interval) {
    timer_.setTimerType(Qt::VeryCoarseTimer);
    timer_.setInterval(interval);
    connect(&timer_, &QTimer::timeout, this, [this]() { tick(ResumeDetector::Clock::now()); });
}

void PowerMonitor::start() {
    if (!timer_.isActive()) {
        (void)detector_.observe(ResumeDetector::Clock::now()); // baseline, never a resume
        timer_.start();
    }
}

void PowerMonitor::stop() {
    timer_.stop();
}

void PowerMonitor::tick(ResumeDetector::Clock::time_point now) {
    if (detector_.observe(now)) {
        qCInfo(lcApp, "System resume detected; refreshing network connections");
        emit resumedFromSleep();
    }
}

} // namespace aedst::platform
