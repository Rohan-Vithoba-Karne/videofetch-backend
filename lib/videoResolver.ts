import { spawn } from 'child_process';
import { VideoFormat, VideoMetadata } from '../types/video';
import { getYtDlpBinary } from './runtimeTools';

const METADATA_CACHE_TTL_MS = parseInt(process.env.METADATA_CACHE_TTL_MS || '300000', 10);

const QUALITY_PRESETS = [
  { label: '144p', height: 144 },
  { label: '240p', height: 240 },
  { label: '360p', height: 360 },
  { label: '480p', height: 480 },
  { label: '720p', height: 720 },
  { label: '1080p', height: 1080 },
  { label: '2K', height: 1440 },
  { label: '4K', height: 2160 },
  { label: '8K', height: 4320 },
] as const;

type RawYtDlpFormat = {
  format_id?: string;
  ext?: string;
  acodec?: string;
  vcodec?: string;
  abr?: number;
  tbr?: number;
  height?: number;
  width?: number;
  resolution?: string;
  format_note?: string;
  filesize?: number;
  filesize_approx?: number;
};

type RawYtDlpInfo = {
  title?: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  formats?: RawYtDlpFormat[];
};

const metadataCache = new Map<string, { expiresAt: number; metadata: VideoMetadata }>();

function normalizeVideoUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';

    const removableParams = [
      'si',
      'feature',
      'pp',
      't',
      'start',
      'fbclid',
      'gclid',
      'ab_channel',
    ];

    for (const key of removableParams) {
      url.searchParams.delete(key);
    }

    url.searchParams.sort();
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function getFormatHeight(format: RawYtDlpFormat): number | undefined {
  if (format.height) {
    return format.height;
  }

  const resolutionMatch = format.resolution?.match(/(\d+)/);
  if (resolutionMatch) {
    return parseInt(resolutionMatch[1], 10);
  }

  if (format.width && format.height) {
    return format.height;
  }

  return undefined;
}

function getResolutionLabel(format: RawYtDlpFormat): string {
  const height = getFormatHeight(format);

  if (!height) {
    return 'unknown';
  }

  const closestPreset = QUALITY_PRESETS.reduce((closest, preset) => {
    const currentDistance = Math.abs(preset.height - height);
    const closestDistance = Math.abs(closest.height - height);

    return currentDistance < closestDistance ? preset : closest;
  }, QUALITY_PRESETS[0]);

  return closestPreset.label;
}

function getFilesizeMB(format: RawYtDlpFormat): number | undefined {
  const filesize = format.filesize || format.filesize_approx;

  if (!filesize) {
    return undefined;
  }

  return Math.max(1, Math.round(filesize / (1024 * 1024)));
}

function getAudioSelector(container: string | undefined): string {
  if (container === 'webm') {
    return 'bestaudio[ext=webm]/bestaudio/best';
  }

  return 'bestaudio[ext=m4a]/bestaudio/best';
}

function getBitrateLabel(format: RawYtDlpFormat): string | undefined {
  const bitrate = format.abr || format.tbr;
  return bitrate ? `${Math.round(bitrate)}k` : undefined;
}

function isAudioOnly(format: RawYtDlpFormat): boolean {
  return Boolean(format.acodec && format.acodec !== 'none' && (!format.vcodec || format.vcodec === 'none'));
}

function isVideoFormat(format: RawYtDlpFormat): boolean {
  return Boolean(format.vcodec && format.vcodec !== 'none');
}

function getVideoCandidateScore(format: RawYtDlpFormat): number {
  const hasAudio = Boolean(format.acodec && format.acodec !== 'none');

  if (format.ext === 'mp4' && hasAudio) {
    return 0;
  }

  if (format.ext === 'mp4') {
    return 1;
  }

  if (format.ext === 'webm' && hasAudio) {
    return 2;
  }

  return 3;
}

function getAudioCandidateScore(format: RawYtDlpFormat): number {
  const extScore = format.ext === 'm4a' ? 0 : format.ext === 'webm' ? 1 : 2;
  const bitrateScore = -Math.round(format.abr || format.tbr || 0);
  return extScore * 100000 + bitrateScore;
}

