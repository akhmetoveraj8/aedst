# Naming: Server (Go, `apps/server`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

| What | Rule | Example | Why | Level |
|---|---|---|---|---|
| Package name | `lowercase`, one word, no underscores | `package tasks`, `package postgres` | Official Go style guide; the compiler accepts `tasks_service`, but `golint` and review do not | Must |
| File name | `snake_case.go`, or `lowercase.go` for a single word | `due_reminder.go`, `service_test.go` | Official Go tooling convention (`gofmt`, `go doc`) | Must |
| Exported types / functions / constants | `PascalCase` | `type Service struct`, `func NewService(...)` | A capital letter means export in Go; this is language semantics, not style | Must |
| Unexported functions / variables | `camelCase` | `func toUser(...)`, `var jobWorkers` | Symmetric with exported names; lowercase means package-private | Must |
| Single-method interfaces | Method name + `-er` | `Reminder` with `Schedule(...)`, `Repository` | Standard library idiom (`io.Reader`, `io.Writer`) | Should |
| JSON fields (own structs, not protobuf/Connect) | `camelCase` via the json tag | `` `json:"dueDate"` `` | No external spec, so follow the JS/TS client convention (web/mobile) to reduce friction at the API boundary; snake_case JSON is typical of Python/Ruby ecosystems, not our clients | Must |
| Protobuf / ConnectRPC fields | `snake_case` in `.proto`; the generator produces `camelCase` in Go/TS | `due_date` becomes `DueDate` (Go) / `dueDate` (TS) | Protocol Buffers Style Guide; this is the protobuf specification, not our choice | Must |
| Test files | `<file>_test.go` | `service_test.go` | Required by `go test`, otherwise the file is not picked up | Must |
| Test functions | `Test<Subject>_<Scenario>` | `TestService_GetTask_CrossUserAccessIsNotFound` | A descriptive name gives a readable `go test -v` report without opening the code | Should |
| Constant groups | `PascalCase` + `iota`; no type prefix in the identifier when the type is obvious from context | `StatusTodo`, `StatusDone` | Go idiom: the declaration provides context; the name should not repeat package/type | Should |
| Module directories | `lowercase`, singular domain | `internal/modules/tasks/`, `internal/modules/auth/` | Matches the package name inside; `architecturetest` checks the import graph by these paths | Must |
| Sentinel errors | `Err<What>`, `var Err... = errors.New(...)` | `ErrTaskNotFound` | Standard library idiom (`io.EOF`, `sql.ErrNoRows`) | Should |

## Anti-patterns

```go
// BAD package Tasks                              // packages are lowercase, no exceptions
// BAD func GetTask_ByID(id string)                // underscores in function names are not Go idiom
// BAD type task_repository struct{}               // an exported type must be PascalCase: TaskRepository
// BAD `json:"due_date"`                            // not a protobuf struct, so it must be "dueDate"
// BAD var ERR_NOT_FOUND = errors.New("...")        // sentinel error: ErrNotFound, not SCREAMING_SNAKE
```

## Enforced code rules (Server)

Full gate table: [Library-First: Server, Enforcement](../../content/library-first/server.md#enforcement). What a contributor hits day to day:

| Rule | Level | Gate |
|---|---|---|
| Time comes from an injected `sharedtime.Clock`, never `time.Now` in `internal/modules/**` | Must | forbidigo |
| `slog` only, always the `*Context` variant, constant message, `snake_case` keys; no stdlib `log`, no `fmt.Print*` | Must | sloglint, forbidigo |
| A switch over `sharederrors.Kind` lists every member (a `default` does not count) | Must | exhaustive |
| `//nolint:<linter> // <reason>`: a specific linter and a reason, and it must still be needed | Must | nolintlint |
| Transport imports only its own `api/`; only admin calls `*Tx` api methods | Must | architecturetest |
| No SQL string literal passed to `Exec`/`Query`/`QueryRow`: write `sql/<schema>/*.sql` and run `task server:gen` | Must | architecturetest |
| A new direct dependency: `go.mod` + `architecturetest/approved_modules.txt` + the Library-First page in one change | Must | architecturetest, `task server:tidy:check` |
| Request protos: `page_size` has `lte`, `page_token` has `max_len`, repeated enums `not_in: [0]` | Must | architecturetest |
| A new integration-event version adds `api/testdata/<Event>.v<N>.json` | Must | architecturetest, goldentest |
