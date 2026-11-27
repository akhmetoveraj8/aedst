---
title: "Desktop: Slint and Rust rules"
description: "apps/desktop: official Slint 1.19 and Rust guidance turned into rules (threading, models and lists, images, renderer, performance, security, release build), plus the gaps found in the 2026-11-28 audit."
---

# Desktop: Slint and Rust rules

Rules for every `.slint` view and every Slint-aware Rust file (`ui_glue.rs` / `ui_glue_body.rs`, the shell). Each rule cites the official source it comes from; the API pages were read for **slint 1.19.1** (docs.rs) and tokio 1.54.1 on 2026-11-28. Some docs.slint.dev guide pages are marked "next version"; a point taken only from such a page, or not stated by any page, says so. Levels as in [CONVENTIONS.md](../../../CONVENTIONS.md): **Must**, **Should**, **Could**.

**The main rule: do not overload Slint.** The UI thread only copies finished data into properties and reacts to input. Network, disk, decoding, sorting, diffing and anything else that takes time run elsewhere and come back through the event loop.

## 1. Threads and the event loop

| ID | Rule | Level | Source |
|---|---|---|---|
| T1 | The Slint event loop runs on the main thread, and every component is created on that thread. Keep its work minimal so animations and input are not blocked. | Must | [docs.rs/slint, Threading](https://docs.rs/slint/latest/slint/) |
| T2 | No network request, file or SQLite access, image decode or other blocking or CPU-heavy call in a Slint callback or in a closure that runs on the event loop. A callback hands the work to the app's tokio runtime (`runtime.spawn`) and returns. | Must | same; [tokio task docs](https://docs.rs/tokio/latest/tokio/task/index.html) |
| T3 | Results return to the UI only through `Weak::upgrade_in_event_loop` (or `slint::invoke_from_event_loop`). Never `Weak::unwrap()` / `upgrade()` off the UI thread: `upgrade()` returns `None` there and `unwrap()` panics. | Must | [Weak](https://docs.rs/slint/latest/slint/struct.Weak.html), [invoke_from_event_loop](https://docs.rs/slint/latest/slint/fn.invoke_from_event_loop.html) |
| T4 | A callback captures `ui.as_weak()`, never a strong handle: a strong handle in a callback is a reference cycle and leaks the window. | Must | [Weak](https://docs.rs/slint/latest/slint/struct.Weak.html) |
| T5 | Do not drive tokio futures with `slint::spawn_local`: Slint cannot drive tokio and such futures may never finish. Use the app's own multi-thread runtime (built in `main`, not `#[tokio::main]`, which the Slint docs call "not recommended"). | Must | [spawn_local](https://docs.rs/slint/latest/slint/fn.spawn_local.html) |
| T6 | `ModelRc`, `VecModel`, `SortModel` and `Image` are not `Send`: build plain data (or a `SharedPixelBuffer`) off-thread and create the Slint type inside the event-loop closure. | Must | [ModelRc](https://docs.rs/slint/latest/slint/struct.ModelRc.html), [Image](https://docs.rs/slint/latest/slint/struct.Image.html) |
| T7 | `slint::Timer` fires only on the event-loop thread and stops when dropped: keep the handle where it must live, and use `tokio::time` for timing in the runtime. | Must | [Timer](https://docs.rs/slint/latest/slint/struct.Timer.html) |
| T8 | `tokio::task::spawn_blocking` is for short, bounded blocking work (a file read, a decode). Long-lived blocking work gets its own thread (as `aedst-persistence` does for SQLite). CPU-heavy batches are throttled with a `Semaphore`. A started blocking task cannot be aborted, so check a cancellation flag inside long ones. | Must | [spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html) |
| T9 | Shut the runtime down with `shutdown_timeout` after `ui.run()` returns, so a stuck blocking task cannot hang the exit. | Should | same |
| T10 | Show the window first, then build the slow services (database open and migrations, OS trust store, consent load) on the runtime; the window shows a loading state meanwhile. | Should | T1 (inference) |

## 2. Models and long lists

| ID | Rule | Level | Source |
|---|---|---|---|
| M1 | A list that can grow past one screen (feeds, inboxes, search results, chat threads, media libraries, audit logs) is a `ListView` with a single `for` as its only child. `ListView` instantiates only visible rows (variable row heights are supported; `content-height` is an estimate); a `for` in a `Flickable`, `ScrollView` or layout instantiates every row. The `for` must sit DIRECTLY in an element whose type is named `ListView`: the 1.19.1 compiler compares the parent's type name with "ListView" (`internal/compiler/object_tree.rs`, `from_repeated_node`) and does not follow inheritance, and `@children` inside a `ListView` is a compile error. So a kit wrapper (`AedstList inherits ListView`, or a component holding `ListView { @children }`) CANNOT virtualise a feature's rows; a kit component may use `ListView` with a `for` in its own body (as `AedstAiChat` does). | Must | [ListView](https://docs.slint.dev/latest/docs/slint/reference/std-widgets/views/listview/), [repetition](https://docs.slint.dev/latest/docs/slint/reference/language/repetition-and-conditional-elements/), source v1.19.1 |
| M2 | A plain `for` in a layout is fine only for short, bounded content (menus, tabs, a breadcrumb, at most a few dozen rows). | Should | same |
| M3 | Keep ONE model per list for the life of the screen: hold an `Rc<VecModel<T>>`, give the UI `ModelRc::from(rc.clone())` once, then update rows (`set_row_data`, `push`, `insert`, `remove`, `extend`). Never `set_rows(ModelRc::new(VecModel::from(..)))` on every update: a new model rebuilds every row and drops scroll position, focus and row state. "It is more efficient to operate on the model and send changes through the ModelNotify rather than resetting the property with a different model." | Must | [Model](https://docs.rs/slint/latest/slint/trait.Model.html), [ModelRc](https://docs.rs/slint/latest/slint/struct.ModelRc.html) |
| M4 | Use `aedst_slint_model::apply_rows(get, set, rows)` in `ui_glue.rs`: it keeps the property's `VecModel`, compares rows by position and emits `row_changed` / `row_removed` / one `row_added` for appended pages (a linear compare of small structs on the UI thread). `VecModel::set_vec` and `clear` emit a full `reset` (source v1.19.1, `internal/core/model.rs`): use them only for a real reset (sign-out). | Should | [VecModel](https://docs.rs/slint/latest/slint/struct.VecModel.html), source v1.19.1 |
| M5 | A custom `Model` calls its `ModelNotify` (`row_changed`, `row_added`, `row_removed`, `reset`) on every change and implements `as_any`. | Must | [Model](https://docs.rs/slint/latest/slint/trait.Model.html), [ModelNotify](https://docs.rs/slint/latest/slint/struct.ModelNotify.html) |
| M6 | Filtering and sorting of a loaded list use the `ModelExt` adapters (`filter`, `sort_by`, `map`) over the same source model, not a copied vector; call `reset()` on the adapter when its closure depends on state that changed. | Should | [ModelExt](https://docs.rs/slint/latest/slint/trait.ModelExt.html), [FilterModel](https://docs.rs/slint/latest/slint/struct.FilterModel.html) |
| M7 | Lists are paged from the server (`load_more` near the end of the list) and keep a bounded number of loaded rows; never fetch a whole collection. | Must | project rule |
| M8 | App state (session, router, caches) lives in services; screen state lives in that feature's controller and its `*Store` global. A screen does not read another screen's store. | Must | [architecture](/desktop/architecture) |

## 3. Images and media

| ID | Rule | Level | Source |
|---|---|---|---|
| I1 | Never decode an image on the UI thread, and never call `Image::load_from_path` for a network or user file there. Download and decode in the runtime (`spawn_blocking`), under pixel and allocation caps (see `aedst-feature-media` `viewer::decode`). | Must | [Image](https://docs.rs/slint/latest/slint/struct.Image.html) |
| I2 | Fill the `SharedPixelBuffer<Rgba8Pixel>` off the UI thread (it is `Send` and reference counted) and only call `Image::from_rgba8` on the event loop, which wraps the buffer without copying (source v1.19.1). Do not copy pixels on the UI thread, and do not rebuild the image when a publish keeps the same picture. | Must | [SharedPixelBuffer](https://docs.rs/slint/latest/slint/struct.SharedPixelBuffer.html), [Image](https://docs.rs/slint/latest/slint/struct.Image.html) |
| I3 | Resize to the size it is shown at (times the scale factor) before handing it to Slint: a thumbnail is a thumbnail, a viewer image is capped at the window size. A 40-megapixel texture costs about 160 MB. The docs give no downscaling guidance (UNVERIFIED); this is our rule. | Must | project rule |
| I4 | Build a `slint::Image` once per picture and keep it (bounded LRU keyed by media id and size); re-applying a view must not rebuild unchanged images. | Should | project rule |
| I5 | Images in a list load on demand, for visible rows only (M1), with a placeholder until ready; a result for a row that scrolled away or a viewer that closed is dropped. | Must | project rule |
| I6 | Bundled assets (icons, illustrations) are SVG or PNG referenced from `.slint` with `@image-url` and embedded by the compiler; other formats need the `image-default-formats` feature. | Should | [Image](https://docs.rs/slint/latest/slint/struct.Image.html) |

## 4. Renderer, backend and features

| ID | Rule | Level | Source |
|---|---|---|---|
| R1 | Choose the renderer explicitly in `[workspace.dependencies]` instead of relying on `slint`'s default features (1.19.1 defaults: `std`, `backend-default`, `renderer-femtovg`, `renderer-software`, `accessibility`, `compat-1-2`, `system-tray`). If default features are turned off, keep `std`, `compat-1-2` and `accessibility`. | Must | [features](https://docs.rs/crate/slint/latest/features), [cargo_features](https://docs.rs/slint/latest/slint/docs/cargo_features/index.html) |
| R2 | Renderer trade-offs. Software: no GPU, no rotation or scaling, no layer opacity. FemtoVG: OpenGL (wgpu variant for D3D/Vulkan), small, text and path quality "sometimes sub-optimal". Skia: full GPU acceleration (OpenGL, Vulkan, Direct3D), "heavy disk-footprint". An image-, video- and animation-heavy app needs a GPU renderer; the choice (Skia or FemtoVG) is a recorded decision in [decisions/desktop](/decisions/desktop) and is measured on Windows and Linux before it is made. The docs make no explicit recommendation (UNVERIFIED). | Must | [backends and renderers](https://docs.slint.dev/latest/docs/slint/guide/backends-and-renderers/backends_and_renderers/) |
| R3 | The software renderer stays compiled in as the fallback for machines without working GPU drivers (winit tries Skia, then FemtoVG, then software). Support asks users to set `SLINT_BACKEND=winit-software` to rule out a driver problem. | Should | [winit backend](https://docs.slint.dev/latest/docs/slint/guide/backends-and-renderers/backend_winit/) |
| R4 | Backend: winit on Windows and Linux (X11 and Wayland). Qt is not a default feature and is not used. | Must | same |
| R5 | `accessibility` stays on: it exposes the element tree to UI Automation and AT-SPI. | Must | [cargo_features](https://docs.rs/slint/latest/slint/docs/cargo_features/index.html) |

## 5. Performance of `.slint` code

| ID | Rule | Level | Source |
|---|---|---|---|
| P1 | Bindings are lazy and dependency-tracked: keep them pure and cheap (no callbacks into Rust that compute, no string building over a model inside a row). Binding loops are errors. | Must | [reactivity](https://docs.slint.dev/latest/docs/slint/guide/language/concepts/reactivity/) |
| P2 | `visible: false` keeps the element (and its layout space) alive; use `if` to remove a screen or a heavy panel. The shell already switches sections with `if`. | Must | [common properties](https://docs.slint.dev/latest/docs/slint/reference/common/) |
| P3 | `opacity` below 1 draws the subtree through an intermediate layer: do not animate opacity on large subtrees or on every row. | Should | same |
| P4 | `cache-rendering-hint: true` only on complex subtrees that rarely change; it costs memory and not every renderer supports it. | Could | same |
| P5 | No thousands of live elements: every row is a few elements, decorative layers are flattened, a long list follows M1. Count rows times elements per row when reviewing a list. | Must | [ListView](https://docs.slint.dev/latest/docs/slint/reference/std-widgets/views/listview/) |
| P6 | Measure before and after a UI performance change: `SLINT_DEBUG_PERFORMANCE=refresh_full_speed,overlay` (or `console`); `SLINT_SLOW_ANIMATIONS=<factor>` for animations. Which renderers support it in 1.19 is UNVERIFIED. | Should | [debugging techniques](https://docs.slint.dev/latest/docs/slint/guide/development/debugging_techniques/) |

## 6. Security and robustness in the UI

| ID | Rule | Level | Source |
|---|---|---|---|
| U1 | Text from the server or the user is shown as plain text. `StyledText` only from our own markdown; untrusted input goes through `StyledText::from_plain_text`. | Must | [StyledText (Rust)](https://docs.rs/slint/latest/slint/struct.StyledText.html), [StyledText (element)](https://docs.slint.dev/latest/docs/slint/reference/elements/styledtext/) |
| U2 | A link from `link-clicked` or a kit link component is never opened directly: in-app links go through `Router::open_link` (allow-list), external ones only with an `https` scheme through the system browser. The Slint docs give no URL guidance (UNVERIFIED); this is our rule. | Must | project rule |
| U3 | Decoders and parsers that take untrusted bytes run off-thread with size caps (I1); a failure is an error state, never a panic. | Must | project rule |
| U4 | Strings in `.slint` use `@tr("<module>" => "...")` with the module as context (the generated `msgctxt`); bundled translations are selected with `select_bundled_translation` after the first component is created. Details: [i18n](/desktop/i18n). | Must | [translations](https://docs.slint.dev/latest/docs/slint/guide/development/translations/), [select_bundled_translation](https://docs.rs/slint/latest/slint/fn.select_bundled_translation.html) |
| U5 | `EmbedResourcesKind::AsAbsolutePath` is for debugging only; a release embeds its resources (`EmbedFiles`; `EmbedForSoftwareRenderer` is not usable by Skia or FemtoVG). | Must | [EmbedResourcesKind](https://docs.rs/slint-build/latest/slint_build/enum.EmbedResourcesKind.html) |

## 7. Release build (Rust)

| ID | Rule | Level | Source |
|---|---|---|---|
| B1 | The binary crate root has `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`, so a release build opens no console window on Windows (ignored elsewhere). | Must | [Rust reference: windows_subsystem](https://doc.rust-lang.org/reference/runtime.html) |
| B2 | The workspace has an explicit `[profile.release]`: `lto = "thin"` (or `"fat"` once build time is measured), `codegen-units = 1`, and debug info split out for crash symbolication (`debug = "line-tables-only"` with `split-debuginfo` and uploaded symbols) rather than shipped. `panic` stays `unwind`, because the crash reporter's panic hook and the crash-loop guard need it. | Should | [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) |
| B3 | Measure the release binary size and cold-start time for each renderer choice (R2) and record them with the decision. | Should | project rule |

## Known gaps (audit 2026-11-28; fixes marked below were written without a Rust toolchain)

| Rule | Where | Gap |
|---|---|---|
| M1, P5 | `ui/*.slint` of tasks, search, notifications, media, admin | **Fixed in code 2026-11-28, not compiled**: every paged list (tasks, search hits, notifications, media, admin tasks and audit) is a `ListView` with the `for` directly inside; spacing moved into each row (`padding-bottom`). Gates D5 and `check:ui-kit-only` allow exactly `import { ListView }` from `std-widgets.slint`. Still open: "Load more" stays a button (no near-end trigger), and the look of the std `ListView` scrollbar against the kit tokens was never seen. |
| M3 | `ui_glue.rs` `apply` of the same five features | **Fixed in code 2026-11-28, not compiled**: `apply_rows` from the new `aedst-slint-model` crate replaces `ModelRc::new(VecModel::from(rows))`. |
| I2, I3 | `aedst-feature-media` `viewer::decode`, `ui_glue.rs` | **Fixed in code 2026-11-28, not compiled**: `decode` downscales to `MAX_DISPLAY_EDGE` (2560 px) on the blocking thread; the viewer loop builds the `SharedPixelBuffer` on the runtime only when the picture changes, and the UI thread only wraps it (`PictureUpdate`). |
| I4, I5 | media | No image cache yet; the library list shows no thumbnails, so on-demand loading per row is not needed yet. |
| B1 | `aedst-desktop/src/main.rs` | **Fixed in code 2026-11-28, not compiled**: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`. |
| B2, R1 | `apps/desktop/Cargo.toml` | **Fixed in code 2026-11-28, not compiled**: `[profile.release]` (thin LTO, one codegen unit, split line tables); `slint` with default features off and the set listed there (drops the unused `system-tray`). |
| R2, B3 | `apps/desktop/Cargo.toml` | **Open (decision)**: FemtoVG stays the GPU renderer until Skia and FemtoVG are measured (binary size, cold start, an image-heavy screen) on Windows and Linux. |
| T10 | `main.rs`, `services.rs` `Services::build` | **Fixed in code 2026-11-28, not compiled**: the window opens on "Starting..."; `Services::build` runs in `spawn_blocking` and the screens are bound in `upgrade_in_event_loop` (`attach`). |
| T9 | `main.rs` | **Fixed in code 2026-11-28, not compiled**: `runtime.shutdown_timeout(2 s)` after `ui.run()`. |
| (audit) | `main.rs` crash-loop guard | **Fixed in code 2026-11-28, not compiled**: a start is marked healthy after 60 s of uptime (on a blocking thread) as well as on a normal quit, so a log-off or OS shutdown no longer counts as a crash. |
| (audit) | `aedst-desktop/src/flow.rs` (489 lines) | **Fixed**: consent and update wiring moved to `panels.rs`; `flow.rs` is 390 lines. |

## Upstream

When Slint is bumped, re-read the pages linked above for the new version and update this page in the same change (the `i-slint-backend-testing` pin moves with it, see [decisions/desktop](/decisions/desktop)).
