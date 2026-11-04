# App-specific R8 rules. R8 runs in FULL mode (the AGP default since 8.0, no opt-in property needed), so
# nothing is kept "by accident": every reflective access must be covered by a keep rule.
#
# Where rules live (docs: docs/content/android/r8.md):
#   - Library-shipped consumer rules (AAR/JAR META-INF): Hilt/Dagger, Room, WorkManager, OkHttp, Tink, Sentry,
#     PostHog, Firebase, connect-kotlin (its Moshi JSON adapters), kotlinx.serialization (core jar, R8 flavour).
#   - protobuf-javalite 4.36.x ships NONE, so the keep rules for generated messages are owned by core/network
#     (core/network/consumer-rules.pro) and apply here through the consumer-rules merge. Do not duplicate them.
#   - This file: only rules that belong to the application itself.

# Readable stack traces in Sentry: the mapping file is uploaded by the Sentry Gradle plugin (SENTRY_AUTH_TOKEN set);
# keep line numbers and rename the source file attribute so traces de-obfuscate precisely.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
