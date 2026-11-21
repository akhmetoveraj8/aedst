#!/usr/bin/env bash
# Layer rules inside every apps/apple/Features/<X> package ("One business logic, two UI builds", decisions/apple.md).
# Needs only bash + grep + sed. Targets live in Sources/<X>Domain, <X>Data, <X>Presentation, <X>UIiOS, <X>UIMac.
#   1. layout: the five source directories exist and Package.swift declares the five targets; no other Sources/ dir;
#   2. domain-pure: <X>Domain imports no UI, network or persistence module and no sibling target;
#   3. data-no-ui: <X>Data imports no UI framework, no <X>Presentation and no UI target;
#   4. presentation-no-ui: <X>Presentation imports no UI framework, no <X>Data and no UI target (shared view models);
#   5. ui-no-data: <X>UIiOS / <X>UIMac never import <X>Data, AedstNetwork, AedstPersistence, Connect or GRDB;
#   6. ui-wrong-platform: <X>UIiOS never imports AppKit or <X>UIMac, <X>UIMac never imports UIKit or <X>UIiOS;
#   7. ui-file-guard: every file of a UI target starts with `#if os(iOS)` (UIiOS) or `#if os(macOS)` (UIMac) and ends
#      with `#endif`; that guard is the ONLY platform condition in the file (no other `#if os(`, `canImport(UIKit)`,
#      `canImport(AppKit)` or `targetEnvironment(`): platform differences are two files, not a branch;
#   8. no-cross-feature: no source or test of Features/<X> imports a target of another feature.
# Comment-only lines never count. Usage:
#   scripts/check-feature-layers.sh              check the real tree
#   scripts/check-feature-layers.sh --self-test  a generated good tree must pass, each broken copy must fail its rule
#   scripts/check-feature-layers.sh ROOT         check ROOT as if it were apps/apple
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

UI_FRAMEWORKS='SwiftUI|UIKit|AppKit'
IMPORT_PREFIX='^[[:space:]]*(@testable |@_exported |@preconcurrency )*import '

# imports_in DIR REGEX -> "file:line:text" for every import of a module matching REGEX (comment lines never match).
imports_in() {
  [ -d "$1" ] || return 0
  grep -rnE --include='*.swift' "${IMPORT_PREFIX}($2)[[:space:]]*$" "$1" 2>/dev/null || true
}

fail() { # RULE FILE MESSAGE
  echo "::error file=apps/apple/$2::[$1] $3"
}

check_ui_guards() { # DIR PLATFORM
  local dir="$1" platform="$2" bad=0 file first last count
  [ -d "$dir" ] || return 0
  while IFS= read -r file; do
    first="$(grep -m1 -vE '^[[:space:]]*$' "$file" | tr -d '\r' || true)"
    last="$(grep -vE '^[[:space:]]*$' "$file" | tail -1 | tr -d '\r' || true)"
    if [ "$first" != "#if os($platform)" ] || [ "$last" != "#endif" ]; then
      fail ui-file-guard "$file" "must start with '#if os($platform)' and end with '#endif' (whole-file guard)"
      bad=1
    fi
    count="$(grep -cE '^[[:space:]]*#(if|elseif)[[:space:]].*(os\(|canImport\((UIKit|AppKit)\)|targetEnvironment\()' "$file" || true)"
    if [ "$count" != "1" ]; then
      fail ui-file-guard "$file" "has $count platform conditions; only the whole-file guard is allowed (write a second file in the other UI target)"
      bad=1
    fi
  done < <(find "$dir" -name '*.swift' | sort)
  return "$bad"
}

