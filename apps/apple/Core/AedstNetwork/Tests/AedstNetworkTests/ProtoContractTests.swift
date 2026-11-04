import AedstCore
import Connect
import Foundation
import Testing
@testable import AedstNetwork

// Contract: the proto files in apps/server/api/proto (source of truth for Web, Server,
// Android, Desktop and this app) vs the connect-swift client generated from them
// (`make generate`, gitignored). Mirrors apps/web's mock-api contract test and
// apps/desktop-rs's aedst-contract tests (tests/generated.rs).
//
// Generated naming (connect-swift 1.2.3, ConnectClientGenerator.printSpecs, option
// GenerateServiceMetadata defaults to true):
//   <TypePrefix><Service>Client.Metadata.Methods.<lowerCamelRpc> = Connect.MethodSpec(
//       name: "<Rpc>", service: "<proto package>.<Service>", type: .unary | ...)
// `Methods` is an enum of static lets, so it cannot be enumerated at runtime: the
// `generatedMethods` table below lists them, and the test fails (a) at compile time if a
// proto RPC the table names is removed and (b) at run time if a proto RPC is missing from
// the table. Adding an RPC to a .proto therefore forces an explicit line here.

// MARK: - Generated client metadata

private let generatedMethods: [MethodSpec] = [
    // aedst.admin.v1.AdminService
    Aedst_Admin_V1_AdminServiceClient.Metadata.Methods.getOverview,
    Aedst_Admin_V1_AdminServiceClient.Metadata.Methods.listTasks,
    Aedst_Admin_V1_AdminServiceClient.Metadata.Methods.deleteTask,
    Aedst_Admin_V1_AdminServiceClient.Metadata.Methods.broadcastNotification,
    Aedst_Admin_V1_AdminServiceClient.Metadata.Methods.listAuditLog,
    // aedst.appattest.v1.AppAttestService
    Aedst_Appattest_V1_AppAttestServiceClient.Metadata.Methods.createChallenge,
    Aedst_Appattest_V1_AppAttestServiceClient.Metadata.Methods.enroll,
    Aedst_Appattest_V1_AppAttestServiceClient.Metadata.Methods.verifyAssertion,
    // aedst.capabilities.v1.CapabilitiesService
    Aedst_Capabilities_V1_CapabilitiesServiceClient.Metadata.Methods.getCapabilities,
    // aedst.media.v1.MediaService
    Aedst_Media_V1_MediaServiceClient.Metadata.Methods.createUpload,
    Aedst_Media_V1_MediaServiceClient.Metadata.Methods.completeUpload,
    Aedst_Media_V1_MediaServiceClient.Metadata.Methods.getMedia,
    Aedst_Media_V1_MediaServiceClient.Metadata.Methods.listMedia,
    Aedst_Media_V1_MediaServiceClient.Metadata.Methods.deleteMedia,
    // aedst.notifications.v1.NotificationsService
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.listNotifications,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.getUnreadCount,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.markRead,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.markAllRead,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.registerPushDevice,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.unregisterPushDevice,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.getWebPushConfig,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.getPreferences,
    Aedst_Notifications_V1_NotificationsServiceClient.Metadata.Methods.updatePreferences,
    // aedst.search.v1.SearchService
    Aedst_Search_V1_SearchServiceClient.Metadata.Methods.search,
    Aedst_Search_V1_SearchServiceClient.Metadata.Methods.suggest,
    // aedst.tasks.v1.TasksService
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.createTask,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.getTask,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.listTasks,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.updateTask,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.deleteTask,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.completeTask,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.reopenTask,
    Aedst_Tasks_V1_TasksServiceClient.Metadata.Methods.getTaskStats,
]

