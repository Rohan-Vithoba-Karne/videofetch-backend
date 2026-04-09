import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getYtDlpBinary } from './runtimeTools';

const MAX_DURATION = parseInt(process.env.MAX_DURATION_SECONDS || '3600', 10);
const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '2000', 10);
const DOWNLOAD_TIMEOUT = parseInt(process.env.DOWNLOAD_TIMEOUT_MS || '600000', 10);
const DOWNLOAD_CONCURRENT_FRAGMENTS = parseInt(
  process.env.DOWNLOAD_CONCURRENT_FRAGMENTS || '4',
  10
);

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface TempDownloadSession {
  promise: Promise<DownloadResult>;
  cancel: () => void;
}

export interface DirectDownloadSession {
  process: ChildProcessWithoutNullStreams;
  cancel: () => void;
}

interface DownloadArgsOptions {
  url: string;
  formatId: string;
  output: string;
  needsMerge: boolean;
  container?: string;
}

function buildProgressArgs(): string[] {
  return [
    '--newline',
    '--progress',
    '--progress-delta',
    '1',
    '--progress-template',
    'download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.eta)s',
  ];
}

function buildDownloadArgs({
  url,
  formatId,
  output,
  needsMerge,
  container,
}: DownloadArgsOptions): string[] {
  const args = ['-f', formatId, '-o', output, '--no-playlist', '-N', String(DOWNLOAD_CONCURRENT_FRAGMENTS)];

  args.push(...buildProgressArgs());

  if (needsMerge) {
    args.push('--merge-output-format', container === 'webm' ? 'webm' : 'mp4');
  }

  args.push(url);
  return args;
}

function monitorProcessOutput(
  process: ChildProcessWithoutNullStreams,
  onProgress?: (progress: number) => void
): void {
  let bufferedOutput = '';
  let duration = 0;

  process.stderr.on('data', (data: Buffer) => {
    const output = data.toString();
    bufferedOutput += output;

    const durationMatch = output.match(/Duration:\s+(\d+):(\d+):?(\d+)?/);
    if (durationMatch) {
      const hours = parseInt(durationMatch[1], 10);
      const minutes = parseInt(durationMatch[2], 10);
      const seconds = parseInt(durationMatch[3] || '0', 10);
      duration = hours * 3600 + minutes * 60 + seconds;
    }

    const progressMatch = output.match(/download:(\d+(?:\.\d+)?)%/);
    if (progressMatch && onProgress) {
      onProgress(parseFloat(progressMatch[1]));
    }

    if (output.includes('\n')) {
      const lines = bufferedOutput.split(/\r?\n/);
      bufferedOutput = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('download:')) {
          console.log('[DownloadEngine]', line);
        } else if (line.trim().startsWith('ERROR:')) {
          console.error('[DownloadEngine]', line.trim());
        }
      }
    }

    if (duration > MAX_DURATION) {
      process.kill();
    }
  });
}

export function startDirectDownload(
  url: string,
  formatId: string,
  container?: string,
  onProgress?: (progress: number) => void
): DirectDownloadSession {
  const args = buildDownloadArgs({
    url,
    formatId,
    output: '-',
    needsMerge: false,
    container,
  });

  const process = spawn(getYtDlpBinary(), args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  monitorProcessOutput(process, onProgress);

  const timeout = setTimeout(() => {
    process.kill();
  }, DOWNLOAD_TIMEOUT);

  process.on('close', () => {
    clearTimeout(timeout);
  });

  return {
    process,
    cancel: () => {
      clearTimeout(timeout);
      if (!process.killed) {
        process.kill();
      }
    },
  };
}

export function downloadVideoToTemp(
  url: string,
  formatId: string,
  container?: string,
  onProgress?: (progress: number) => void
): TempDownloadSession {
  const sanitizedExtension = container ? `.${container.replace(/[^a-z0-9]/gi, '')}` : '.mp4';
  const tempFilePath = join(tmpdir(), `videofetch_${Date.now()}${sanitizedExtension}`);
  let canceled = false;

  const process = spawn(
    getYtDlpBinary(),
    buildDownloadArgs({
      url,
      formatId,
      output: tempFilePath,
      needsMerge: true,
      container,
    }),
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    }
  );

  monitorProcessOutput(process, onProgress);

  const promise = new Promise<DownloadResult>((resolve) => {
    const timeout = setTimeout(() => {
      canceled = true;
      process.kill();
      cleanupTempFile(tempFilePath);
      resolve({
        success: false,
        error: 'Download timed out',
      });
    }, DOWNLOAD_TIMEOUT);

    process.on('close', (code: number | null) => {
      clearTimeout(timeout);

      if (canceled) {
        cleanupTempFile(tempFilePath);
        resolve({
          success: false,
          error: 'Download canceled',
        });
        return;
      }

      if (code !== 0) {
        cleanupTempFile(tempFilePath);
        resolve({
          success: false,
          error: `Download failed with code ${code}`,
        });
        return;
      }

      if (!existsSync(tempFilePath)) {
        resolve({
          success: false,
          error: 'Downloaded file was not created',
        });
        return;
      }

      try {
        const stats = statSync(tempFilePath);
        const sizeMB = stats.size / (1024 * 1024);

        if (sizeMB > MAX_SIZE_MB) {
          cleanupTempFile(tempFilePath);
          resolve({
            success: false,
            error: `File size exceeds maximum of ${MAX_SIZE_MB}MB`,
          });
          return;
        }

        if (stats.size === 0) {
          cleanupTempFile(tempFilePath);
          resolve({
            success: false,
            error: 'Downloaded file is empty',
          });
          return;
        }
      } catch (error) {
        cleanupTempFile(tempFilePath);
        resolve({
          success: false,
          error: `Failed to verify downloaded file: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        });
        return;
      }

      resolve({
        success: true,
        filePath: tempFilePath,
      });
    });

    process.on('error', (err: Error) => {
      clearTimeout(timeout);
      cleanupTempFile(tempFilePath);
      resolve({
        success: false,
        error: `Process error: ${err.message}`,
      });
    });
  });

  return {
    promise,
    cancel: () => {
      canceled = true;
      if (!process.killed) {
        process.kill();
      }
      cleanupTempFile(tempFilePath);
    },
  };
}

export function cleanupTempFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    console.error('[DownloadEngine] Failed to cleanup temp file:', error);
  }
}
