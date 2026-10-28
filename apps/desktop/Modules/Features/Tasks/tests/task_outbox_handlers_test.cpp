#include "Data/task_outbox_handlers.hpp"

#include <gtest/gtest.h>

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace aedst::feature::tasks {
namespace {

using outbox::DeliveryResult;
using outbox::DeliveryStatus;
using outbox::OutboxDelivery;
using outbox::OutboxItem;

/// Records the calls the handlers make and answers them with a scripted outcome.
class RecordingRepository final : public TaskRepository {
public:
    void list(const TaskQuery&, core::Completion<TaskPage> done) override { done(TaskPage{}); }

    void get(const std::string&, core::Completion<Task> done) override { done(Task{}); }

    void create(const NewTask& task, core::Completion<Task> done) override {
        created.push_back(task);
        answer(std::move(done));
    }

    void complete(const std::string&, core::Completion<Task> done) override { answer(std::move(done)); }

    void reopen(const std::string&, core::Completion<Task> done) override { answer(std::move(done)); }

    void remove(const std::string&, core::Completion<void> done) override { done(core::ok()); }

    void setDone(const std::string& id, bool done, const std::string& key, core::Completion<Task> completion) override {
        updates.push_back({id, done, key});
        answer(std::move(completion));
    }

    struct Update {
        std::string id;
        bool done;
        std::string key;
    };

    std::vector<NewTask> created;
    std::vector<Update> updates;
    std::optional<core::Error> failure;

private:
    void answer(core::Completion<Task> done) const {
        done(failure ? core::Outcome<Task>(core::fail(*failure)) : core::Outcome<Task>(Task{.id = "server-id"}));
    }
};

OutboxDelivery deliveryOf(const std::string& id, const std::string& type, const std::string& payload) {
    return OutboxDelivery{.item = OutboxItem{.id = id, .type = type, .payload = payload}, .idempotencyKey = id};
}

DeliveryResult deliver(outbox::OutboxHandler& handler, const OutboxDelivery& delivery) {
    std::optional<DeliveryResult> result;
    handler.deliver(delivery, [&result](DeliveryResult r) { result = std::move(r); });
    EXPECT_TRUE(result.has_value()) << "the handler must complete";
    return result.value_or(DeliveryResult::permanent("missing"));
}

TEST(TaskOutboxPayloadTest, CreateRoundTrips) {
    const NewTask task{.title = "Write report",
                       .description = "Q3 numbers",
                       .priority = TaskPriority::High,
                       .dueDate = std::chrono::system_clock::time_point{std::chrono::milliseconds{1'700'000'123'456}}};

    const auto parsed = parseTaskCreatePayload(taskCreatePayload(task));

    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->title, "Write report");
    EXPECT_EQ(parsed->description, "Q3 numbers");
    EXPECT_EQ(parsed->priority, TaskPriority::High);
    EXPECT_EQ(parsed->dueDate, task.dueDate);
}

TEST(TaskOutboxPayloadTest, ACreateWithoutDueDateOrDescriptionStaysThatWay) {
    const auto parsed = parseTaskCreatePayload(taskCreatePayload(NewTask{.title = "x"}));

    ASSERT_TRUE(parsed.has_value());
    EXPECT_FALSE(parsed->dueDate.has_value());
    EXPECT_TRUE(parsed->description.empty());
}

TEST(TaskOutboxPayloadTest, UpdateRoundTripsAndCarriesNoOtherData) {
    const std::string payload = taskUpdatePayload("3f2c1a9e", true);

    EXPECT_EQ(payload, R"({"done":true,"id":"3f2c1a9e"})");
    const auto parsed = parseTaskUpdatePayload(payload);
    ASSERT_TRUE(parsed.has_value());
    EXPECT_EQ(parsed->id, "3f2c1a9e");
    EXPECT_TRUE(parsed->done);
}

TEST(TaskOutboxPayloadTest, MalformedPayloadsAreRejected) {
    EXPECT_FALSE(parseTaskCreatePayload("not json").has_value());
    EXPECT_FALSE(parseTaskCreatePayload("{}").has_value());
    EXPECT_FALSE(parseTaskUpdatePayload(R"({"id":"x"})").has_value());
    EXPECT_FALSE(parseTaskUpdatePayload(R"({"done":true})").has_value());
    EXPECT_FALSE(parseTaskUpdatePayload("[]").has_value());
}

TEST(TaskOutboxHandlerTest, CreateSendsTheItemIdAsTheIdempotencyKey) {
    auto repository = std::make_shared<RecordingRepository>();
    TaskCreateOutboxHandler handler(repository);

    const auto result =
        deliver(handler, deliveryOf("op-1", "task.create", taskCreatePayload(NewTask{.title = "Buy milk"})));

    EXPECT_EQ(result.status, DeliveryStatus::Delivered);
    ASSERT_EQ(repository->created.size(), 1U);
    EXPECT_EQ(repository->created[0].title, "Buy milk");
    EXPECT_EQ(repository->created[0].clientRequestId, "op-1");
}

TEST(TaskOutboxHandlerTest, UpdateSendsTheItemIdAsTheIdempotencyKey) {
    auto repository = std::make_shared<RecordingRepository>();
    TaskUpdateOutboxHandler handler(repository);

    const auto result = deliver(handler, deliveryOf("op-2", "task.update", taskUpdatePayload("t-9", false)));

    EXPECT_EQ(result.status, DeliveryStatus::Delivered);
    ASSERT_EQ(repository->updates.size(), 1U);
    EXPECT_EQ(repository->updates[0].id, "t-9");
    EXPECT_FALSE(repository->updates[0].done);
    EXPECT_EQ(repository->updates[0].key, "op-2");
}

TEST(TaskOutboxHandlerTest, FailuresAreClassifiedForTheDrainer) {
    auto repository = std::make_shared<RecordingRepository>();
    TaskCreateOutboxHandler handler(repository);
    const auto delivery = deliveryOf("op-1", "task.create", taskCreatePayload(NewTask{.title = "x"}));

    repository->failure = core::Error::unavailable("offline");
    EXPECT_EQ(deliver(handler, delivery).status, DeliveryStatus::Retryable);
    repository->failure = core::Error::invalidInput("title too long");
    EXPECT_EQ(deliver(handler, delivery).status, DeliveryStatus::Permanent);
    repository->failure = core::Error::unauthenticated("signed out");
    EXPECT_EQ(deliver(handler, delivery).status, DeliveryStatus::Blocked);
    repository->failure = core::Error::upgradeRequired("update");
    EXPECT_EQ(deliver(handler, delivery).status, DeliveryStatus::Blocked);
}

TEST(TaskOutboxHandlerTest, ABrokenPayloadOrALocalIdIsParkedWithoutCallingTheServer) {
    auto repository = std::make_shared<RecordingRepository>();
    TaskCreateOutboxHandler create(repository);
    TaskUpdateOutboxHandler update(repository);

    EXPECT_EQ(deliver(create, deliveryOf("a", "task.create", "garbage")).status, DeliveryStatus::Permanent);
    EXPECT_EQ(deliver(update, deliveryOf("b", "task.update", "garbage")).status, DeliveryStatus::Permanent);
    EXPECT_EQ(deliver(update, deliveryOf("c", "task.update", taskUpdatePayload("local:abc", true))).status,
              DeliveryStatus::Permanent);

    EXPECT_TRUE(repository->created.empty());
    EXPECT_TRUE(repository->updates.empty());
}

} // namespace
} // namespace aedst::feature::tasks
