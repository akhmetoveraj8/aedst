SHELL := /bin/bash
SERVER_PROTO_DIR := ../server/api/proto
GENERATED_DIR := Core/AedstNetwork/Sources/AedstNetwork/Generated

CODEGEN_TOOLS := buf protoc-gen-swift protoc-gen-connect-swift

# `generate` only needs the codegen tools and `install` only needs tuist, so CI jobs that run
# one of them are not forced to have the other.
.PHONY: doctor doctor-codegen doctor-tuist
doctor: TOOLS := $(CODEGEN_TOOLS) tuist
doctor-codegen: TOOLS := $(CODEGEN_TOOLS)
doctor-tuist: TOOLS := tuist
doctor doctor-codegen doctor-tuist: ## doctor: report which tools `make bootstrap` needs are missing (buf, protoc plugins, tuist) and how to get them.
	@missing=0; \
	for tool in $(TOOLS); do \
		if command -v $$tool >/dev/null 2>&1; then \
			echo "ok       $$tool"; \
		else \
			missing=1; \
			case $$tool in \
				buf) hint="brew install bufbuild/buf/buf" ;; \
				protoc-gen-swift) hint="build apple/swift-protobuf at the version in Core/AedstNetwork/Package.swift and put protoc-gen-swift on PATH (apple-ci does the same)" ;; \
				protoc-gen-connect-swift) hint="build connectrpc/connect-swift at the version in Core/AedstNetwork/Package.swift and put protoc-gen-connect-swift on PATH" ;; \
				tuist) hint="mise install (pins tuist in mise.toml)" ;; \
			esac; \
			echo "MISSING  $$tool  -> $$hint"; \
		fi; \
	done; \
	exit $$missing

.PHONY: generate
generate: doctor-codegen ## Generate Swift Connect client stubs from apps/server's proto sources (see buf.gen.yaml). Stubs are never committed.
	mkdir -p $(GENERATED_DIR)
	# Delete only generated sources: Generated/README.md is tracked (and excluded in Package.swift).
	find $(GENERATED_DIR) -name "*.swift" -delete
	buf generate $(SERVER_PROTO_DIR) \
		--template buf.gen.yaml \
		--path $(SERVER_PROTO_DIR)/aedst/appattest/v1/appattest.proto \
		--path $(SERVER_PROTO_DIR)/aedst/auth/v1/auth.proto \
		--path $(SERVER_PROTO_DIR)/aedst/capabilities/v1/capabilities.proto \
		--path $(SERVER_PROTO_DIR)/aedst/tasks/v1/tasks.proto \
		--path $(SERVER_PROTO_DIR)/aedst/notifications/v1/notifications.proto \
		--path $(SERVER_PROTO_DIR)/aedst/search/v1/search.proto \
		--path $(SERVER_PROTO_DIR)/aedst/media/v1/media.proto \
		--path $(SERVER_PROTO_DIR)/aedst/admin/v1/admin.proto
	buf generate buf.build/bufbuild/protovalidate \
		--template buf.gen.yaml \
		--path buf/validate/validate.proto
	@echo "Generated Connect-Swift stubs into $(GENERATED_DIR)"


.PHONY: build
build: generate ## swift build every local package (does not build the .xcodeproj app targets).
	for pkg in Core/* Features/* App/Shared; do \
		echo "==> swift build ($$pkg)"; \
		(cd $$pkg && swift build) || exit 1; \
	done

.PHONY: test
test: generate ## swift test every local package.
	for pkg in Core/* Features/* App/Shared; do \
		echo "==> swift test ($$pkg)"; \
		(cd $$pkg && swift test) || exit 1; \
	done

# swift-format has no exclude file: build the file list by hand (Generated/ and .build/ stay out).
SWIFT_FILES = find Core Features App -name '*.swift' -not -path '*/Generated/*' -not -path '*/.build/*' -not -path '*/.swiftpm/*' -print0

.PHONY: format
format: ## swift-format (Xcode toolchain: `swift format`) in place, config in .swift-format.
	$(SWIFT_FILES) | xargs -0 swift format format --in-place --parallel

.PHONY: format-check
format-check: ## swift format lint --strict (fails on any violation; what CI runs).
	$(SWIFT_FILES) | xargs -0 swift format lint --strict --parallel

.PHONY: lint
lint: format-check ## swift-format lint, the static policy gates, then swiftlint (semantic + custom rules) across every package.
	bash scripts/check-dependencies.sh
	bash scripts/check-apple-sensitive-apis.sh
	bash scripts/check-swiftlint-rules-static.sh
	swiftlint lint --config .swiftlint.yml --strict

.PHONY: install
install: doctor-tuist ## Resolve third-party/local Swift packages for Tuist (Tuist/Package.swift).
	tuist install

.PHONY: project
project: install ## Generate AEDST.xcodeproj / AEDST.xcworkspace with Tuist (both gitignored).
	tuist generate --no-open

.PHONY: bootstrap
bootstrap: generate project ## One-shot setup after cloning: Connect codegen + Tuist install + Xcode project.

.PHONY: tuist-build
tuist-build: ## Build both app schemes through Tuist (requires Xcode).
	tuist build App_iOS
	tuist build App_macOS

.PHONY: tuist-test
tuist-test: ## Run the app schemes' tests through Tuist (package unit tests run via `make test`).
	tuist test App_iOS
	tuist test App_macOS

.PHONY: release-ios
release-ios: ## fastlane: match + archive + upload to App Store Connect (not submitted). Needs `bundle install`, APPLE_TEAM_ID, ASC_*, MATCH_*.
	bundle exec fastlane ios release

.PHONY: beta-ios
beta-ios: ## fastlane: match + archive + upload the iOS app to TestFlight.
	bundle exec fastlane ios beta

.PHONY: release-macos
release-macos: ## fastlane: Developer ID build, notarized + stapled (DISTRIBUTION=app-store for the Mac App Store).
	bundle exec fastlane mac $(if $(filter app-store,$(DISTRIBUTION)),app_store,developer_id)

.PHONY: signing-sync
signing-sync: ## ADMIN, local: create/refresh all match certificates and profiles (not readonly).
	bundle exec fastlane match_sync

.PHONY: gem-lock
gem-lock: ## Create/refresh Gemfile.lock for CI (macos-26 arm64) from any Mac/Linux host; commit the result.
	bundle lock --add-platform arm64-darwin x86_64-darwin ruby

.PHONY: check
check: ## Repo-policy checks: boundaries, colors, file size, approved packages, sensitive APIs, custom lint rules (no Xcode needed).
	bash scripts/check-feature-boundaries.sh

.PHONY: snapshots-record snapshots-verify snapshots-status
snapshots-record: ## Mac only: re-record every design-system snapshot reference, then verify it (CI: the apple-record-snapshots workflow).
	bash scripts/snapshots.sh record

snapshots-verify: ## Mac only: verify the snapshots against the committed references (skips a platform with none).
	bash scripts/snapshots.sh verify

snapshots-status: ## Show which references are recorded and the environment they were recorded on.
	bash scripts/snapshots.sh status
