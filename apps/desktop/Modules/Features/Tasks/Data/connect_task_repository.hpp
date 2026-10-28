#pragma once

#include "Domain/task_repository.hpp"

#include <aedst/tasks/v1/tasks.pb.h>
#include <memory>

namespace aedst::network {
class ConnectClient;
} // namespace aedst::network

namespace aedst::feature::tasks {

namespace tasksv1 = ::aedst::tasks::v1;

/// TaskRepository over ConnectClient + the method table in Aedst::Contract. The
/// only file in this feature that knows procedure entries or protobuf types;
/// maps aedst.tasks.v1.Task <-> Domain Task and ApiError -> core::Error.
class ConnectTaskRepository final : public TaskRepository {
public:
    explicit ConnectTaskRepository(std::shared_ptr<network::ConnectClient> client);

    void list(const TaskQuery& query, core::Completion<TaskPage> done) override;
    void get(const std::string& id, core::Completion<Task> done) override;
    void create(const NewTask& task, core::Completion<Task> done) override;
    void complete(const std::string& id, core::Completion<Task> done) override;
    void reopen(const std::string& id, core::Completion<Task> done) override;
    void remove(const std::string& id, core::Completion<void> done) override;
    void setDone(const std::string& id, bool done, const std::string& idempotencyKey,
                 core::Completion<Task> completion) override;

    /// Proto -> Domain, exposed for the mapping test.
    [[nodiscard]] static Task toDomain(const tasksv1::Task& task);

private:
    std::shared_ptr<network::ConnectClient> client_;
};

} // namespace aedst::feature::tasks
