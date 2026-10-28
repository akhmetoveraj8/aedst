#include "Data/task_outbox_handlers.hpp"

#include <QByteArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QString>

#include <chrono>
#include <cstdint>
#include <utility>

namespace aedst::feature::tasks {
namespace {

[[nodiscard]] std::optional<QJsonObject> parseObject(const std::string& payload) {
    QJsonParseError error{};
    const QJsonDocument document = QJsonDocument::fromJson(QByteArray::fromStdString(payload), &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) {
        return std::nullopt;
    }
    return document.object();
}

[[nodiscard]] std::string compact(const QJsonObject& object) {
    return QJsonDocument(object).toJson(QJsonDocument::Compact).toStdString();
}

} // namespace

std::string taskCreatePayload(const NewTask& task) {
    QJsonObject object{{"title", QString::fromStdString(task.title)},
                       {"description", QString::fromStdString(task.description)},
                       {"priority", static_cast<int>(task.priority)}};
    if (task.dueDate) {
        const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(task.dueDate->time_since_epoch());
        object.insert("dueDateMs", static_cast<double>(ms.count()));
    }
    return compact(object);
}

std::string taskUpdatePayload(const std::string& taskId, bool done) {
    return compact(QJsonObject{{"id", QString::fromStdString(taskId)}, {"done", done}});
}

std::optional<NewTask> parseTaskCreatePayload(const std::string& payload) {
    const auto object = parseObject(payload);
    if (!object || !object->value("title").isString()) {
        return std::nullopt;
    }
    NewTask task;
    task.title = object->value("title").toString().toStdString();
    task.description = object->value("description").toString().toStdString();
    const int priority = object->value("priority").toInt(static_cast<int>(TaskPriority::Medium));
    task.priority = priority >= 1 && priority <= 4 ? static_cast<TaskPriority>(priority) : TaskPriority::Medium;
    if (object->value("dueDateMs").isDouble()) {
        task.dueDate =
            std::chrono::system_clock::time_point{std::chrono::duration_cast<std::chrono::system_clock::duration>(
                std::chrono::milliseconds{static_cast<std::int64_t>(object->value("dueDateMs").toDouble())})};
    }
    return task;
}

std::optional<TaskUpdate> parseTaskUpdatePayload(const std::string& payload) {
    const auto object = parseObject(payload);
    if (!object || !object->value("id").isString() || !object->value("done").isBool()) {
        return std::nullopt;
    }
    return TaskUpdate{.id = object->value("id").toString().toStdString(), .done = object->value("done").toBool()};
}

TaskCreateOutboxHandler::TaskCreateOutboxHandler(std::shared_ptr<TaskRepository> repository)
    : repository_(std::move(repository)) {}

void TaskCreateOutboxHandler::deliver(const outbox::OutboxDelivery& delivery, outbox::DeliveryCompletion done) {
    auto task = parseTaskCreatePayload(delivery.item.payload);
    if (!task) {
        done(outbox::DeliveryResult::permanent("Payload"));
        return;
    }
    task->clientRequestId = delivery.idempotencyKey;
    repository_->create(*task, [done = std::move(done)](core::Outcome<Task> result) {
        done(result ? outbox::DeliveryResult::delivered() : outbox::DeliveryResult::fromError(result.error()));
    });
}

TaskUpdateOutboxHandler::TaskUpdateOutboxHandler(std::shared_ptr<TaskRepository> repository)
    : repository_(std::move(repository)) {}

void TaskUpdateOutboxHandler::deliver(const outbox::OutboxDelivery& delivery, outbox::DeliveryCompletion done) {
    const auto update = parseTaskUpdatePayload(delivery.item.payload);
    if (!update || isLocalTaskId(update->id)) {
        done(outbox::DeliveryResult::permanent("Payload"));
        return;
    }
    repository_->setDone(
        update->id, update->done, delivery.idempotencyKey, [done = std::move(done)](core::Outcome<Task> result) {
            done(result ? outbox::DeliveryResult::delivered() : outbox::DeliveryResult::fromError(result.error()));
        });
}

} // namespace aedst::feature::tasks