run_checks() {
  cd "$1"
  local status=0 pkg x src others hit other layer dir
  local features=""
  for pkg in Features/*/Package.swift; do
    [ -f "$pkg" ] || continue
    features="$features $(basename "$(dirname "$pkg")")"
  done

  for x in $features; do
    src="Features/$x/Sources"

    # 1. layout
    for layer in Domain Data Presentation UIiOS UIMac; do
      if [ ! -d "$src/$x$layer" ]; then
        fail layout "Features/$x/Package.swift" "missing source directory Sources/$x$layer"; status=1
      fi
      if ! grep -q "name: \"$x$layer\"" "Features/$x/Package.swift"; then
        fail layout "Features/$x/Package.swift" "does not declare the target $x$layer"; status=1
      fi
    done
    for dir in "$src"/*/; do
      [ -d "$dir" ] || continue
      case "$(basename "$dir")" in
        "${x}Domain"|"${x}Data"|"${x}Presentation"|"${x}UIiOS"|"${x}UIMac") ;;
        *) fail layout "${dir%/}" "unexpected source directory (allowed: ${x}Domain, ${x}Data, ${x}Presentation, ${x}UIiOS, ${x}UIMac)"; status=1 ;;
      esac
    done

    # 2. domain-pure
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      fail domain-pure "${hit%%:*}" "Domain is plain Swift: ${hit#*:}"; status=1
    done < <(imports_in "$src/${x}Domain" "$UI_FRAMEWORKS|Connect|GRDB|AedstNetwork|AedstPersistence|AedstDesignSystem|AedstNavigation|${x}Data|${x}Presentation|${x}UIiOS|${x}UIMac")

    # 3. data-no-ui
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      fail data-no-ui "${hit%%:*}" "Data depends on Domain and Core only: ${hit#*:}"; status=1
    done < <(imports_in "$src/${x}Data" "SwiftUI|AedstDesignSystem|AedstNavigation|${x}Presentation|${x}UIiOS|${x}UIMac")

    # 4. presentation-no-ui
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      fail presentation-no-ui "${hit%%:*}" "shared view models import no UI framework and no Data: ${hit#*:}"; status=1
    done < <(imports_in "$src/${x}Presentation" "$UI_FRAMEWORKS|AedstDesignSystem|Connect|GRDB|AedstNetwork|AedstPersistence|${x}Data|${x}UIiOS|${x}UIMac")

    # 5. ui-no-data
    for layer in UIiOS UIMac; do
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        fail ui-no-data "${hit%%:*}" "a UI target depends on Domain and Presentation, never on Data: ${hit#*:}"; status=1
      done < <(imports_in "$src/$x$layer" "${x}Data|AedstNetwork|AedstPersistence|Connect|GRDB")
    done

    # 6. ui-wrong-platform
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      fail ui-wrong-platform "${hit%%:*}" "the iOS UI build imports ${hit##* }"; status=1
    done < <(imports_in "$src/${x}UIiOS" "AppKit|${x}UIMac")
    while IFS= read -r hit; do
      [ -n "$hit" ] || continue
      fail ui-wrong-platform "${hit%%:*}" "the macOS UI build imports ${hit##* }"; status=1
    done < <(imports_in "$src/${x}UIMac" "UIKit|${x}UIiOS")

    # 7. ui-file-guard
    check_ui_guards "$src/${x}UIiOS" iOS || status=1
    check_ui_guards "$src/${x}UIMac" macOS || status=1

    # 8. no-cross-feature
    others=""
    for other in $features; do
      [ "$other" = "$x" ] && continue
      others="$others|${other}Domain|${other}Data|${other}Presentation|${other}UIiOS|${other}UIMac"
    done
    if [ -n "$others" ]; then
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        fail no-cross-feature "${hit%%:*}" "a feature never imports another feature: ${hit#*:}"; status=1
      done < <(imports_in "Features/$x" "${others#|}")
    fi
  done
  return "$status"
}

