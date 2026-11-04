# Consumer R8 rules for everything this module exposes to the app: the protobuf-lite runtime and the buf-generated
# messages (ConnectRPC clients here, UserPrefs in core/datastore - the rules are global once merged into the app).
#
# protobuf-javalite 4.36.x ships NO R8/ProGuard rules of its own (verified on the 4.36.2 jar: only .proto sources).
# GeneratedMessageLite builds its schema from a string descriptor and then reads/writes the message's fields by
# NAME through reflection; if R8 renames or removes a field (`field_` suffix, bitField0_, oneof case/value fields)
# the app crashes only in the minified release build with "Field xxx_ for yyy not found". R8 full mode (the AGP
# default) removes unreferenced fields more aggressively than the old compat mode, so these rules are mandatory.
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
    <fields>;
}

# Reflection-free in theory, kept because connect-kotlin's GoogleLiteProtoAdapter parses responses through the
# message's default instance / parser; cheap insurance against a future connect-kotlin change.
-keepclassmembers class * extends com.google.protobuf.GeneratedMessageLite {
    public static ** getDefaultInstance();
    public static com.google.protobuf.Parser parser();
}

# Enums are mapped by number (forNumber) when decoding; keep the lookup used by Internal.EnumLiteMap.
-keepclassmembers enum * implements com.google.protobuf.Internal$EnumLite {
    public static ** forNumber(int);
}

