import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface ToolCheck {
  ready: boolean;
  binary: string;
  version?: string;
  error?: string;
}

export interface RuntimeToolsStatus {
  ytDlp: ToolCheck;
  ffmpeg: ToolCheck;
  checkedAt: string;
}

const localYtDlpBinary = join(process.cwd(), 'yt-dlp.exe');
const ytDlpBinary =
  process.env.YT_DLP_PATH ||
  (existsSync(localYtDlpBinary) ? localYtDlpBinary : 'yt-dlp');
const ffmpegBinary = process.env.FFMPEG_PATH || 'ffmpeg';

let cachedStatus: RuntimeToolsStatus | null = null;

function checkBinary(binary: string, args: string[]): ToolCheck {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 10000,
  });

  if (result.error) {
    return {
      ready: false,
      binary,
      error: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      ready: false,
      binary,
      error: (result.stderr || result.stdout || `Exited with code ${result.status}`).trim(),
    };
  }

  const versionLine = (result.stdout || result.stderr || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return {
    ready: true,
    binary,
    version: versionLine,
  };
}

export function initializeRuntimeTools(): RuntimeToolsStatus {
  cachedStatus = {
    ytDlp: checkBinary(ytDlpBinary, ['--version']),
    ffmpeg: checkBinary(ffmpegBinary, ['-version']),
    checkedAt: new Date().toISOString(),
  };

  return cachedStatus;
}

export function getRuntimeToolsStatus(): RuntimeToolsStatus {
  return cachedStatus ?? initializeRuntimeTools();
}

export function getYtDlpBinary(): string {
  return ytDlpBinary;
}

export function getFfmpegBinary(): string {
  return ffmpegBinary;
}
