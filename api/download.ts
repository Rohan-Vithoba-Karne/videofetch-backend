import { Request, Response } from 'express';
import {
  cleanupTempFile,
  downloadVideoToTemp,
  startDirectDownload,
} from '../lib/downloadEngine';
import { checkRateLimit } from '../lib/rateLimiter';
import { getContentType, streamFileToResponse } from '../lib/streamResponse';
import {
  downloadQuerySchema,
  downloadRequestSchema,
  sanitizeFilename,
} from '../lib/validation';

function getClientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0] || req.ip || 'unknown';
}

function normalizeDownloadInput(req: Request) {
  if (req.method === 'GET') {
    return {
      url: Array.isArray(req.query.url) ? req.query.url[0] : req.query.url,
      formatId: Array.isArray(req.query.formatId) ? req.query.formatId[0] : req.query.formatId,
      title: Array.isArray(req.query.title) ? req.query.title[0] : req.query.title,
      deliveryMode: Array.isArray(req.query.deliveryMode)
        ? req.query.deliveryMode[0]
        : req.query.deliveryMode,
      container: Array.isArray(req.query.container) ? req.query.container[0] : req.query.container,
      isAudio: Array.isArray(req.query.isAudio) ? req.query.isAudio[0] : req.query.isAudio,
    };
  }

  return req.body;
}

function buildDownloadFilename(title: string | undefined, container: string | undefined): string {
  const safeTitle = sanitizeFilename(title?.trim() || 'videofetch-download');
  const safeExtension = (container || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
  return `${safeTitle}.${safeExtension}`;
}

function humanizeDownloadError(message: string): string {
  if (message.includes('timed out')) {
    return 'The download took too long. Try a lower quality or try again.';
  }

  if (message.includes('File size exceeds')) {
    return 'This file is larger than the current download limit.';
  }

  if (message.includes('Download canceled')) {
    return 'The download was canceled before it finished.';
  }

  if (message.includes('yt-dlp failed')) {
    return 'The video source blocked this request or is temporarily unavailable.';
  }

  return message;
}

export async function downloadRoute(req: Request, res: Response) {
  let tempFilePath: string | null = null;
  let cancelActiveDownload: (() => void) | null = null;

  try {
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return res
        .status(429)
        .set('X-RateLimit-Remaining', '0')
        .set('X-RateLimit-Reset', rateLimit.resetTime.toString())
        .json({
          error: 'Too many requests. Please try again later.',
        });
    }

    const input = normalizeDownloadInput(req);
    const validation =
      req.method === 'GET'
        ? downloadQuerySchema.safeParse(input)
        : downloadRequestSchema.safeParse(input);

    if (!validation.success) {
      return res.status(400).json({
        error: validation.error.errors[0].message,
      });
    }

    const {
      url,
      formatId,
      title,
      deliveryMode = formatId.includes('+') ? 'merge' : 'fast',
      container = 'mp4',
      isAudio = deliveryMode === 'audio',
    } = validation.data;

    const filename = buildDownloadFilename(title, container);
    const contentType = getContentType(container, isAudio);

    const closeHandler = () => {
      cancelActiveDownload?.();
      if (tempFilePath) {
        cleanupTempFile(tempFilePath);
        tempFilePath = null;
      }
    };

    req.on('close', closeHandler);

    if (deliveryMode === 'fast' || deliveryMode === 'audio') {
      const directDownload = startDirectDownload(url, formatId, container);
      cancelActiveDownload = directDownload.cancel;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      directDownload.process.stdout.pipe(res);
      directDownload.process.stdout.on('error', (error) => {
        console.error('[Download] Failed while streaming direct download:', error);
        res.destroy(error);
      });

      directDownload.process.on('error', (error) => {
        console.error('[Download] yt-dlp process error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: humanizeDownloadError(error.message) });
        } else {
          res.destroy(error);
        }
      });

      directDownload.process.on('close', (code) => {
        req.off('close', closeHandler);
        cancelActiveDownload = null;

        if (code !== 0 && !res.writableEnded) {
          res.destroy(new Error(`Direct download failed with code ${code}`));
          return;
        }

        if (!res.writableEnded) {
          res.end();
        }
      });

      return res;
    }

    const downloadSession = downloadVideoToTemp(url, formatId, container);
    cancelActiveDownload = downloadSession.cancel;
    const result = await downloadSession.promise;
    cancelActiveDownload = null;

    if (!result.success || !result.filePath) {
      req.off('close', closeHandler);
      return res.status(500).json({
        error: humanizeDownloadError(result.error || 'Download failed'),
      });
    }

    tempFilePath = result.filePath;
    streamFileToResponse({
      res,
      filePath: tempFilePath,
      filename,
      contentType,
      onClose: () => {
        req.off('close', closeHandler);
        if (tempFilePath) {
          cleanupTempFile(tempFilePath);
          tempFilePath = null;
        }
      },
    });

    return res;
  } catch (error) {
    console.error('[Download] Error:', error);
    cancelActiveDownload?.();

    if (tempFilePath) {
      cleanupTempFile(tempFilePath);
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: humanizeDownloadError(
          error instanceof Error ? error.message : 'Download failed'
        ),
      });
    }

    res.destroy();
    return res;
  }
}
