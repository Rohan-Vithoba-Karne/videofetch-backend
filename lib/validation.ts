import { z } from 'zod';

export const analyzeRequestSchema = z.object({
  url: z.string().url('Invalid URL format').refine(
    (url) => {
      try {
        const urlObj = new URL(url);
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must be HTTP or HTTPS' }
  ),
});

export const downloadRequestSchema = z.object({
  url: z.string().url('Invalid URL format'),
  formatId: z.string().min(1, 'Format ID is required'),
  title: z.string().trim().min(1).max(200).optional(),
  deliveryMode: z.enum(['fast', 'merge', 'audio']).optional(),
  container: z.string().trim().min(1).max(20).optional(),
  isAudio: z.boolean().optional(),
});

export const downloadQuerySchema = z.object({
  url: z.string().url('Invalid URL format'),
  formatId: z.string().min(1, 'Format ID is required'),
  title: z.string().trim().min(1).max(200).optional(),
  deliveryMode: z.enum(['fast', 'merge', 'audio']).optional(),
  container: z.string().trim().min(1).max(20).optional(),
  isAudio: z
    .union([z.literal('true'), z.literal('false')])
    .transform((value) => value === 'true')
    .optional(),
});

export type AnalyzeInput = z.infer<typeof analyzeRequestSchema>;
export type DownloadInput = z.infer<typeof downloadRequestSchema>;

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

export function validateUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}
