import { Request, Response } from 'express';
import { analyzeRequestSchema } from '../lib/validation';
import { checkRateLimit } from '../lib/rateLimiter';
import { resolveVideoMetadata } from '../lib/videoResolver';

export async function analyzeRoute(req: Request, res: Response) {
  try {
    // Get client IP for rate limiting
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || 
               req.ip || 
               'unknown';

    // Check rate limit
    const rateLimit = checkRateLimit(ip);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
      }).set('X-RateLimit-Remaining', '0')
         .set('X-RateLimit-Reset', rateLimit.resetTime.toString());
    }

    // Parse and validate request body
    const body = req.body;
    const validation = analyzeRequestSchema.safeParse(body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: validation.error.errors[0].message,
      });
    }

    const { url } = validation.data;

    // Get video metadata
    const metadata = await resolveVideoMetadata(url);

    return res.json({
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      duration: metadata.duration,
      formats: metadata.formats,
    });
  } catch (error) {
    console.error('Analyze error:', error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message.replace('yt-dlp failed:', 'Unable to analyze this link:')
          : 'Failed to analyze video',
    });
  }
}
