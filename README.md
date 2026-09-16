# @tickernelz/omp-windows-computer

Windows host desktop automation bridge for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) running under WSL2 or natively on Windows.

## Overview

When OMP runs inside Linux WSL2, the built-in `computer` eval prelude binds strictly to local Linux Wayland/X11 and AT-SPI D-Bus interfaces. This extension bridges OMP in WSL2 directly to the **Windows host desktop** via a persistent, high-performance PowerShell/Win32 JSON-RPC worker without installing heavy runtimes or daemons on Windows.

## Features

- **Built-in Parity**: Provides `win_computer` tool matching the exact API surface, vocabulary, and coordinate conventions of OMP's native desktop automation (`displays`, `windows`, `screenshot`, `click`, `move`, `drag`, `scroll`, `type`, `press`, `ax`, `find`, `clipboard`).
- **UI Automation (AX-First)**: Full text-based accessibility tree walks with `[ref=eN]` tags and generational ref retention.
- **DWM Frame Accuracy**: Resolves true window bounds using `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)`, stripping invisible drop-shadow borders.
- **Sub-10ms Enumeration**: Native C# P/Invoke window enumeration and process image resolution inside the persistent worker.
- **Interactive Slash Command**: Built-in `/win-computer` command to inspect, configure, and self-diagnose host connectivity.
- **Universal Portability**: Dynamically resolves drvfs mounts (`/proc/mounts`), Windows temp folders, and PowerShell binaries. Supports both WSL2 and native Windows.

## Installation

```bash
omp plugin install @tickernelz/omp-windows-computer
```

For local development:
```bash
omp plugin link ~/Projects/omp-windows-computer
```

## Settings

Settings are stored in OMP's official plugin store (`~/.omp/plugins/omp-plugins.lock.json`) and configurable via `/win-computer` or `omp plugin config`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `shell` | enum (`auto`, `ps5`, `pwsh7`) | `auto` | PowerShell host executable |
| `maxWidth` | number | `3840` | Screenshot downscale width limit |
| `maxHeight` | number | `2400` | Screenshot downscale height limit |
| `imageFormat` | enum (`png`, `jpeg`) | `png` | Image encoding format |
| `jpegQuality` | number | `82` | Quality factor for JPEG screenshots |
| `includeCloaked` | boolean | `false` | Include invisible DWM-cloaked windows |
| `raiseBeforeInput` | boolean | `true` | Restore & focus window before input |
| `axMaxDepth` | number | `12` | Default accessibility tree depth |
| `axMaxNodes` | number | `800` | Node cutoff limit for accessibility trees |
| `callTimeoutMs` | number | `30000` | RPC call deadline |
| `captureTimeoutMs`| number | `60000` | Screenshot/AX snapshot deadline |

## License

MIT (c) 2026 Zhafron
