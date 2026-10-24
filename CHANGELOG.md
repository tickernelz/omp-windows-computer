## 0.3.5

### Fixes
- Emit `win_computer` parameters as a single JSON object schema. The previous `anyOf` union had no top-level `type`, so providers rejected the tool with `schema must be a JSON Schema of type: "object", got type: null`.
- Drop strict-mode schema enforcement, which cannot express the optional `action`-specific fields.

## 0.3.4

### Fixes
- `desktop.window({ pid, windowId })` resolves the exact window: filter matching on pid alone listed every window and made object selectors throw AmbiguousWindow.

## 0.3.3

### Cua-Driver 0.38.0 Alignment
- Address elements by `element_token`: `element_index` and `snapshot_id` are no longer sent, matching the 0.38 input schemas of `click`, `type_text`, `set_value`, `scroll`, `hotkey`, and `press_key`.
- Request `tree_format: "elements"` from `find()` and `ref()`: 0.38 returns Markdown-only by default, which left the element array empty.
- Snapshots that carry only `element_index` (older drivers) still fall back to `window_id` + `element_index`; 0.28.2 ignores `tree_format` and keeps returning elements.
- Verified on both 0.38.0 and 0.28.2: token addressing, window and desktop capture, and identical shapes for `get_screen_size`, `list_windows`, and `get_accessibility_tree`.

### Included Unreleased 0.3.2 Work
- Pass `additional_arguments` to `launch_app` and reuse the window returned by the launch instead of polling.
- Add screenshot downscale/encode settings (`maxWidth`, `maxHeight`, `imageFormat`) and route captures through the image optimizer.
- Request `include_screenshot: false` from `ax()` and `find()` to cut snapshot payloads.

## 0.3.1

### Optimizations & Workflow Enhancements
- Auto-compress and downscale screenshots to lightweight JPEG (<100KB, max 1280px) automatically in screenshot() pipeline, eliminating OMP memory-limit crashes and manual ffmpeg conversion turns.
- Add desktop.openUrl(url, browser?) for 1-step reliable website opening in Chrome, Zen, Edge, or Windows default browser.
- Add win.navigate(url) for instant atomic browser tab navigation via address bar selection, clipboard paste, and Return dispatch.

## 0.3.0

### Features (Full Cua-Driver Capability Alignment)
- Add desktop.apps() to list all Windows apps (desktop and UWP) with live running/active flags.
- Add desktop.kill(pid) to force-terminate unresponsive processes.
- Add desktop.driverCall(toolName, params) for raw full-surface passthrough to all 50+ native cua-driver tools.
- Add win.setFrame(x, y, w, h) for verified window repositioning and resizing.
- Add win.zoom(x1, y1, x2, y2) for native-resolution regional inspection of micro-text and icons.
- Add win.invokeMenu(path) for native application menu tree invocation via UIA.
- Add win.verify(expect) for deterministic multi-predicate UI condition evaluation.
- Add action: "raw" to win_computer tool schema for unrestricted LLM tool access.
- Add /win-computer apps and /win-computer kill commands to TUI slash interface.

## 0.2.0

### Architecture Migration (Cua-Driver Engine)
- Migrate native backend from PowerShell win32-worker.ps1 script to trycua/cua driver (`cua-driver.exe`).
- Full support for Windows 11 modern XAML/WinUI3 apps (Notepad, Calculator, Settings) via UIAutomation `ValuePattern` and `WM_CHAR` without character drops.
- Add automated driver discovery via `HERMES_CUA_DRIVER_CMD` and standard LocalAppData paths.
- Add automated download/installer support via official installer (`irm https://cua.ai/driver/install.ps1 | iex`).
- Add auto-update check on session launch and manual update via `/win-computer update`.
- Remove legacy PowerShell P/Invoke marshalling and staging files.

## 0.1.2

### Features
- Add desktop.launch(app, args, options) for 1-liner application launching.
- Add display selector to screenshot ({ display: 1 | 2 | "primary" | "all" }) to eliminate token waste on multi-monitor setups.
- Add auto-raise settling guarantee before native input on ComputerWindow.
- Add bounds-aware direct clicking and focus-aware typing on ComputerElement.
- Add automated 24-hour cleanup of stale temporary screenshot directories.

## 0.1.1

### Fixes
- Fix PowerShell UIAutomation BoundingRectangle emitting Infinity/NaN.
- Bound ax.query depth to avoid timeouts on browser trees.

## 0.1.0

### Features
- Initial release of @tickernelz/omp-windows-computer.
- High-performance persistent Win32/C# JSON-RPC worker via PowerShell.
- Built-in `win_computer` tool matching OMP native desktop automation.
- Full UI Automation (AX) accessibility tree walker with generational ref retention.
- DWM-aware window boundary and multi-monitor screen capture.
- Interactive `/win-computer` slash command with host diagnostic (`/win-computer doctor`).
- Portability across Linux WSL2 and native Windows.
