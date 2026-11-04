#!/usr/bin/env bash
# Negative self-tests for the Library-First gates: seeds ONE violation per gate into the working tree, proves the gate
# fails with the expected message, then removes the seed (also on Ctrl-C). A gate that passes on its seeded violation
# is a broken gate. Positive controls prove the allowed scopes (core/common may log, core/network may use OkHttp, a
# `// allow-dp:` line passes) are not caught.
#
#   scripts/test-gates.sh          shell gates only (about a minute)
#   scripts/test-gates.sh --full   also detekt (ForbiddenImport scopes, type-resolved rules, compose-rules), Android
#                                  Lint (UseKtx) and Kover (coverage floor); needs JDK 21 + Android SDK, takes minutes
#
# Seeds are written under src/main of real modules because several gates are path-scoped (feature/ vs core/common/ ...).
set -uo pipefail

cd "$(dirname "$0")/.."

full=0
[ "${1:-}" = "--full" ] && full=1

failures=0
seeded_files=()
backups=()

cleanup() {
  for f in "${seeded_files[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  for pair in "${backups[@]:-}"; do
    [ -z "$pair" ] && continue
    cp "${pair#*|}" "${pair%%|*}" && rm -f "${pair#*|}"
  done
}
trap cleanup EXIT

seed() { # path, content: create a seed file (removed on exit)
  mkdir -p "$(dirname "$1")"
  printf '%s\n' "$2" > "$1"
  seeded_files+=("$1")
}

amend() { # path, text: append to an existing file, restoring it on exit
  local backup
  backup="$(mktemp)"
  cp "$1" "$backup"
  backups+=("$1|$backup")
  printf '%s\n' "$2" >> "$1"
}

expect_fail() { # name, expected substring in output, command...
  local name="$1" needle="$2" out code
  shift 2
  out="$("$@" 2>&1)"
  code=$?
  if [ "$code" -eq 0 ]; then
    echo "FAIL  $name: gate PASSED on a seeded violation"
    failures=$((failures + 1))
  elif ! grep -qF -- "$needle" <<< "$out"; then
    echo "FAIL  $name: gate failed, but without the expected '$needle'"
    echo "$out" | tail -5 | sed 's/^/        /'
    failures=$((failures + 1))
  else
    echo "ok    $name"
  fi
}

expect_pass() { # name, command...
  local name="$1" out code
  shift
  out="$("$@" 2>&1)"
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "FAIL  $name: gate rejected compliant code"
    echo "$out" | tail -5 | sed 's/^/        /'
    failures=$((failures + 1))
  else
    echo "ok    $name"
  fi
}

PKG=feature/tasks/src/main/kotlin/com/aedst/feature/tasks

echo "== clean tree passes the shell gates"
expect_pass "check-feature-boundaries (clean)" bash scripts/check-feature-boundaries.sh
expect_pass "check-ui-tokens (clean)" bash scripts/check-ui-tokens.sh
expect_pass "check-rpc-contract (clean)" bash scripts/check-rpc-contract.sh
expect_pass "check-catalog-allowlist (clean)" bash scripts/check-catalog-allowlist.sh
expect_pass "check-policies serialization (clean)" bash scripts/check-policies.sh serialization
expect_pass "check-room-schemas (clean)" bash scripts/check-room-schemas.sh

echo "== check-policies: kotlinx.serialization in API-facing code"
seed "$PKG/data/SelfTestDto.kt" 'package com.aedst.feature.tasks.data

import kotlinx.serialization.Serializable

@Serializable
data class SelfTestDto(val id: String)'
expect_fail "serialization: @Serializable in a data package" "@Serializable in API-facing code" bash scripts/check-policies.sh serialization
rm -f "$PKG/data/SelfTestDto.kt"
seed "core/capabilities/src/main/kotlin/com/aedst/core/capabilities/SelfTestJson.kt" 'package com.aedst.core.capabilities

import kotlinx.serialization.json.Json

val selfTestJson = Json'
expect_fail "serialization: import in core/capabilities" "kotlinx.serialization used in API-facing code" bash scripts/check-policies.sh serialization
rm -f "core/capabilities/src/main/kotlin/com/aedst/core/capabilities/SelfTestJson.kt"

