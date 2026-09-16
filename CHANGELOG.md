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
