# win32-worker.ps1: High-performance persistent Win32 / UIAutomation JSON-RPC worker
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding  = New-Object System.Text.UTF8Encoding $false

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes

Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class OmpWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION u;
  }

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern short VkKeyScanW(char ch);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr hObject);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref int lpdwSize);

  public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }

  public static void SendInputChecked(INPUT[] inputs) {
    if (inputs == null || inputs.Length == 0) return;
    uint sent = SendInput((uint)inputs.Length, inputs, InputSize());
    if (sent != (uint)inputs.Length) {
      int err = Marshal.GetLastWin32Error();
      throw new Exception(string.Format("SendInputFailed: sent {0} of {1}, GetLastError={2}", sent, inputs.Length, err));
    }
  }

  public static string GetProcessImageName(uint pid) {
    if (pid == 0) return "";
    IntPtr hProc = OpenProcess(0x1000, false, pid);
    if (hProc == IntPtr.Zero) return "";
    try {
      var sb = new StringBuilder(1024);
      int size = sb.Capacity;
      if (QueryFullProcessImageNameW(hProc, 0, sb, ref size)) {
        string full = sb.ToString();
        int idx = full.LastIndexOf('\\');
        string file = (idx >= 0) ? full.Substring(idx + 1) : full;
        if (file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
          file = file.Substring(0, file.Length - 4);
        }
        return file;
      }
      return "";
    } finally {
      CloseHandle(hProc);
    }
  }

  private static void EscapeJsonString(StringBuilder sb, string s) {
    if (s == null) { sb.Append("null"); return; }
    sb.Append('"');
    for (int i = 0; i < s.Length; i++) {
      char c = s[i];
      switch (c) {
        case '\\': sb.Append("\\\\"); break;
        case '"': sb.Append("\\\""); break;
        case '\b': sb.Append("\\b"); break;
        case '\f': sb.Append("\\f"); break;
        case '\n': sb.Append("\\n"); break;
        case '\r': sb.Append("\\r"); break;
        case '\t': sb.Append("\\t"); break;
        default:
          if (c < ' ') {
            sb.AppendFormat("\\u{0:x4}", (int)c);
          } else {
            sb.Append(c);
          }
          break;
      }
    }
    sb.Append('"');
  }

  public static string EnumerateWindowsJson(bool includeCloaked, bool includeMinimized) {
    var sb = new StringBuilder(4096);
    sb.Append('[');
    bool first = true;
    IntPtr foreground = GetForegroundWindow();

    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      bool isIconic = IsIconic(hWnd);
      if (isIconic && !includeMinimized) return true;

      int len = GetWindowTextLengthW(hWnd);
      if (len == 0) return true;

      int cloaked = 0;
      DwmGetWindowAttribute(hWnd, 14, out cloaked, 4);
      if (cloaked != 0 && !includeCloaked) return true;

      var titleSb = new StringBuilder(len + 2);
      GetWindowTextW(hWnd, titleSb, titleSb.Capacity);
      string title = titleSb.ToString();

      uint pid = 0;
      GetWindowThreadProcessId(hWnd, out pid);
      string app = GetProcessImageName(pid);

      RECT r = new RECT();
      int hr = DwmGetWindowAttribute(hWnd, 9, out r, Marshal.SizeOf(typeof(RECT)));
      if (hr != 0) {
        GetWindowRect(hWnd, out r);
      }

      int width = r.Right - r.Left;
      int height = r.Bottom - r.Top;

      if (!first) sb.Append(',');
      first = false;

      sb.Append("{\"id\":");
      EscapeJsonString(sb, "hwnd:" + hWnd.ToInt64().ToString());
      sb.Append(",\"app\":");
      EscapeJsonString(sb, app);
      sb.Append(",\"title\":");
      EscapeJsonString(sb, title);
      sb.AppendFormat(",\"pid\":{0},\"x\":{1},\"y\":{2},\"width\":{3},\"height\":{4},\"focused\":{5},\"minimized\":{6},\"cloaked\":{7}}}",
        pid, r.Left, r.Top, width, height, (hWnd == foreground) ? "true" : "false", isIconic ? "true" : "false", (cloaked != 0) ? "true" : "false");

      return true;
    }, IntPtr.Zero);

    sb.Append(']');
    return sb.ToString();
  }
}
"@

