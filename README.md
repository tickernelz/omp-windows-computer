# @tickernelz/omp-windows-computer

Enterprise-grade Windows desktop automation plugin for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi), powered by the battle-tested [`cua-driver`](https://github.com/trycua/cua) native engine.

Runs seamlessly whether your OMP session is running inside **Linux WSL2** (controlling the Windows host) or **natively on Windows**.

---

## ⚡ Key Highlights: Why Use This Plugin?

### 1. 🛡️ 100% Independent from Built-in OMP `computer`
- **Zero Collision**: The plugin registers under the tool name `win_computer`, completely separate from OMP's built-in `computer` prelude.
- **Can Be Toggled Independently**: If you disable OMP's built-in `computer.enabled` setting (`computer.enabled: false`), **`win_computer` stays 100% active**.
- **Recommended for WSL2 Users**: We recommend disabling OMP's built-in `computer` when working in WSL2 (`/settings` -> disable Computer). This saves LLM system prompt tokens and ensures your agent focuses exclusively on the Windows host desktop rather than getting confused by WSLg Linux windows.

### 2. 🪟 Full Support for Native Windows OMP Users!
This plugin is **not just for WSL2** — native Windows OMP users can use it as a powerful, supercharged upgrade over the standard OMP desktop automation:
- **XAML / WinUI3 / Modern Windows 11 Support**: Reliably types into modern Windows 11 apps (Notepad, Calculator, Windows Terminal, Settings) via UIAutomation `ValuePattern` without dropped characters.
- **App Catalogue Discovery (`desktop.apps()`)**: Enumerate all installed desktop `.exe` and UWP Store apps on Windows with real-time running/active flags.
- **Micro-Inspection (`win.zoom()`)**: High-resolution zoom crops with 20% padding to inspect small UI elements, captchas, or tiny font details.
- **Native Menu Traversal (`win.invokeMenu()`)**: Execute application menus (`["File", "Save As..."]`) directly through accessibility channels without guessing dropdown pixel coordinates.
- **Window Positioning (`win.setFrame()`)**: Deterministically move, split, and tile windows on any monitor with geometry verification.
- **Force Termination (`desktop.kill(pid)`)**: Cleanly kill unresponsive processes.
- **50+ Raw Cua Tools (`desktop.driverCall()` / action: "raw")**: Unrestricted access to the entire native `cua-driver` automation surface.

---

## 🚀 Installation

Install directly into OMP using the official package manager:

```bash
omp plugin install @tickernelz/omp-windows-computer
```

For local development from source:
```bash
git clone https://github.com/tickernelz/omp-windows-computer.git
cd omp-windows-computer
omp plugin link .
```

---

## 📦 Automatic Driver Setup (Auto-Download & Auto-Update)

You don't need to manually configure binaries or background services:
- **Auto-Download**: If `cua-driver.exe` is missing on your Windows host, the plugin automatically triggers the official installer (`irm https://cua.ai/driver/install.ps1 | iex`).
- **Auto-Update**: Automatically checks GitHub releases on startup and keeps your driver updated.
- **On-Demand TUI Control**:
  - `/win-computer doctor` — End-to-end self-diagnostic (checks driver binary, permissions, display resolution, and latency).
  - `/win-computer update` — Check and trigger driver upgrades on-demand.
  - `/win-computer install` — Force-reinstall driver if needed.
  - `/win-computer apps` — Quick TUI overview of installed and running Windows applications.
  - `/win-computer windows` — List active Windows windows.
  - `/win-computer kill <pid>` — Terminate a hanging process.

---

## 💻 Usage Examples for AI Agents

### 1. Launching & Typing (Windows 11 XAML & Win32)
```ts
// 1-liner to launch any app
const win = await desktop.launch("notepad.exe");

// Automatically brings window to foreground and types without character drops
await win.type("Hello from OMP Agent!");

// Save or close via native shortcuts
await win.press(["ctrl", "s"]);
```

### 2. Single-Monitor / Targeted Screenshots (Saves Tokens!)
```ts
// Avoid huge panoramic multi-monitor screenshots by targeting specific displays
const shotD1 = await desktop.screenshot({ display: 1 });        // Left monitor
const shotD2 = await desktop.screenshot({ display: 2 });        // Right monitor
const primary = await desktop.screenshot({ display: "primary" }); // Main monitor

// Or capture only the target window area:
const winShot = await win.screenshot();
```

### 3. Native App Menus & Window Management
```ts
// Invoke menu bar items directly via accessibility
await win.invokeMenu(["File", "Page Setup..."]);

// Set window size & position on screen
await win.setFrame(100, 100, 1280, 720);

// Zoom into a specific region of a window for crystal-clear OCR/reading
const crop = await win.zoom(50, 50, 250, 150);
```

### 4. Direct UI Automation Element Interaction (AX-First)
```ts
// Find interactive UI controls by role and title
const [btn] = await win.find({ role: "button", title: "Save" });

// Click element center directly using UIA bounding boxes (no pixel guessing!)
await btn.click();
```

### 5. Full Unrestricted Tool Passthrough (`action: "raw"`)
```ts
// Call any native cua-driver tool directly
const state = await desktop.driverCall("get_screen_size", {});
```

---

## ⚙️ Settings

Configurable interactively via `/win-computer` or `omp plugin config @tickernelz/omp-windows-computer`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `driverPath` | string | `""` | Explicit path to `cua-driver.exe` (empty uses auto-discovery/auto-download) |
| `autoUpdate` | boolean | `true` | Automatically check and update `cua-driver` on launch |
| `maxWidth` | number | `3840` | Screenshot downscale width limit in pixels |
| `maxHeight` | number | `2400` | Screenshot downscale height limit in pixels |
| `imageFormat` | enum (`png`, `jpeg`) | `png` | Image encoding format |
| `callTimeoutMs`| number | `45000` | Tool call deadline in milliseconds |

---

## 📄 License

MIT (c) 2026 Zhafron