/// RPCs the app's `Connect*Repository` classes call
/// (`client.<rpc>(` in Features/*/Sources/*/Data/Connect*.swift). Kept by hand on purpose:
/// no production code exists just for this test. Update it with the repositories; every
/// entry must exist in the proto.
private let usedProcedures: Set<String> = [
    "aedst.admin.v1.AdminService/GetOverview",
    "aedst.admin.v1.AdminService/ListTasks",
    "aedst.admin.v1.AdminService/DeleteTask",
    "aedst.admin.v1.AdminService/BroadcastNotification",
    "aedst.admin.v1.AdminService/ListAuditLog",
    "aedst.appattest.v1.AppAttestService/CreateChallenge",
    "aedst.appattest.v1.AppAttestService/Enroll",
    "aedst.appattest.v1.AppAttestService/VerifyAssertion",
    "aedst.capabilities.v1.CapabilitiesService/GetCapabilities",
    "aedst.media.v1.MediaService/CreateUpload",
    "aedst.media.v1.MediaService/CompleteUpload",
    "aedst.media.v1.MediaService/GetMedia",
    "aedst.media.v1.MediaService/ListMedia",
    "aedst.media.v1.MediaService/DeleteMedia",
    "aedst.notifications.v1.NotificationsService/ListNotifications",
    "aedst.notifications.v1.NotificationsService/GetUnreadCount",
    "aedst.notifications.v1.NotificationsService/MarkRead",
    "aedst.notifications.v1.NotificationsService/MarkAllRead",
    "aedst.notifications.v1.NotificationsService/RegisterPushDevice",
    "aedst.notifications.v1.NotificationsService/UnregisterPushDevice",
    "aedst.notifications.v1.NotificationsService/GetPreferences",
    "aedst.notifications.v1.NotificationsService/UpdatePreferences",
    "aedst.search.v1.SearchService/Search",
    "aedst.tasks.v1.TasksService/CreateTask",
    "aedst.tasks.v1.TasksService/GetTask",
    "aedst.tasks.v1.TasksService/ListTasks",
    "aedst.tasks.v1.TasksService/DeleteTask",
    "aedst.tasks.v1.TasksService/CompleteTask",
    "aedst.tasks.v1.TasksService/ReopenTask",
]

// MARK: - Proto parsing

struct ProtoRPC: Equatable {
    let service: String  // fully qualified: aedst.tasks.v1.TasksService
    let name: String
    let clientStreaming: Bool
    let serverStreaming: Bool

    var path: String { "\(service)/\(name)" }

    var streamType: String {
        switch (clientStreaming, serverStreaming) {
        case (false, false): "unary"
        case (true, false): "clientStream"
        case (false, true): "serverStream"
        case (true, true): "bidirectionalStream"
        }
    }
}

enum ProtoParser {
    /// Removes `//` and `/* */` comments, leaving string literals untouched.
    static func stripComments(_ source: String) -> String {
        var output = ""
        let characters = Array(source)
        var index = 0
        var inString = false
        while index < characters.count {
            let character = characters[index]
            let next: Character? = index + 1 < characters.count ? characters[index + 1] : nil
            if inString {
                output.append(character)
                if character == "\\", let next {
                    output.append(next)
                    index += 2
                    continue
                }
                if character == "\"" { inString = false }
                index += 1
            } else if character == "\"" {
                inString = true
                output.append(character)
                index += 1
            } else if character == "/", next == "/" {
                while index < characters.count, characters[index] != "\n" { index += 1 }
            } else if character == "/", next == "*" {
                index += 2
                while index + 1 < characters.count, !(characters[index] == "*" && characters[index + 1] == "/") {
                    index += 1
                }
                index += 2
            } else {
                output.append(character)
                index += 1
            }
        }
        return output
    }

