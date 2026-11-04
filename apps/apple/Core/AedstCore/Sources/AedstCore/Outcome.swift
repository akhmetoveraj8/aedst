/// `Result<Success, AedstError>` under a name that reads the same across
/// every client in the monorepo (`Outcome` in Android's `core/common`).
public typealias Outcome<Success> = Result<Success, AedstError>

extension Result where Failure == AedstError {
    public var value: Success? {
        if case .success(let value) = self { value } else { nil }
    }

    public var error: AedstError? {
        if case .failure(let error) = self { error } else { nil }
    }
}
