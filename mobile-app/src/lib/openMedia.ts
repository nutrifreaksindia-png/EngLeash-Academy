/** Shared in-app media opening (PDF / image / video / audio). */

export type MediaKind = 'pdf' | 'image' | 'video' | 'audio' | 'file';

export type OpenMediaParams = {
  url: string;
  title?: string;
  kind?: MediaKind;
  mimeType?: string | null;
  allowDownload?: boolean;
};

function extOf(url: string): string {
  try {
    const path = String(url || '').split('?')[0].split('#')[0];
    const m = /\.([a-z0-9]+)$/i.exec(path);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

export function detectMediaKind(opts: {
  url?: string | null;
  mimeType?: string | null;
  typeHint?: string | null;
}): MediaKind {
  const hint = String(opts.typeHint || '').toLowerCase();
  if (hint === 'pdf' || hint === 'document') return 'pdf';
  if (hint === 'image' || hint === 'gif') return 'image';
  if (hint === 'video') return 'video';
  if (hint === 'audio' || hint === 'voice') return 'audio';

  const mime = String(opts.mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';

  const ext = extOf(String(opts.url || ''));
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga'].includes(ext)) return 'audio';

  // Invoice API paths end with /invoice — treat as PDF.
  if (/\/invoice(\?|$)/i.test(String(opts.url || ''))) return 'pdf';

  return 'file';
}

function tryNavigate(navigation: any, name: string, params: Record<string, unknown>) {
  if (!navigation?.navigate) return false;
  try {
    navigation.navigate(name, params);
    return true;
  } catch {
    return false;
  }
}

/** Navigate to the right in-app viewer. Videos use the recordings player (landscape + controls). */
export function openMedia(navigation: any, params: OpenMediaParams) {
  const url = String(params.url || '').trim();
  if (!url) return;
  const kind = params.kind || detectMediaKind({ url, mimeType: params.mimeType });

  if (kind === 'video') {
    const videoParams = {
      videoUrl: url,
      title: params.title || 'Video',
      allowDownload: params.allowDownload === true,
    };
    if (tryNavigate(navigation, 'VideoPlayer', videoParams)) return;
    if (tryNavigate(navigation, 'SessionRecordingPlayer', videoParams)) return;
  }

  if (
    tryNavigate(navigation, 'MediaViewer', {
      url,
      title: params.title || mediaTitleForKind(kind),
      kind,
      mimeType: params.mimeType || null,
    })
  ) {
    return;
  }

  // Last resort — prefer not to use this path.
  const { Linking } = require('react-native');
  void Linking.openURL(url).catch(() => {});
}

export function mediaTitleForKind(kind: MediaKind): string {
  if (kind === 'pdf') return 'Document';
  if (kind === 'image') return 'Image';
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Audio';
  return 'File';
}

/** True when a generic href should open in MediaViewer instead of the system browser. */
export function isViewableMediaUrl(url?: string | null): boolean {
  const kind = detectMediaKind({ url });
  return kind === 'pdf' || kind === 'image' || kind === 'video' || kind === 'audio';
}
