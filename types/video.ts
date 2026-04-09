export interface VideoFormat {
  id: string;
  resolution: string;
  container: string;
  sizeMB?: number;
  bitrate?: string;
  note?: string;
  isAudio?: boolean;
  hasAudio: boolean;
  deliveryMode: 'fast' | 'merge' | 'audio';
  estimatedStart: 'instant' | 'slower';
}

export interface VideoMetadata {
  title: string;
  thumbnail: string;
  duration: number;
  formats: VideoFormat[];
  uploader?: string;
  uploadDate?: string;
}

export interface AnalyzeRequest {
  url: string;
}

export interface AnalyzeResponse {
  title: string;
  thumbnail: string;
  duration: number;
  formats: VideoFormat[];
}

export interface DownloadRequest {
  url: string;
  formatId: string;
  title?: string;
  deliveryMode?: 'fast' | 'merge' | 'audio';
  container?: string;
  isAudio?: boolean;
}

export interface DownloadResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface RateLimitInfo {
  allowed: boolean;
  remainingRequests: number;
  resetTime: number;
}
