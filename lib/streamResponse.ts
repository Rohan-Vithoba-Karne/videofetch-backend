import { Response } from 'express';
import { createReadStream, statSync } from 'fs';

interface StreamFileOptions {
  res: Response;
  filePath: string;
  filename: string;
  contentType: string;
  onClose?: () => void;
}

export function getContentType(container?: string, isAudio?: boolean): string {
  if (container === 'webm') {
    return isAudio ? 'audio/webm' : 'video/webm';
  }

  if (container === 'm4a') {
    return 'audio/mp4';
  }

  if (container === 'mp3') {
    return 'audio/mpeg';
  }

  return isAudio ? 'audio/mpeg' : 'video/mp4';
}

export function streamFileToResponse({
  res,
  filePath,
  filename,
  contentType,
  onClose,
}: StreamFileOptions): void {
  const stats = statSync(filePath);
  const fileStream = createReadStream(filePath);
  let finalized = false;

  const finalize = () => {
    if (finalized) {
      return;
    }

    finalized = true;
    onClose?.();
  };

  res.setHeader('Content-Length', stats.size.toString());
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename.replace(/"/g, '\\"')}"`
  );
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  fileStream.on('error', (error) => {
    console.error('[StreamResponse] Failed to stream file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream file' });
    } else {
      res.destroy(error);
    }
    finalize();
  });

  res.on('finish', finalize);
  res.on('close', () => {
    fileStream.destroy();
    finalize();
  });

  fileStream.pipe(res);
}