$dpiAwareMode = "none"
try {
  if ([OmpWin32]::SetProcessDpiAwarenessContext([IntPtr](-4))) {
    $dpiAwareMode = "per-monitor-v2"
  } elseif ([OmpWin32]::SetProcessDPIAware()) {
    $dpiAwareMode = "system"
  }
} catch {
  try { [void][OmpWin32]::SetProcessDPIAware(); $dpiAwareMode = "system" } catch {}
}

$inputSize = [OmpWin32]::InputSize()
if ($inputSize -ne 40) {
  [Console]::Out.WriteLine((@{ ready = $false; error = "INPUT struct marshalling is $inputSize bytes, expected 40" } | ConvertTo-Json -Compress))
  exit 1
}

$script:refs = @{}
$script:refGeneration = 0
$script:currentGen = 0
$script:previousGen = 0
$script:refIndex = 0

function Prune-Screenshots($dir, $keep) {
  if ($keep -le 0 -or !(Test-Path $dir)) { return }
  try {
    $files = Get-ChildItem -Path $dir -File | Sort-Object CreationTime
    if ($files.Count -gt $keep) {
      $toRemove = $files | Select-Object -First ($files.Count - $keep)
      foreach ($f in $toRemove) { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
}

function Walk-UiaNode($element, $depth, $maxDepth, $maxNodes, $all, [ref]$count, [ref]$sb) {
  if ($depth -gt $maxDepth -or $count.Value -ge $maxNodes) { return }

  $walker = if ($all) { [System.Windows.Automation.TreeWalker]::RawViewWalker } else { [System.Windows.Automation.TreeWalker]::ControlViewWalker }
  $child = $walker.GetFirstChild($element)

  while ($null -ne $child -and $count.Value -lt $maxNodes) {
    $count.Value++
    $script:refIndex++
    $tag = "e$($script:refIndex)"
    $script:refs[$tag] = @{ element = $child; generation = $script:currentGen }

    $c = $child.Current
    $role = $c.ControlType.ProgrammaticName.Replace("ControlType.", "").ToLower()
    $name = $c.Name
    $isEnabled = $c.IsEnabled

    $indent = "  " * $depth
    $line = "{0}- {1}" -f $indent, $role
    if (![string]::IsNullOrEmpty($name)) {
      $escapedName = $name.Replace('"', '\"')
      $line += " `"$escapedName`""
    }
    $line += " [ref=$tag]"
    if (!$isEnabled) {
      $line += " (disabled)"
    }

    $sb.Value.AppendLine($line)

    Walk-UiaNode $child ($depth + 1) $maxDepth $maxNodes $all $count $sb
    $child = $walker.GetNextSibling($child)
  }
}

function Resolve-Ref($tag) {
  if (!$script:refs.ContainsKey($tag)) {
    throw "StaleRef: element '$tag' has expired; re-take win.ax() snapshot"
  }
  $item = $script:refs[$tag]
  if ($item.generation -ne $script:currentGen -and $item.generation -ne $script:previousGen) {
    throw "StaleRef: element '$tag' has expired; re-take win.ax() snapshot"
  }
  return $item.element
}

$readyPayload = @{
  ready = $true
  inputSize = $inputSize
  apartment = [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString()
  psVersion = $PSVersionTable.PSVersion.ToString()
  dpiAware = $dpiAwareMode
}
[Console]::Out.WriteLine(($readyPayload | ConvertTo-Json -Compress))
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $trimmed = $line.Trim()
  if ($trimmed -eq '') { continue }

  $reqId = $null
  try {
    $req = $trimmed | ConvertFrom-Json
    $reqId = $req.id
    $method = $req.method
    $p = $req.params

    switch ($method) {
      'ping' {
        $res = @{ pong = $true }
      }

      'capabilities' {
        $screens = [System.Windows.Forms.Screen]::AllScreens
        $res = @{
          backend = "win32"
          displayServer = "windows"
          capture = $true
          input = $true
          ax = $true
          backgroundWindowInput = $false
          deliveryModes = @("foreground")
          capturePermission = "granted"
          inputPermission = "granted"
          axPermission = "granted"
          displayCount = $screens.Count
        }
      }

      'displays' {
        $screens = [System.Windows.Forms.Screen]::AllScreens
        $vx = [OmpWin32]::GetSystemMetrics(76)
        $vy = [OmpWin32]::GetSystemMetrics(77)
        $dispList = @()
        foreach ($s in $screens) {
          $scale = 1.0
          try {
            $hW = [OmpWin32]::GetForegroundWindow()
            $dpi = [OmpWin32]::GetDpiForWindow($hW)
            if ($dpi -gt 0) { $scale = [Math]::Round($dpi / 96.0, 2) }
          } catch {}
          $dispList += @{
            id = $s.DeviceName
            name = $s.DeviceName
            x = $s.Bounds.X
            y = $s.Bounds.Y
            width = $s.Bounds.Width
            height = $s.Bounds.Height
            scale = $scale
            pixelX = ($s.Bounds.X - $vx)
            pixelY = ($s.Bounds.Y - $vy)
            pixelWidth = $s.Bounds.Width
            pixelHeight = $s.Bounds.Height
            isPrimary = $s.Primary
          }
        }
        $res = $dispList
      }

      'windows' {
        $incCloaked = if ($null -ne $p.includeCloaked) { [bool]$p.includeCloaked } else { $false }
        $incMin = if ($null -ne $p.includeMinimized) { [bool]$p.includeMinimized } else { $true }
        $jsonStr = [OmpWin32]::EnumerateWindowsJson($incCloaked, $incMin)
        [Console]::Out.WriteLine('{"id":' + $reqId + ',"ok":true,"result":' + $jsonStr + '}')
        [Console]::Out.Flush()
        continue
      }

      'capture' {
        $vx = [OmpWin32]::GetSystemMetrics(76)
        $vy = [OmpWin32]::GetSystemMetrics(77)
        $vw = [OmpWin32]::GetSystemMetrics(78)
        $vh = [OmpWin32]::GetSystemMetrics(79)

        $srcW = $vw
        $srcH = $vh
        $srcX = $vx
        $srcY = $vy
        $target = $p.target

        $isWindow = ($target -match '^hwnd:(\d+)$')
        $hWnd = [IntPtr]::Zero
        if ($isWindow) {
          $hWnd = [IntPtr][int64]$matches[1]
          $r = New-Object OmpWin32+RECT
          $hr = [OmpWin32]::DwmGetWindowAttribute($hWnd, 9, [ref]$r, 16)
          if ($hr -ne 0) { [void][OmpWin32]::GetWindowRect($hWnd, [ref]$r) }
          $srcX = $r.Left
          $srcY = $r.Top
          $srcW = [Math]::Max(1, $r.Right - $r.Left)
          $srcH = [Math]::Max(1, $r.Bottom - $r.Top)
        }

        $bmp = New-Object System.Drawing.Bitmap $srcW, $srcH
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $captured = $false

        if ($isWindow) {
          $hdc = $g.GetHdc()
          try {
            $captured = [OmpWin32]::PrintWindow($hWnd, $hdc, 2)
          } finally {
            $g.ReleaseHdc($hdc)
          }
        }

        if (!$captured) {
          $g.CopyFromScreen($srcX, $srcY, 0, 0, (New-Object System.Drawing.Size $srcW, $srcH))
        }

        $maxW = if ($p.maxWidth) { [int]$p.maxWidth } else { 3840 }
        $maxH = if ($p.maxHeight) { [int]$p.maxHeight } else { 2400 }
        $scaleFactor = [Math]::Min(1.0, [Math]::Min($maxW / $srcW, $maxH / $srcH))
        $outW = [int][Math]::Round($srcW * $scaleFactor)
        $outH = [int][Math]::Round($srcH * $scaleFactor)

        $outBmp = $bmp
        if ($scaleFactor -lt 1.0) {
          $outBmp = New-Object System.Drawing.Bitmap $outW, $outH
          $gOut = [System.Drawing.Graphics]::FromImage($outBmp)
          $gOut.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $gOut.DrawImage($bmp, 0, 0, $outW, $outH)
          $gOut.Dispose()
        }

        $outPath = $p.path
        $outDir = [System.IO.Path]::GetDirectoryName($outPath)
        if (![string]::IsNullOrEmpty($outDir) -and !(Test-Path $outDir)) {
          [void][System.IO.Directory]::CreateDirectory($outDir)
        }

        $fmt = if ($p.format -eq "jpeg") { [System.Drawing.Imaging.ImageFormat]::Jpeg } else { [System.Drawing.Imaging.ImageFormat]::Png }
        $outBmp.Save($outPath, $fmt)

        $fileSize = (Get-Item $outPath).Length
        $keep = if ($null -ne $p.keepScreenshots) { [int]$p.keepScreenshots } else { 50 }
        Prune-Screenshots $outDir $keep

        $g.Dispose()
        $bmp.Dispose()
        if ($outBmp -ne $bmp) { $outBmp.Dispose() }

        $res = @{
          path = $outPath
          width = $outW
          height = $outH
          sourceWidth = $srcW
          sourceHeight = $srcH
          bytes = $fileSize
        }
      }

      'raiseWindow' {
        $hWnd = [IntPtr][int64]$p.hwnd
        [void][OmpWin32]::ShowWindow($hWnd, 9)
        [void][OmpWin32]::SetForegroundWindow($hWnd)
        $ok = $false
        for ($i = 0; $i -lt 10; $i++) {
          if ([OmpWin32]::GetForegroundWindow() -eq $hWnd) { $ok = $true; break }
          Start-Sleep -Milliseconds 50
        }
        if (!$ok) {
          $fg = [OmpWin32]::GetForegroundWindow()
          throw "RaiseFailed: window hwnd:$($hWnd.ToInt64()) failed to become foreground. Current foreground is hwnd:$($fg.ToInt64())"
        }
        $res = @{ raised = $true }
      }

      'input.mouse' {
        $vx = [OmpWin32]::GetSystemMetrics(76)
        $vy = [OmpWin32]::GetSystemMetrics(77)
        $vw = [OmpWin32]::GetSystemMetrics(78)
        $vh = [OmpWin32]::GetSystemMetrics(79)

        $x = [int]$p.x
        $y = [int]$p.y
        $nx = [int][Math]::Round(($x - $vx) * 65535.0 / ($vw - 1))
        $ny = [int][Math]::Round(($y - $vy) * 65535.0 / ($vh - 1))

        $inputs = New-Object System.Collections.ArrayList
        $action = $p.action

        $createMove = {
          $inp = New-Object OmpWin32+INPUT
          $inp.type = 0
          $inp.u.mi.dx = $nx
          $inp.u.mi.dy = $ny
          $inp.u.mi.dwFlags = (0x0001 -bor 0x8000 -bor 0x4000)
          return $inp
        }

        $createButton = {
          param($flags, $data)
          $inp = New-Object OmpWin32+INPUT
          $inp.type = 0
          $inp.u.mi.dx = $nx
          $inp.u.mi.dy = $ny
          $inp.u.mi.mouseData = if ($data) { [uint32]$data } else { 0 }
          $inp.u.mi.dwFlags = ($flags -bor 0x8000 -bor 0x4000)
          return $inp
        }

        [void]$inputs.Add((&$createMove))

        if ($action -eq 'move') {
        } elseif ($action -eq 'click' -or $action -eq 'doubleClick') {
          $btn = if ($p.button) { $p.button } else { 'left' }
          $downFlag = 0x0002; $upFlag = 0x0004
          if ($btn -eq 'right') { $downFlag = 0x0008; $upFlag = 0x0010 }
          elseif ($btn -eq 'middle') { $downFlag = 0x0020; $upFlag = 0x0040 }

          $count = if ($action -eq 'doubleClick') { 2 } else { if ($p.count) { [int]$p.count } else { 1 } }
          for ($c = 0; $c -lt $count; $c++) {
            [void]$inputs.Add((&$createButton $downFlag 0))
            [void]$inputs.Add((&$createButton $upFlag 0))
          }
        } elseif ($action -eq 'scroll') {
          $dy = [int]$p.dy
          $dx = [int]$p.dx
          if ($dy -ne 0) {
            [void]$inputs.Add((&$createButton 0x0800 ($dy * 120)))
          }
          if ($dx -ne 0) {
            [void]$inputs.Add((&$createButton 0x01000 ($dx * 120)))
          }
        } elseif ($action -eq 'drag') {
          $points = $p.points
          [void]$inputs.Add((&$createButton 0x0002 0))
          foreach ($pt in $points) {
            $px = [int]$pt[0]; $py = [int]$pt[1]
            $pnx = [int][Math]::Round(($px - $vx) * 65535.0 / ($vw - 1))
            $pny = [int][Math]::Round(($py - $vy) * 65535.0 / ($vh - 1))
            $inp = New-Object OmpWin32+INPUT
            $inp.type = 0
            $inp.u.mi.dx = $pnx
            $inp.u.mi.dy = $pny
            $inp.u.mi.dwFlags = (0x0001 -bor 0x8000 -bor 0x4000)
            [void]$inputs.Add($inp)
          }
          [void]$inputs.Add((&$createButton 0x0004 0))
        }

        $arr = [OmpWin32+INPUT[]]$inputs.ToArray([OmpWin32+INPUT])
        [OmpWin32]::SendInputChecked($arr)
        $res = @{ ok = $true }
      }

      'input.type' {
        $text = [string]$p.text
        $inputs = New-Object System.Collections.ArrayList
        for ($i = 0; $i -lt $text.Length; $i++) {
          $ch = $text[$i]
          $down = New-Object OmpWin32+INPUT
          $down.type = 1
          $down.u.ki.wScan = [ushort][int]$ch
          $down.u.ki.dwFlags = 0x0004
          [void]$inputs.Add($down)

          $up = New-Object OmpWin32+INPUT
          $up.type = 1
          $up.u.ki.wScan = [ushort][int]$ch
          $up.u.ki.dwFlags = (0x0004 -bor 0x0002)
          [void]$inputs.Add($up)
        }
        $arr = [OmpWin32+INPUT[]]$inputs.ToArray([OmpWin32+INPUT])
        [OmpWin32]::SendInputChecked($arr)
        $res = @{ ok = $true }
      }

      'input.keyChord' {
        $keys = $p.keys
        $inputs = New-Object System.Collections.ArrayList

        $vkMap = @{
          'ctrl' = 0x11; 'control' = 0x11; 'alt' = 0x12; 'shift' = 0x10
          'win' = 0x5B; 'cmd' = 0x5B; 'enter' = 0x0D; 'return' = 0x0D
          'tab' = 0x09; 'esc' = 0x1B; 'escape' = 0x1B; 'space' = 0x20
          'backspace' = 0x08; 'delete' = 0x2E; 'up' = 0x26; 'down' = 0x28
          'left' = 0x25; 'right' = 0x27; 'home' = 0x24; 'end' = 0x23
          'pageup' = 0x21; 'pagedown' = 0x22
          'f1'=0x70;'f2'=0x71;'f3'=0x72;'f4'=0x73;'f5'=0x74;'f6'=0x75
          'f7'=0x76;'f8'=0x77;'f9'=0x78;'f10'=0x79;'f11'=0x7A;'f12'=0x7B
        }

        $vkList = @()
        foreach ($k in $keys) {
          $kLower = $k.ToLower()
          if ($vkMap.ContainsKey($kLower)) {
            $vkList += [ushort]$vkMap[$kLower]
          } elseif ($k.Length -eq 1) {
            $sc = [OmpWin32]::VkKeyScanW($k[0])
            $vkList += [ushort]($sc -band 0xFF)
          } else {
            throw "UnknownKeyChord: unrecognized key '$k'"
          }
        }

        foreach ($vk in $vkList) {
          $down = New-Object OmpWin32+INPUT
          $down.type = 1
          $down.u.ki.wVk = $vk
          [void]$inputs.Add($down)
        }

        for ($i = $vkList.Count - 1; $i -ge 0; $i--) {
          $up = New-Object OmpWin32+INPUT
          $up.type = 1
          $up.u.ki.wVk = $vkList[$i]
          $up.u.ki.dwFlags = 0x0002
          [void]$inputs.Add($up)
        }

        $arr = [OmpWin32+INPUT[]]$inputs.ToArray([OmpWin32+INPUT])
        [OmpWin32]::SendInputChecked($arr)
        $res = @{ ok = $true }
      }

      'ax.snapshot' {
        $hWnd = [IntPtr][int64]$p.hwnd
        $isIconic = [OmpWin32]::IsIconic($hWnd)
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        if ($null -eq $root) { throw "WindowNotFound: automation element for hwnd:$($hWnd.ToInt64()) not found" }

        $className = New-Object System.Text.StringBuilder 256
        [void][OmpWin32]::GetClassNameW($hWnd, $className, 256)
        $clsStr = $className.ToString()

        $targetRoot = $root
        if ($clsStr -eq "ApplicationFrameWindow") {
          $cond = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ClassNameProperty), "Windows.UI.Core.CoreWindow"
          $childCore = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
          if ($null -ne $childCore) { $targetRoot = $childCore }
        }

        $script:previousGen = $script:currentGen
        $script:refGeneration++
        $script:currentGen = $script:refGeneration

        $maxD = if ($p.maxDepth) { [int]$p.maxDepth } else { 12 }
        $maxN = if ($p.maxNodes) { [int]$p.maxNodes } else { 800 }
        $useAll = if ($null -ne $p.all) { [bool]$p.all } else { $false }

        $sb = New-Object System.Text.StringBuilder 4096
        $c = $targetRoot.Current
        $role = $c.ControlType.ProgrammaticName.Replace("ControlType.", "").ToLower()
        $rootName = $c.Name.Replace('"', '\"')
        $procId = 0
        [void][OmpWin32]::GetWindowThreadProcessId($hWnd, [ref]$procId)
        $app = [OmpWin32]::GetProcessImageName($procId)

        $script:refIndex++
        $rootTag = "e$($script:refIndex)"
        $script:refs[$rootTag] = @{ element = $targetRoot; generation = $script:currentGen }

        $rootLine = "- {0} `"{1}`" [ref={2}]" -f $role, $rootName, $rootTag
        if (![string]::IsNullOrEmpty($app)) { $rootLine += " app=$app" }
        if ($isIconic) { $rootLine += " (minimized)" }
        $sb.AppendLine($rootLine)

        $count = [ref]1
        $sbRef = [ref]$sb
        Walk-UiaNode $targetRoot 1 $maxD $maxN $useAll $count $sbRef

        if ($count.Value -ge $maxN) {
          $sb.AppendLine("… truncated ($($count.Value) nodes)")
        }

        $res = @{
          tree = $sb.ToString().TrimEnd()
          nodeCount = $count.Value
          truncated = ($count.Value -ge $maxN)
        }
      }

      'ax.query' {
        $hWnd = [IntPtr][int64]$p.hwnd
        $root = [System.Windows.Automation.AutomationElement]::FromHandle($hWnd)
        if ($null -eq $root) { throw "WindowNotFound: automation element for hwnd:$($hWnd.ToInt64()) not found" }

        $roleFilter = $p.role
        $titleFilter = $p.title
        $limit = if ($p.limit) { [int]$p.limit } else { 10 }

        $results = @()
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

        $stack = New-Object System.Collections.Stack
        $stack.Push($root)

        while ($stack.Count -gt 0 -and $results.Count -lt $limit) {
          $curr = $stack.Pop()
          $child = $walker.GetFirstChild($curr)
          while ($null -ne $child -and $results.Count -lt $limit) {
            $c = $child.Current
            $r = $c.ControlType.ProgrammaticName.Replace("ControlType.", "").ToLower()
            $nm = $c.Name

            $match = $true
            if ($roleFilter -and $r -ne $roleFilter.ToLower()) { $match = $false }
            if ($titleFilter -and !$nm.ToLower().Contains($titleFilter.ToLower())) { $match = $false }

            if ($match) {
              $script:refIndex++
              $tag = "e$($script:refIndex)"
              $script:refs[$tag] = @{ element = $child; generation = $script:currentGen }
              $b = $c.BoundingRectangle
              $results += @{
                ref = $tag
                role = $r
                nativeRole = $c.ControlType.ProgrammaticName.Replace("ControlType.", "")
                title = $nm
                enabled = $c.IsEnabled
                focused = $c.HasKeyboardFocus
                bounds = @{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height }
              }
            }
            $stack.Push($child)
            $child = $walker.GetNextSibling($child)
          }
        }
        $res = $results
      }

      'ref.info' {
        $el = Resolve-Ref $p.ref
        $c = $el.Current
        $b = $c.BoundingRectangle
        $patterns = @($el.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })

        $res = @{
          ref = $p.ref
          role = $c.ControlType.ProgrammaticName.Replace("ControlType.", "").ToLower()
          nativeRole = $c.ControlType.ProgrammaticName.Replace("ControlType.", "")
          title = $c.Name
          enabled = $c.IsEnabled
          focused = $c.HasKeyboardFocus
          bounds = @{ x = $b.X; y = $b.Y; width = $b.Width; height = $b.Height }
          actions = $patterns
        }
      }

      'ref.perform' {
        $el = Resolve-Ref $p.ref
        $action = $p.action
        $invoked = $false

        try {
          $pattern = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          if ($null -ne $pattern) {
            $pattern.Invoke()
            $invoked = $true
          }
        } catch {}

        if (!$invoked) {
          try {
            $toggle = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
            if ($null -ne $toggle) {
              $toggle.Toggle()
              $invoked = $true
            }
          } catch {}
        }

        if (!$invoked) {
          try {
            $sel = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
            if ($null -ne $sel) {
              $sel.Select()
              $invoked = $true
            }
          } catch {}
        }

        if (!$invoked) {
          throw "PerformFailed: element '$($p.ref)' does not support Invoke, Toggle, or Select patterns"
        }
        $res = @{ ok = $true }
      }

      'ref.setValue' {
        $el = Resolve-Ref $p.ref
        $val = [string]$p.value
        try {
          $valPattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          $valPattern.SetValue($val)
        } catch {
          throw "SetValueFailed: element '$($p.ref)' does not support ValuePattern: $($_.Exception.Message)"
        }
        $res = @{ ok = $true }
      }

      'ref.focus' {
        $el = Resolve-Ref $p.ref
        $el.SetFocus()
        $res = @{ ok = $true }
      }

      'ref.value' {
        $el = Resolve-Ref $p.ref
        $val = $null
        try {
          $valPattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          $val = $valPattern.Current.Value
        } catch {}
        $res = @{ value = $val }
      }

      'clipboard.read' {
        $res = @{ text = [System.Windows.Forms.Clipboard]::GetText() }
      }

      'clipboard.write' {
        [System.Windows.Forms.Clipboard]::SetText([string]$p.text)
        $res = @{ ok = $true }
      }

      'shutdown' {
        [Console]::Out.WriteLine((@{ id = $reqId; ok = $true; result = @{ shutdown = $true } } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
        exit 0
      }

      default {
        throw "UnknownMethod: '$method' is not supported by win32 worker"
      }
    }

    $outEnv = @{ id = $reqId; ok = $true; result = $res }
  } catch {
    $errMessage = $_.Exception.Message
    $outEnv = @{ id = $reqId; ok = $false; error = $errMessage }
  }

  [Console]::Out.WriteLine(($outEnv | ConvertTo-Json -Compress -Depth 10))
  [Console]::Out.Flush()
}