echo "== check-catalog-allowlist"
tmp_catalog="$(mktemp)"
cp gradle/libs.versions.toml "$tmp_catalog"
sed -i 's|^\[libraries\]|[libraries]\nselftest-lib = { module = "com.example.selftest:selftest-lib", version = "1.0" }|' "$tmp_catalog"
expect_fail "catalog: library not in the doc" "com.example.selftest:selftest-lib" bash scripts/check-catalog-allowlist.sh "$tmp_catalog"
rm -f "$tmp_catalog"

echo "== check-ui-tokens"
seed "$PKG/presentation/SelfTestTokens.kt" 'package com.aedst.feature.tasks.presentation

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp

@Composable
fun SelfTestTokens() {
    Modifier.padding(7.dp)
    val shape = RoundedCornerShape(3.dp)
    Text("Hello")
}'
expect_fail "tokens: raw dp" "Raw .dp outside core/ui" bash scripts/check-ui-tokens.sh
expect_fail "tokens: RoundedCornerShape" "RoundedCornerShape outside core/ui" bash scripts/check-ui-tokens.sh
expect_fail "tokens: literal Text" "Literal Text" bash scripts/check-ui-tokens.sh
rm -f "$PKG/presentation/SelfTestTokens.kt"
seed "$PKG/presentation/SelfTestAllowed.kt" 'package com.aedst.feature.tasks.presentation

import androidx.compose.ui.unit.dp

val selfTestAllowed = 48.dp // allow-dp: self-test positive control'
expect_pass "tokens: allow-dp marker passes" bash scripts/check-ui-tokens.sh
rm -f "$PKG/presentation/SelfTestAllowed.kt"
seed "$PKG/presentation/SelfTestScreen.kt" 'package com.aedst.feature.tasks.presentation

import androidx.compose.runtime.Composable

@Composable
internal fun SelfTestScreen() {}'
expect_fail "tokens: Screen without a preview" "SelfTestScreen has no preview" bash scripts/check-ui-tokens.sh
rm -f "$PKG/presentation/SelfTestScreen.kt"

echo "== check-rpc-contract"
seed "core/capabilities/src/main/kotlin/com/aedst/core/capabilities/SelfTestCall.kt" 'package com.aedst.core.capabilities

suspend fun selfTestCall(client: Any) = client.selfTestRpc(1)'
expect_fail "rpc: call without a contract entry" "client.selfTestRpc" bash scripts/check-rpc-contract.sh
rm -f "core/capabilities/src/main/kotlin/com/aedst/core/capabilities/SelfTestCall.kt"
tmp_contract="$(mktemp)"
sed 's|^    val unary: Set<String> = setOf(|    val unary: Set<String> = setOf(\n        "aedst.ghost.v1.GhostService/GhostRpc",|' \
  core/network/src/test/kotlin/com/aedst/core/network/contract/AppRpcContract.kt > "$tmp_contract"
expect_fail "rpc: contract entry without a call" "no code calls client.ghostRpc" bash scripts/check-rpc-contract.sh "$tmp_contract"
rm -f "$tmp_contract"

echo "== check-feature-boundaries"
amend feature/search/build.gradle.kts 'dependencies { implementation(project(":feature:tasks")) }'
expect_fail "boundaries: feature -> feature" "depends on another feature module" bash scripts/check-feature-boundaries.sh
amend core/common/build.gradle.kts 'dependencies { implementation(project(":feature:tasks")) }'
expect_fail "boundaries: core -> feature" "depends on a feature module" bash scripts/check-feature-boundaries.sh
cleanup; backups=()
seed "app/src/main/kotlin/com/aedst/android/SelfTestImport.kt" 'package com.aedst.android

import com.aedst.feature.tasks.domain.Task'
expect_fail "boundaries: app imports feature internals" "Imports a feature's internals" bash scripts/check-feature-boundaries.sh
rm -f "app/src/main/kotlin/com/aedst/android/SelfTestImport.kt"
seed "$PKG/presentation/SelfTestViewModel.kt" 'package com.aedst.feature.tasks.presentation

