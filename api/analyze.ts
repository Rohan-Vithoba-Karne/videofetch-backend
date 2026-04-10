import { Request, Response } from 'express';
import { analyzeRequestSchema } from '../lib/validation';
import { checkRateLimit } from '../lib/rateLimiter';

type YouTubeApiResponse = {
  items?: Array<{
    snippet: {
      title: string;
      thumbnails: {
        maxres?: { url: string };
        high?: { url: string };
        medium?: { url: string };
      };
    };
    contentDetails: {
      duration: string;
    };
  }>;
};

function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v');
    }
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
    return null;
  } catch {
    return null;
  }
}

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || '0');
  const m = parseInt(match[2] || '0');
  const s = parseInt(match[3] || '0');
  return h * 3600 + m * 60 + s;
}

export async function analyzeRoute(req: Request, res: Response) {
  try {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.ip || 'unknown';

    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
      });
    }

    const validation = analyzeRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: validation.error.errors[0].message,
      });
    }

    const { url } = validation.data;
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'YouTube API key not configured' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&key=${apiKey}&part=snippet,contentDetails`;
    const response = await fetch(apiUrl);
    const data = await response.json() as YouTubeApiResponse;

    if (!data.items || data.items.length === 0) {
      return res.status(404).json({ error: 'Video not found or is private' });
    }

    const item = data.items[0];
    const snippet = item.snippet;
    const contentDetails = item.contentDetails;
    const duration = parseDuration(contentDetails.duration);

    const formats = [
      {
        id: 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]',
        resolution: '1080p',
        container: 'mp4',
        note: 'Best quality',
        isAudio: false,
        hasAudio: true,
        deliveryMode: 'merge',
        estimatedStart: 'instant',
      },
      {
        id: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]',
        resolution: '720p',
        container: 'mp4',
        note: 'HD',
        isAudio: false,
        hasAudio: true,
        deliveryMode: 'merge',
        estimatedStart: 'instant',
      },
      {
        id: 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]',
        resolution: '480p',
        container: 'mp4',
        note: 'Standard',
        isAudio: false,
        hasAudio: true,
        deliveryMode: 'merge',
        estimatedStart: 'instant',
      },
      {
        id: 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best[height<=360]',
        resolution: '360p',
        container: 'mp4',
        note: 'Low',
        isAudio: false,
        hasAudio: true,
        deliveryMode: 'merge',
        estimatedStart: 'instant',
      },
      {
        id: 'bestaudio[ext=m4a]/bestaudio',
        resolution: 'Audio Only',
        container: 'm4a',
        note: 'Audio only',
        isAudio: true,
        hasAudio: true,
        deliveryMode: 'audio',
        estimatedStart: 'instant',
      },
    ];

    return res.json({
      title: snippet.title,
      thumbnail: snippet.thumbnails?.maxres?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.medium?.url || '',
      duration,
      formats,
    });

  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to analyze video',
    });
  }
}