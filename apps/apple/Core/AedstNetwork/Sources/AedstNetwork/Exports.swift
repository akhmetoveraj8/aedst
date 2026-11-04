// Feature and app modules talk to the Connect runtime through AedstNetwork only,
// so they get its types (ProtocolClient, ResponseMessage, ...) from this one import.
@_exported import Connect
// Generated messages use well-known types (`Google_Protobuf_Timestamp`, `FieldMask`);
// features read `.date` / build `Google_Protobuf_Timestamp(date:)` through this import.
@_exported import SwiftProtobuf