class SelfTestViewModel'
expect_fail "boundaries: public ViewModel" "Public Screen/ViewModel/Repository/Module type" bash scripts/check-feature-boundaries.sh
rm -f "$PKG/presentation/SelfTestViewModel.kt"

echo "== check-room-schemas"
tmp_db="$(mktemp -d)"
mkdir -p "$tmp_db/src/main/kotlin/com/aedst/core/database" "$tmp_db/schemas/com.aedst.core.database.AppDatabase"
printf 'abstract class AppDatabase {\n    companion object {\n        const val VERSION = 2\n    }\n}\n' \
  > "$tmp_db/src/main/kotlin/com/aedst/core/database/AppDatabase.kt"
echo '{}' > "$tmp_db/schemas/com.aedst.core.database.AppDatabase/1.json"
expect_fail "room: schema of the new version is missing" "2.json is missing" bash scripts/check-room-schemas.sh "$tmp_db"
echo '{}' > "$tmp_db/schemas/com.aedst.core.database.AppDatabase/2.json"
expect_pass "room: schemas of every version present" bash scripts/check-room-schemas.sh "$tmp_db"
mkdir -p "$tmp_db/schemas/com.yourname.myapp.core.database.AppDatabase"
expect_fail "room: stale schema directory of an old package" "Stale Room schema directories" bash scripts/check-room-schemas.sh "$tmp_db"
rm -rf "$tmp_db"

echo "== check-baseline-profile"
expect_pass "baseline profile: missing is only a warning by default" bash scripts/check-baseline-profile.sh /nonexistent/baselineProfiles
expect_fail "baseline profile: missing fails once it is required" "No baseline profile" \
  env AEDST_REQUIRE_BASELINE_PROFILE=1 bash scripts/check-baseline-profile.sh /nonexistent/baselineProfiles

if [ "$full" -eq 1 ]; then
  echo "== detekt: path-scoped ForbiddenImport and syntactic rules (no type resolution)"
  seed "$PKG/presentation/SelfTestForbidden.kt" 'package com.aedst.feature.tasks.presentation

import android.util.Log
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.runtime.collectAsState
import androidx.security.crypto.EncryptedSharedPreferences
import com.google.gson.Gson
import io.reactivex.Observable
import kotlinx.coroutines.Dispatchers
import okhttp3.OkHttpClient
import org.koin.core.Koin
import retrofit2.Retrofit'
  seed "core/common/src/main/kotlin/com/aedst/core/common/SelfTestAllowed.kt" 'package com.aedst.core.common

import android.util.Log
import kotlinx.coroutines.Dispatchers

internal fun selfTestAllowedLog() = Log.d("selftest", Dispatchers.IO.toString())'
  seed "core/network/src/main/kotlin/com/aedst/core/network/SelfTestAllowed.kt" 'package com.aedst.core.network

import okhttp3.OkHttpClient

