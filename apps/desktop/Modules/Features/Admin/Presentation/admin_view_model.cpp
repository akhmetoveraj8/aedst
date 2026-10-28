#include "Presentation/admin_view_model.hpp"

#include "Domain/admin_repository.hpp"
#include "aedst/analytics/analytics_tracker.hpp"
#include "aedst/core/error_sink.hpp"

#include <QDateTime>
#include <QPointer>
#include <QTimeZone>

#include <utility>

namespace aedst::feature::admin {
namespace {

[[nodiscard]] QDateTime toLocal(const google::protobuf::Timestamp& ts) {
    return QDateTime::fromSecsSinceEpoch(ts.seconds(), QTimeZone::UTC).toLocalTime();
}

/// Same rule as BroadcastNotificationRequest.link (`^(/[^/].*)?$`): empty or a
/// relative path that is not scheme-relative.
[[nodiscard]] bool isValidLink(const QString& link) {
    return link.isEmpty() || (link.size() >= 2 && link.front() == QLatin1Char('/') && link.at(1) != QLatin1Char('/'));
}

} // namespace

AdminViewModel::AdminViewModel(std::shared_ptr<AdminRepository> repository, std::shared_ptr<core::ErrorSink> errors,
                               std::shared_ptr<analytics::AnalyticsTracker> analytics, QObject* parent)
    : QObject(parent),
      repository_(std::move(repository)),
      errors_(std::move(errors)),
      analytics_(std::move(analytics)),
      users_({"userId", "email", "displayName", "createdAt", "taskCount"}),
      auditLog_({"entryId", "actorId", "action", "targetKind", "targetId", "reason", "createdAt"}) {
    queryDebounce_.setSingleShot(true);
    queryDebounce_.setInterval(kQueryDebounceMs);
    connect(&queryDebounce_, &QTimer::timeout, this, &AdminViewModel::loadUsers);
}

void AdminViewModel::setUserQuery(const QString& query) {
    if (query == userQuery_) {
        return;
    }
    userQuery_ = query;
    emit userQueryChanged();
    queryDebounce_.start();
}

void AdminViewModel::reload() {
    if (!errorMessage_.isEmpty()) {
        errorMessage_.clear();
        emit errorMessageChanged();
    }
    loadOverview();
    loadUsers();
    loadAuditLog();
}

void AdminViewModel::loadOverview() {
    begin();
    const quint64 seq = seq_;
    QPointer<AdminViewModel> guard(this);
    repository_->overview([guard, seq](network::ApiResult<adminv1::GetOverviewResponse> result) {
        if (!guard || seq != guard->seq_) {
            return;
        }
        guard->end();
        if (!result) {
            guard->handleError(result.error().toCoreError(), "admin.overview");
            return;
        }
        guard->overview_ = QVariantMap{
            {QStringLiteral("usersTotal"), static_cast<qlonglong>(result->users_total())},
            {QStringLiteral("tasksTotal"), static_cast<qlonglong>(result->tasks_total())},
            {QStringLiteral("tasksDone"), static_cast<qlonglong>(result->tasks_done())},
            {QStringLiteral("tasksOverdue"), static_cast<qlonglong>(result->tasks_overdue())},
            {QStringLiteral("mediaTotal"), static_cast<qlonglong>(result->media_total())},
            {QStringLiteral("mediaBytes"), static_cast<qlonglong>(result->media_bytes())},
            {QStringLiteral("pushDevices"), static_cast<qlonglong>(result->push_devices())},
            {QStringLiteral("outboxLagSeconds"), static_cast<qlonglong>(result->outbox_lag_seconds())},
            {QStringLiteral("jobsPending"), static_cast<qlonglong>(result->jobs_pending())},
        };
        emit guard->overviewChanged();
    });
}

void AdminViewModel::loadUsers() {
    queryDebounce_.stop();
    adminv1::ListUsersRequest request;
    request.set_query(userQuery_.trimmed().left(200).toStdString());
    request.set_page_size(100);
    begin();
    const quint64 seq = seq_;
    QPointer<AdminViewModel> guard(this);
    repository_->listUsers(request, [guard, seq](network::ApiResult<adminv1::ListUsersResponse> result) {
        if (!guard || seq != guard->seq_) {
            return;
        }
        guard->end();
        if (!result) {
            guard->handleError(result.error().toCoreError(), "admin.users");
            return;
        }
        QList<QVariantList> rows;
        for (const auto& user : result->users()) {
            rows.append(QVariantList{QString::fromStdString(user.id()), QString::fromStdString(user.email()),
                                     QString::fromStdString(user.display_name()), toLocal(user.created_at()),
                                     static_cast<qlonglong>(user.task_count())});
        }
        guard->users_.setRows(std::move(rows));
    });
}

void AdminViewModel::loadAuditLog() {
    adminv1::ListAuditLogRequest request;
    request.set_page_size(50);
    begin();
    const quint64 seq = seq_;
    QPointer<AdminViewModel> guard(this);
    repository_->listAuditLog(request, [guard, seq](network::ApiResult<adminv1::ListAuditLogResponse> result) {
        if (!guard || seq != guard->seq_) {
            return;
        }
        guard->end();
        if (!result) {
            guard->handleError(result.error().toCoreError(), "admin.audit");
            return;
        }
        QList<QVariantList> rows;
        for (const auto& entry : result->entries()) {
            rows.append(QVariantList{QString::fromStdString(entry.id()), QString::fromStdString(entry.actor_id()),
                                     QString::fromStdString(entry.action()),
                                     QString::fromStdString(entry.target_kind()),
                                     QString::fromStdString(entry.target_id()), QString::fromStdString(entry.reason()),
                                     toLocal(entry.created_at())});
        }
        guard->auditLog_.setRows(std::move(rows));
    });
}

void AdminViewModel::broadcast(const QString& title, const QString& body, const QString& link, const QString& userId) {
    const QString trimmedTitle = title.trimmed();
    if (trimmedTitle.isEmpty() || trimmedTitle.size() > 120 || body.size() > 1000 || !isValidLink(link.trimmed())) {
        emit broadcastFailed(tr("Check the title (1-120 characters), body (up to 1000) and link (a relative path)."));
        return;
    }
    if (isBroadcasting_) {
        return;
    }
    adminv1::BroadcastNotificationRequest request;
    request.set_title(trimmedTitle.toStdString());
    request.set_body(body.toStdString());
    request.set_link(link.trimmed().toStdString());
    request.set_user_id(userId.trimmed().toStdString());
    isBroadcasting_ = true;
    emit isBroadcastingChanged();
    QPointer<AdminViewModel> guard(this);
    repository_->broadcast(request, [guard](network::ApiResult<adminv1::BroadcastNotificationResponse> result) {
        if (!guard) {
            return;
        }
        guard->isBroadcasting_ = false;
        emit guard->isBroadcastingChanged();
        if (!result) {
            const core::Error error = result.error().toCoreError();
            if (!guard->handleError(error, "admin.broadcast")) {
                emit guard->broadcastFailed(QString::fromStdString(error.message));
            }
            return;
        }
        if (guard->analytics_) {
            guard->analytics_->track(analytics::events::kAdminBroadcastSent, {});
        }
        emit guard->broadcastSent(static_cast<qint64>(result->recipients()));
        guard->loadAuditLog(); // the broadcast wrote an audit entry
    });
}

void AdminViewModel::clear() {
    ++seq_;
    pending_ = 0;
    emit isLoadingChanged();
    overview_.clear();
    emit overviewChanged();
    users_.setRows({});
    auditLog_.setRows({});
    if (forbidden_) {
        forbidden_ = false;
        emit forbiddenChanged();
    }
}

void AdminViewModel::begin() {
    if (pending_++ == 0) {
        emit isLoadingChanged();
    }
}

void AdminViewModel::end() {
    if (pending_ > 0 && --pending_ == 0) {
        emit isLoadingChanged();
    }
}

bool AdminViewModel::handleError(const core::Error& error, std::string_view context) {
    if (error.code == core::ErrorCode::Forbidden) {
        if (!forbidden_) {
            forbidden_ = true;
            emit forbiddenChanged();
        }
        if (errors_) {
            errors_->report(error, context, core::ErrorVisibility::Silent);
        }
        return true;
    }
    if (errorMessage_.isEmpty()) {
        errorMessage_ = QString::fromStdString(error.message);
        emit errorMessageChanged();
    }
    if (errors_) {
        errors_->report(error, context);
    }
    return false;
}

} // namespace aedst::feature::admin