    static func parse(_ source: String) throws -> [ProtoRPC] {
        let text = stripComments(source)
        let package = try firstCapture(#"(?m)^\s*package\s+([\w.]+)\s*;"#, in: text)
        let serviceHead = try NSRegularExpression(pattern: #"\bservice\s+(\w+)\s*\{"#)
        let rpc = try NSRegularExpression(
            pattern: #"\brpc\s+(\w+)\s*\(\s*(stream\s+)?[\w.]+\s*\)\s*returns\s*\(\s*(stream\s+)?[\w.]+\s*\)"#
        )

        var result: [ProtoRPC] = []
        let whole = NSRange(text.startIndex..., in: text)
        for head in serviceHead.matches(in: text, range: whole) {
            guard let nameRange = Range(head.range(at: 1), in: text),
                  let headEnd = Range(head.range, in: text)?.upperBound
            else { continue }
            let body = balancedBody(in: text, after: headEnd)
            let bodyRange = NSRange(body.startIndex..., in: body)
            for match in rpc.matches(in: body, range: bodyRange) {
                guard let rpcName = Range(match.range(at: 1), in: body) else { continue }
                result.append(
                    ProtoRPC(
                        service: "\(package).\(text[nameRange])",
                        name: String(body[rpcName]),
                        clientStreaming: match.range(at: 2).location != NSNotFound,
                        serverStreaming: match.range(at: 3).location != NSNotFound
                    )
                )
            }
        }
        return result
    }

    /// The text between an already-consumed `{` and its matching `}`.
    private static func balancedBody(in text: String, after start: String.Index) -> String {
        var depth = 1
        var inString = false
        var index = start
        while index < text.endIndex {
            let character = text[index]
            if inString {
                if character == "\"" { inString = false }
            } else if character == "\"" {
                inString = true
            } else if character == "{" {
                depth += 1
            } else if character == "}" {
                depth -= 1
                if depth == 0 { return String(text[start..<index]) }
            }
            index = text.index(after: index)
        }
        return String(text[start...])
    }

    private static func firstCapture(_ pattern: String, in text: String) throws -> String {
        let regex = try NSRegularExpression(pattern: pattern)
        guard let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text)
        else { throw ProtoContractError.missingPackage }
        return String(text[range])
    }
}

enum ProtoContractError: Error {
    case missingPackage
}

/// Finds `<repo>/apps/server/api/proto` by walking up from this file.
private let protoRoot: URL? = {
    var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    while directory.pathComponents.count > 1 {
        let candidate = directory.appendingPathComponent("apps/server/api/proto", isDirectory: true)
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), isDirectory.boolValue {
            return candidate
        }
        directory.deleteLastPathComponent()
    }
    return nil
}()

/// Proto modules under `aedst/` that `make generate` deliberately skips for this app.
private let notGeneratedForApple: Set<String> = ["integrity"]

private func protoRPCs() throws -> [ProtoRPC] {
    let root = try #require(protoRoot)
    let enumerator = try #require(FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil))
    var rpcs: [ProtoRPC] = []
    for case let url as URL in enumerator where url.pathExtension == "proto" {
        // aedst/<module>/v1/*.proto only (skips any vendored buf/validate etc.).
        let path = url.path.replacingOccurrences(of: "\\", with: "/")
        guard path.contains("/aedst/") else { continue }
        // Services the Apple app does not use are not generated (Makefile `generate`): Play Integrity is Android-only.
        guard !notGeneratedForApple.contains(where: { path.contains("/aedst/\($0)/") }) else { continue }
        rpcs += try ProtoParser.parse(String(contentsOf: url, encoding: .utf8))
    }
    return rpcs
}

// MARK: - Tests

@Suite("Proto parser")
struct ProtoParserTests {
    @Test("extracts package, services, rpcs and streaming kinds; ignores comments and strings")
    func parsesSample() throws {
        let source = """
        syntax = "proto3";
        // service Commented { rpc Nope(A) returns (B); }
        package demo.v1;
        option go_package = "https://example.com//x;y";
        /* rpc BlockComment(A) returns (B); */
        service Demo {
          rpc Unary(UnaryRequest) returns (UnaryResponse);
          // rpc Hidden(A) returns (B);
          rpc Down(DownRequest) returns (stream DownResponse) {
            option idempotency_level = NO_SIDE_EFFECTS;
          }
          rpc Up(stream UpRequest) returns (UpResponse);
          rpc Both ( stream google.protobuf.Empty ) returns ( stream other.v1.Thing );
        }
        service Second { rpc Only(A) returns (B); }
        message Unrelated { string rpc = 1; }
        """
        let rpcs = try ProtoParser.parse(source)
        #expect(rpcs.map(\.path) == [
            "demo.v1.Demo/Unary", "demo.v1.Demo/Down", "demo.v1.Demo/Up", "demo.v1.Demo/Both",
            "demo.v1.Second/Only",
        ])
        #expect(rpcs.map(\.streamType) == ["unary", "serverStream", "clientStream", "bidirectionalStream", "unary"])
    }

    @Test("a file without a package is an error")
    func missingPackage() {
        #expect(throws: ProtoContractError.self) { try ProtoParser.parse("service A { rpc B(C) returns (D); }") }
    }
}