internal fun selfTestAllowedClient() = OkHttpClient()'
  detekt_out="$(./gradlew :feature:tasks:detekt :core:common:detekt :core:network:detekt -x detektDebug --continue 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  need() { # label, regex that must appear in the detekt output
    if grep -qE -- "$2" <<< "$detekt_out"; then echo "ok    $1"; else echo "FAIL  $1: not reported"; failures=$((failures + 1)); fi
  }
  absent() { # label, regex that must NOT appear
    if grep -qE -- "$2" <<< "$detekt_out"; then echo "FAIL  $1: wrongly reported"; failures=$((failures + 1)); else echo "ok    $1"; fi
  }
  need "detekt: retrofit2 banned" "SelfTestForbidden.kt.*retrofit2.*\[ForbiddenImport\]"
  need "detekt: gson banned" "SelfTestForbidden.kt.*gson.*\[ForbiddenImport\]"
  need "detekt: koin banned" "SelfTestForbidden.kt.*koin.*\[ForbiddenImport\]"
  need "detekt: rxjava banned" "SelfTestForbidden.kt.*reactivex.*\[ForbiddenImport\]"
  need "detekt: security-crypto banned" "SelfTestForbidden.kt.*security.crypto.*\[ForbiddenImport\]"
  need "detekt: collectAsState banned" "SelfTestForbidden.kt.*collectAsState.*\[ForbiddenImport\]"
  need "detekt: android.util.Log outside core/common" "SelfTestForbidden.kt.*android.util.Log.*\[ForbiddenImport/MainThreadAndLogging\]"
  need "detekt: Dispatchers outside core/common" "SelfTestForbidden.kt.*kotlinx.coroutines.Dispatchers.*\[ForbiddenImport/MainThreadAndLogging\]"
  need "detekt: okhttp3 outside network modules" "SelfTestForbidden.kt.*okhttp3.*\[ForbiddenImport/OkHttpOutsideNetwork\]"
  need "detekt: raw material3 IconButton in a feature" "SelfTestForbidden.kt.*IconButton.*\[ForbiddenImport/Material3Raw\]"
  need "detekt: raw material3 CircularProgressIndicator in a feature" "SelfTestForbidden.kt.*CircularProgressIndicator.*\[ForbiddenImport/Material3Raw\]"
  absent "detekt: core/common may use Log and Dispatchers" "core.common.SelfTestAllowed.kt.*ForbiddenImport"
  absent "detekt: core/network may use OkHttp" "core.network.SelfTestAllowed.kt.*ForbiddenImport"
  rm -f "$PKG/presentation/SelfTestForbidden.kt" "core/common/src/main/kotlin/com/aedst/core/common/SelfTestAllowed.kt" \
    "core/network/src/main/kotlin/com/aedst/core/network/SelfTestAllowed.kt"

  echo "== detekt: type-resolved rules and compose-rules (detektDebug)"
  seed "$PKG/presentation/SelfTestTypeResolved.kt" 'package com.aedst.feature.tasks.presentation

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(DelicateCoroutinesApi::class)
fun selfTestGlobalScope() {
    GlobalScope.launch { delay(1) }
}

fun selfTestSleep() {
    Thread.sleep(1)
}

suspend fun selfTestSwallow(): Result<Unit> = runCatching { delay(1) }

fun selfTestDispatcher() = kotlinx.coroutines.Dispatchers.IO

@Composable
fun SelfTestNoModifier() {
    Text("x")
}'
  detekt_out="$(./gradlew :feature:tasks:detektDebug --continue 2>&1 | sed 's/\x1b\[[0-9;]*m//g')"
  need "detekt: GlobalScope usage" "SelfTestTypeResolved.kt.*\[(GlobalCoroutineUsage|ForbiddenImport)\]"
  need "detekt: Thread.sleep (type resolution)" "SelfTestTypeResolved.kt.*Thread.sleep.*\[ForbiddenMethodCall\]"
  need "detekt: runCatching swallows cancellation (type resolution)" "SelfTestTypeResolved.kt.*\[SuspendFunSwallowedCancellation\]"
  need "detekt: Dispatchers.IO not injected (type resolution)" "SelfTestTypeResolved.kt.*\[InjectDispatcher\]"
  need "detekt: compose-rules ModifierMissing" "modifier parameter"
  rm -f "$PKG/presentation/SelfTestTypeResolved.kt"

  echo "== Android Lint: UseKtx is an error (warningsAsErrors)"
  seed "core/media/src/main/kotlin/com/aedst/core/media/SelfTestLint.kt" 'package com.aedst.core.media

import android.net.Uri

internal fun selfTestLint(): Uri = Uri.parse("https://example.com")'
  expect_fail "lint: warning fails the build" "UseKtx" ./gradlew :core:media:lintDebug
  rm -f "core/media/src/main/kotlin/com/aedst/core/media/SelfTestLint.kt"

  echo "== Kover: a module below its floor fails"
  amend kover-thresholds.properties 'core/common=100'
  expect_fail "kover: floor of 100 percent on core/common" "violated" ./gradlew :core:common:koverVerifyDebug
fi

if [ "$failures" -ne 0 ]; then
  echo "$failures gate self-test(s) FAILED"
  exit 1
fi
echo "All gate self-tests passed."
