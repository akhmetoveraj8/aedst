#pragma once

#include "Presentation/admin_rows_model.hpp"
#include "aedst/core/error.hpp"
#include "aedst/qmlsupport/singleton_slot.hpp"

#include <QObject>
#include <QString>
#include <QTimer>
#include <QVariantMap>
#include <QtQml/qqmlregistration.h>

#include <memory>
#include <string>
#include <string_view>

namespace aedst::analytics {
class AnalyticsTracker;
} // namespace aedst::analytics

namespace aedst::core {
class ErrorSink;
} // namespace aedst::core

namespace aedst::feature::admin {

class AdminRepository;

/// Operator screen: overview counters, user search, audit log and a broadcast
/// form. App/ only shows the entry when the access token carries the "admin"
/// role (network::parseAccessTokenClaims); `forbidden` turns true if the server
/// still answers permission_denied (role revoked, or a forged token) - the server
/// is the authority, the client check only hides UI.
class AdminViewModel final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QVariantMap overview READ overview NOTIFY overviewChanged)
    Q_PROPERTY(QAbstractItemModel* users READ users CONSTANT)
    Q_PROPERTY(QAbstractItemModel* auditLog READ auditLog CONSTANT)
    Q_PROPERTY(QString userQuery READ userQuery WRITE setUserQuery NOTIFY userQueryChanged)
    Q_PROPERTY(bool isLoading READ isLoading NOTIFY isLoadingChanged)
    Q_PROPERTY(bool forbidden READ forbidden NOTIFY forbiddenChanged)
    Q_PROPERTY(bool isBroadcasting READ isBroadcasting NOTIFY isBroadcastingChanged)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorMessageChanged)

public:
    static AdminViewModel* create(QQmlEngine* engine, QJSEngine* script) {
        return aedst::qmlsupport::SingletonSlot<AdminViewModel>::create(engine, script);
    }

    static constexpr int kQueryDebounceMs = 300;

    AdminViewModel(std::shared_ptr<AdminRepository> repository, std::shared_ptr<core::ErrorSink> errors,
                   std::shared_ptr<analytics::AnalyticsTracker> analytics, QObject* parent = nullptr);

    [[nodiscard]] QVariantMap overview() const { return overview_; }

    [[nodiscard]] QAbstractItemModel* users() noexcept { return &users_; }

    [[nodiscard]] QAbstractItemModel* auditLog() noexcept { return &auditLog_; }

    [[nodiscard]] QString userQuery() const { return userQuery_; }

    void setUserQuery(const QString& query);

    [[nodiscard]] bool isLoading() const noexcept { return pending_ > 0; }

    [[nodiscard]] bool forbidden() const noexcept { return forbidden_; }

    [[nodiscard]] bool isBroadcasting() const noexcept { return isBroadcasting_; }

    [[nodiscard]] QString errorMessage() const { return errorMessage_; }

    Q_INVOKABLE void reload();
    /// Empty `userId` = every user. `link` must be a relative in-app path or empty.
    Q_INVOKABLE void broadcast(const QString& title, const QString& body, const QString& link, const QString& userId);
    Q_INVOKABLE void clear();

signals:
    void overviewChanged();
    void userQueryChanged();
    void isLoadingChanged();
    void forbiddenChanged();
    void isBroadcastingChanged();
    void errorMessageChanged();
    /// One-shot: broadcast accepted; `recipients` from the server.
    void broadcastSent(qint64 recipients);
    void broadcastFailed(const QString& message);

private:
    void loadOverview();
    void loadUsers();
    void loadAuditLog();
    void begin();
    void end();
    /// Returns true when the error was a permission problem (handled here).
    bool handleError(const core::Error& error, std::string_view context);

    std::shared_ptr<AdminRepository> repository_;
    std::shared_ptr<core::ErrorSink> errors_;
    std::shared_ptr<analytics::AnalyticsTracker> analytics_;

    QVariantMap overview_;
    AdminRowsModel users_;
    AdminRowsModel auditLog_;
    QTimer queryDebounce_;
    QString userQuery_;
    QString errorMessage_;
    int pending_{0};
    bool forbidden_{false};
    bool isBroadcasting_{false};
    quint64 seq_{0};
};

} // namespace aedst::feature::admin
