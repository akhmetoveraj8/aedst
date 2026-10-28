#include "Domain/create_task_use_case.hpp"

#include <string>
#include <string_view>
#include <utility>

namespace aedst::feature::tasks {
namespace {

[[nodiscard]] std::string trimmed(std::string_view text) {
    constexpr std::string_view kWhitespace = " \t\r\n\v\f";
    const auto first = text.find_first_not_of(kWhitespace);
    if (first == std::string_view::npos) {
        return {};
    }
    const auto last = text.find_last_not_of(kWhitespace);
    return std::string(text.substr(first, last - first + 1));
}

/// Code points in valid UTF-8 = bytes that are not continuation bytes (10xxxxxx).
[[nodiscard]] std::size_t codePoints(std::string_view text) {
    std::size_t count = 0;
    for (const char c : text) {
        if ((static_cast<unsigned char>(c) & 0xC0U) != 0x80U) {
            ++count;
        }
    }
    return count;
}

} // namespace

CreateTaskUseCase::CreateTaskUseCase(std::shared_ptr<TaskRepository> repository) : repository_(std::move(repository)) {}

void CreateTaskUseCase::execute(NewTask input, core::Completion<Task> done) {
    if (auto error = normalizeAndValidate(input)) {
        done(core::fail(std::move(*error)));
        return;
    }
    repository_->create(input, std::move(done));
}

std::optional<core::Error> CreateTaskUseCase::normalizeAndValidate(NewTask& task) {
    task.title = trimmed(task.title);
    task.description = trimmed(task.description);
    if (task.title.empty()) {
        return core::Error::invalidInput("Title is required");
    }
    if (codePoints(task.title) > kMaxTitleChars) {
        return core::Error::invalidInput("Title must be at most 200 characters");
    }
    if (codePoints(task.description) > kMaxDescriptionChars) {
        return core::Error::invalidInput("Description must be at most 4000 characters");
    }
    if (task.priority == TaskPriority::Unspecified) {
        task.priority = TaskPriority::Medium;
    }
    return std::nullopt;
}

} // namespace aedst::feature::tasks
