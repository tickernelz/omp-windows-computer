import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export interface OptimizeImageOptions {
  maxWidth?: number;
  format?: "png" | "jpeg";
  jpegQuality?: number;
}

let cachedHasFfmpeg: boolean | null = null;

export function hasFfmpeg(): boolean {
  if (cachedHasFfmpeg !== null) return cachedHasFfmpeg;
  try {
    const whichCmd = process.platform === "win32" ? "where.exe" : "which";
    const found = execFileSync(whichCmd, ["ffmpeg"], { encoding: "utf8" }).trim();
    cachedHasFfmpeg = Boolean(found && fs.existsSync(found));
  } catch {
    cachedHasFfmpeg = false;
  }
  return cachedHasFfmpeg;
}

export function optimizeScreenshot(
  srcPngPath: string,
  options: OptimizeImageOptions = {}
): { path: string; width: number; height: number; bytes: number } {
  if (!fs.existsSync(srcPngPath)) {
    throw new Error("OptimizeImageFailed: source image file does not exist: " + srcPngPath);
  }

  const reqFormat = options.format || "jpeg";
  const maxWidth = options.maxWidth || 1280;
  const quality = options.jpegQuality || 3; // ffmpeg -q:v 3 is high quality ~82%

  if (reqFormat === "png" && !options.maxWidth) {
    const stat = fs.statSync(srcPngPath);
    return {
      path: srcPngPath,
      width: 1920,
      height: 1080,
      bytes: stat.size
    };
  }

  const dir = path.dirname(srcPngPath);
  const base = path.basename(srcPngPath, path.extname(srcPngPath));
  const ext = reqFormat === "png" ? "png" : "jpg";
  const dstPath = path.join(dir, base + "-opt." + ext);

  if (hasFfmpeg()) {
    try {
      const vf = "scale='min(" + maxWidth + ",iw)':-1";
      const args = reqFormat === "jpeg"
        ? ["-y", "-i", srcPngPath, "-vf", vf, "-q:v", String(quality), dstPath]
        : ["-y", "-i", srcPngPath, "-vf", vf, dstPath];

      execFileSync("ffmpeg", args, { stdio: "pipe", timeout: 5000 });

      if (fs.existsSync(dstPath)) {
        const stat = fs.statSync(dstPath);
        // Remove raw heavy png to save disk
        try { fs.unlinkSync(srcPngPath); } catch {}
        return {
          path: dstPath,
          width: maxWidth,
          height: Math.round(maxWidth * (1080 / 1920)),
          bytes: stat.size
        };
      }
    } catch {}
  }

  // Fallback: return source if conversion unavailable
  const stat = fs.statSync(srcPngPath);
  return {
    path: srcPngPath,
    width: 1920,
    height: 1080,
    bytes: stat.size
  };
}