function buildFormats(info: RawYtDlpInfo): VideoFormat[] {
  const formats = info.formats || [];
  const bestVideoByPreset = new Map<
    string,
    { raw: RawYtDlpFormat; resolution: string }
  >();
  let bestAudioFormat: RawYtDlpFormat | null = null;

  for (const format of formats) {
    if (!format.format_id || !format.ext) {
      continue;
    }

    if (isVideoFormat(format) && (format.ext === 'mp4' || format.ext === 'webm')) {
      const resolution = getResolutionLabel(format);
      const existing = bestVideoByPreset.get(resolution);

      if (
        !existing ||
        getVideoCandidateScore(format) < getVideoCandidateScore(existing.raw)
      ) {
        bestVideoByPreset.set(resolution, { raw: format, resolution });
      }
    }

    if (isAudioOnly(format) && ['m4a', 'webm', 'mp3', 'opus'].includes(format.ext)) {
      if (!bestAudioFormat || getAudioCandidateScore(format) < getAudioCandidateScore(bestAudioFormat)) {
        bestAudioFormat = format;
      }
    }
  }

  const videoFormats = QUALITY_PRESETS.map((preset) => bestVideoByPreset.get(preset.label))
    .filter((entry): entry is { raw: RawYtDlpFormat; resolution: string } => Boolean(entry))
    .map(({ raw, resolution }) => {
      const hasAudio = Boolean(raw.acodec && raw.acodec !== 'none');
      const deliveryMode = hasAudio ? 'fast' : 'merge';

      return {
        id: hasAudio ? raw.format_id! : `${raw.format_id}+${getAudioSelector(raw.ext)}`,
        resolution,
        container: raw.ext!,
        sizeMB: getFilesizeMB(raw),
        bitrate: getBitrateLabel(raw),
        note: hasAudio ? 'Fast start' : 'Best quality',
        isAudio: false,
        hasAudio,
        deliveryMode,
        estimatedStart: hasAudio ? 'instant' : 'slower',
      } satisfies VideoFormat;
    });

  const audioFormats: VideoFormat[] = bestAudioFormat
    ? [
        {
          id: bestAudioFormat.format_id!,
          resolution: 'Audio Only',
          container: bestAudioFormat.ext!,
          sizeMB: getFilesizeMB(bestAudioFormat),
          bitrate: getBitrateLabel(bestAudioFormat),
          note: 'Fast start',
          isAudio: true,
          hasAudio: true,
          deliveryMode: 'audio',
          estimatedStart: 'instant',
        },
      ]
    : [];

  const organizedFormats = [...videoFormats, ...audioFormats];

  if (organizedFormats.length > 0) {
    return organizedFormats;
  }

  return [
    {
      id: 'best',
      resolution: 'Best Available',
      container: 'mp4',
      sizeMB: undefined,
      bitrate: undefined,
      note: 'Best quality',
      isAudio: false,
      hasAudio: true,
      deliveryMode: 'fast',
      estimatedStart: 'instant',
    },
  ];
}

export async function resolveVideoMetadata(url: string): Promise<VideoMetadata> {
  const normalizedUrl = normalizeVideoUrl(url);
  const cachedEntry = metadataCache.get(normalizedUrl);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.metadata;
  }

  return new Promise((resolve, reject) => {
    const args = ['--dump-single-json', '--no-playlist', '--no-warnings', url];

    const process = spawn(getYtDlpBinary(), args);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr.trim() || 'Unable to analyze video'}`));
        return;
      }

      try {
        const info = JSON.parse(stdout) as RawYtDlpInfo;
        const metadata: VideoMetadata = {
          title: info.title || 'Untitled',
          thumbnail: info.thumbnail || '',
          duration: info.duration || 0,
          formats: buildFormats(info),
          uploader: info.uploader || undefined,
          uploadDate: info.upload_date || undefined,
        };

        metadataCache.set(normalizedUrl, {
          expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
          metadata,
        });

        resolve(metadata);
      } catch (parseError) {
        reject(new Error(`Failed to parse yt-dlp output: ${parseError}`));
      }
    });

    process.on('error', (err) => {
      reject(new Error(`Failed to run yt-dlp: ${err.message}`));
    });
  });
}