if [ "${1:-}" = "--self-test" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  make_good() {
    local d="$1" x layer
    for x in Tasks Media; do
      mkdir -p "$d/Features/$x"
      : >"$d/Features/$x/Package.swift"
      for layer in Domain Data Presentation UIiOS UIMac; do
        mkdir -p "$d/Features/$x/Sources/$x$layer"
        echo "        .target(name: \"$x$layer\")," >>"$d/Features/$x/Package.swift"
      done
      printf 'import AedstCore\nimport Foundation\n// import SwiftUI is only mentioned in a comment\n' >"$d/Features/$x/Sources/${x}Domain/Model.swift"
      printf 'import AedstNetwork\nimport %sDomain\n' "$x" >"$d/Features/$x/Sources/${x}Data/Repository.swift"
      printf 'import Observation\nimport %sDomain\n' "$x" >"$d/Features/$x/Sources/${x}Presentation/ViewModel.swift"
      printf '#if os(iOS)\nimport SwiftUI\nimport %sPresentation\n#if DEBUG\n#endif\n#endif\n' "$x" >"$d/Features/$x/Sources/${x}UIiOS/Screen.swift"
      printf '#if os(macOS)\nimport SwiftUI\nimport %sPresentation\n#endif\n' "$x" >"$d/Features/$x/Sources/${x}UIMac/Screen.swift"
      mkdir -p "$d/Features/$x/Tests/${x}Tests"
      printf '@testable import %sDomain\n' "$x" >"$d/Features/$x/Tests/${x}Tests/ModelTests.swift"
    done
  }
  ok=0
  make_good "$tmp/good"
  if ! (run_checks "$tmp/good" >/dev/null 2>&1); then echo "SELF-TEST FAIL: good tree rejected"; (run_checks "$tmp/good" || true); ok=1; fi
  expect_fail() { # RULE NAME COMMAND (run inside a fresh copy of the good tree)
    local rule="$1" name="$2" cmd="$3" out
    rm -rf "$tmp/bad"; make_good "$tmp/bad"
    (cd "$tmp/bad" && eval "$cmd")
    out="$(run_checks "$tmp/bad" 2>&1 || true)"
    if ! printf '%s\n' "$out" | grep -q "\[$rule\]"; then echo "SELF-TEST FAIL: '$name' did not trip $rule"; ok=1; fi
  }
  expect_fail layout "missing UIMac directory" "rm -rf Features/Tasks/Sources/TasksUIMac"
  expect_fail layout "old single-target directory" "mkdir -p Features/Tasks/Sources/Tasks"
  expect_fail domain-pure "SwiftUI in Domain" "echo 'import SwiftUI' >>Features/Tasks/Sources/TasksDomain/Model.swift"
  expect_fail domain-pure "Connect in Domain" "echo 'import Connect' >>Features/Tasks/Sources/TasksDomain/Model.swift"
  expect_fail data-no-ui "Presentation in Data" "echo 'import TasksPresentation' >>Features/Tasks/Sources/TasksData/Repository.swift"
  expect_fail presentation-no-ui "SwiftUI in Presentation" "echo 'import SwiftUI' >>Features/Tasks/Sources/TasksPresentation/ViewModel.swift"
  expect_fail presentation-no-ui "Data in Presentation" "echo 'import TasksData' >>Features/Tasks/Sources/TasksPresentation/ViewModel.swift"
  expect_fail ui-no-data "Data in UIiOS" "sed -i.bak 's/^import SwiftUI/import SwiftUI\nimport TasksData/' Features/Tasks/Sources/TasksUIiOS/Screen.swift && rm -f Features/Tasks/Sources/TasksUIiOS/*.bak"
  expect_fail ui-wrong-platform "AppKit in UIiOS" "sed -i.bak 's/^import SwiftUI/import AppKit/' Features/Tasks/Sources/TasksUIiOS/Screen.swift && rm -f Features/Tasks/Sources/TasksUIiOS/*.bak"
  expect_fail ui-wrong-platform "UIKit in UIMac" "sed -i.bak 's/^import SwiftUI/import UIKit/' Features/Tasks/Sources/TasksUIMac/Screen.swift && rm -f Features/Tasks/Sources/TasksUIMac/*.bak"
  expect_fail ui-file-guard "unguarded UI file" "printf 'import SwiftUI\n' >Features/Tasks/Sources/TasksUIMac/Screen.swift"
  expect_fail ui-file-guard "wrong platform guard" "printf '#if os(iOS)\nimport SwiftUI\n#endif\n' >Features/Tasks/Sources/TasksUIMac/Screen.swift"
  expect_fail ui-file-guard "platform branch inside a UI file" "printf '#if os(iOS)\nimport SwiftUI\n#if canImport(UIKit)\n#endif\n#endif\n' >Features/Tasks/Sources/TasksUIiOS/Screen.swift"
  expect_fail no-cross-feature "feature imports another feature" "echo 'import MediaDomain' >>Features/Tasks/Sources/TasksPresentation/ViewModel.swift"
  expect_fail no-cross-feature "test imports another feature" "echo '@testable import MediaData' >>Features/Tasks/Tests/TasksTests/ModelTests.swift"
  [ "$ok" -eq 0 ] && echo "OK self-test: good tree passes, every broken copy trips its rule (check-feature-layers.sh, 8 rules)."
  exit "$ok"
fi

root="$(cd "${1:-$here/..}" && pwd)"
if run_checks "$root"; then
  echo "OK: every feature keeps Domain / Data / Presentation shared and its two UI targets apart."
else
  exit 1
fi