@Suite("Proto <-> generated Connect client contract", .enabled(if: protoRoot != nil, "repo proto sources not found (package-only checkout)"))
struct ProtoContractTests {
    private static func signature(path: String, type: String) -> String { "\(path) [\(type)]" }

    @Test("every proto RPC exists in the generated metadata with the same service, name and streaming type")
    func protoMatchesGenerated() throws {
        let proto = try protoRPCs()
        #expect(proto.count >= 30, "parser found suspiciously few RPCs: \(proto.count)")
        let fromProto = Set(proto.map { Self.signature(path: $0.path, type: $0.streamType) })
        let fromGenerated = Set(generatedMethods.map { Self.signature(path: $0.path, type: String(describing: $0.type)) })

        let missingInGenerated = fromProto.subtracting(fromGenerated).sorted()
        #expect(missingInGenerated.isEmpty, "in proto, not in generated metadata / generatedMethods table: \(missingInGenerated)")
    }

    @Test("no generated method is missing from the proto (removed or renamed RPC)")
    func generatedMatchesProto() throws {
        let fromProto = Set(try protoRPCs().map { Self.signature(path: $0.path, type: $0.streamType) })
        let fromGenerated = Set(generatedMethods.map { Self.signature(path: $0.path, type: String(describing: $0.type)) })

        let extra = fromGenerated.subtracting(fromProto).sorted()
        #expect(extra.isEmpty, "generated, not in proto: \(extra)")
        #expect(fromGenerated.count == generatedMethods.count, "duplicate entries in generatedMethods")
    }

    @Test("every procedure the app calls exists in the proto")
    func usedProceduresExistInProto() throws {
        let protoPaths = Set(try protoRPCs().map(\.path))
        let unknown = usedProcedures.subtracting(protoPaths).sorted()
        #expect(unknown.isEmpty, "app calls RPCs that are not in the proto: \(unknown)")
    }

    @Test("every procedure the app calls is covered by the generated client")
    func usedProceduresExistInGenerated() {
        let generatedPaths = Set(generatedMethods.map(\.path))
        let unknown = usedProcedures.subtracting(generatedPaths).sorted()
        #expect(unknown.isEmpty, "app calls RPCs missing from the generated client: \(unknown)")
    }
}

@Suite("NetworkErrorMapping covers every Connect.Code")
struct NetworkErrorMappingGoldenTests {
    /// Golden table: `AedstError.kind` per Connect code (the same table as docs/contract/behavior/error-kinds.json). Codes that land in
    /// "unknown" fall through the mapping's `default:` ON PURPOSE; they are listed so a new
    /// code in a connect-swift upgrade fails `coversAllCodes` and forces a decision here
    /// (and in NetworkErrorMapping), instead of silently becoming `.unknown`.
    private static let expected: [Code: String] = [
        .ok: "unknown",
        .canceled: "cancelled",
        .unknown: "unknown",
        .invalidArgument: "invalidInput",
        .deadlineExceeded: "timeout",
        .notFound: "notFound",
        .alreadyExists: "conflict",
        .permissionDenied: "forbidden",
        .resourceExhausted: "rateLimited",
        .failedPrecondition: "invalidInput",
        .aborted: "conflict",
        .outOfRange: "invalidInput",
        .unimplemented: "unknown",
        .internalError: "unknown",
        .unavailable: "unavailable",
        .dataLoss: "unknown",
        .unauthenticated: "unauthenticated",
    ]

    @Test("the golden table lists every Code case")
    func coversAllCodes() {
        #expect(Set(Code.allCases) == Set(Self.expected.keys))
    }

    @Test("each Code maps to the expected AedstError category", arguments: Code.allCases)
    func mapsEachCode(code: Code) throws {
        let error = ConnectError(code: code, message: "m", exception: nil, details: [], metadata: [:])
        let mapped = NetworkErrorMapping.map(error)
        #expect(mapped.kind == Self.expected[code], "\(code.name) -> \(mapped)")
    }
}
