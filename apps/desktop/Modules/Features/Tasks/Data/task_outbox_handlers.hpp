#pragma once

#include "Domain/task.hpp"
#include "Domain/task_repository.hpp"
#include "aedst/outbox/outbox_handler.hpp"

#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace aedst::feature::tasks {

/// Item types this feature contributes to the offline outbox (docs/contract/behavior/offline-outbox.json: knownTypes).
inline constexpr std::string_view kTaskCreateOutboxType = "task.create";
inline constexpr std::string_view kTaskUpdateOutboxType = "task.update";

/// Payloads are compact JSON holding only what the operation needs. No tokens, no account data: the outbox table is not
/// encrypted. The task text the user typed is the one user-content field (it cannot be delivered without it).
///   task.create  {"title": s, "description": s, "priority": 1-4, "dueDateMs": n (optional)}
///   task.update  {"id": s, "done": bool}      (complete / reopen; the only edit the desktop UI offers today)
[[nodiscard]] std::string taskCreatePayload(const NewTask& task);
[[nodiscard]] std::string taskUpdatePayload(const std::string& taskId, bool done);

/// Parsed payloads; nullopt for anything malformed or incomplete.
[[nodiscard]] std::optional<NewTask> parseTaskCreatePayload(const std::string& payload);

struct TaskUpdate {
    std::string id;
    bool done{false};
};

[[nodiscard]] std::optional<TaskUpdate> parseTaskUpdatePayload(const std::string& payload);

/// Delivers queued creates: CreateTask with the item id as Idempotency-Key.
class TaskCreateOutboxHandler final : public outbox::OutboxHandler {
public:
    explicit TaskCreateOutboxHandler(std::shared_ptr<TaskRepository> repository);

    [[nodiscard]] std::string type() const override { return std::string(kTaskCreateOutboxType); }

    void deliver(const outbox::OutboxDelivery& delivery, outbox::DeliveryCompletion done) override;

private:
    std::shared_ptr<TaskRepository> repository_;
};

/// Delivers queued complete / reopen changes with the item id as Idempotency-Key.
class TaskUpdateOutboxHandler final : public outbox::OutboxHandler {
public:
    explicit TaskUpdateOutboxHandler(std::shared_ptr<TaskRepository> repository);

    [[nodiscard]] std::string type() const override { return std::string(kTaskUpdateOutboxType); }

    void deliver(const outbox::OutboxDelivery& delivery, outbox::DeliveryCompletion done) override;

private:
    std::shared_ptr<TaskRepository> repository_;
};

} // namespace aedst::feature::tasks
