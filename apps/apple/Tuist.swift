import ProjectDescription

// Tuist workspace-level configuration (replaces the `options:` block of the old
// XcodeGen `project.yml`). Tuist finds this file by walking up from the current
// directory. Defaults are intentional: local SwiftPM packages under Core/,
// Features/ and App/Shared are integrated through `Tuist/Package.swift`, and
// the Tuist project manifest is `Project.swift`.
let tuist = Tuist(
    project: .tuist()
)
