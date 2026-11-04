// The Connect stubs under Generated/ are never committed (they are produced from
// apps/server/api/proto). They live in this module, so a clone without them cannot compile:
// every use of an `Aedst_*_V1_*` type fails with "cannot find type ... in scope", in many files.
//
//   >>> If the line below fails to compile, run:  make bootstrap   (from apps/apple)
//   >>> or just the codegen step:                 make generate
//
// This file exists only so that failure has one obvious, self-explaining location. It generates
// no code and no runtime behavior.
private typealias GeneratedStubsAreMissing_RunMakeBootstrap = Aedst_Tasks_V1_TasksServiceClient
