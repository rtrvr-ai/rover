export const DEFAULT_MASCOT_MP4 = 'https://www.rtrvr.ai/rover/mascot.mp4';
export const DEFAULT_MASCOT_WEBM = 'https://www.rtrvr.ai/rover/mascot.webm';

export type MascotMediaOptions = {
  container: HTMLElement;
  token: string;
  disabled?: boolean;
  imageUrl?: string;
  mp4Url?: string;
  webmUrl?: string;
  muted?: boolean;
  fallbackClassName: string;
};

export type MascotMediaResult = {
  video: HTMLVideoElement | null;
  image: HTMLImageElement | null;
  setMuted: (muted: boolean) => void;
};

function trim(value: string | undefined): string {
  return String(value || '').trim();
}

function applyVideoMuteState(video: HTMLVideoElement | null, muted: boolean): void {
  if (!video) return;
  video.muted = muted;
  video.defaultMuted = muted;
  if (muted) video.setAttribute('muted', '');
  else video.removeAttribute('muted');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
}

export function mountMascotMedia(opts: MascotMediaOptions): MascotMediaResult {
  const imageUrl = trim(opts.imageUrl);
  const customMp4Url = trim(opts.mp4Url);
  const customWebmUrl = trim(opts.webmUrl);
  const hasCustomVideo = !!customMp4Url || !!customWebmUrl;
  const useDefaultVideo = !opts.disabled && !hasCustomVideo && !imageUrl;

  opts.container.replaceChildren();

  const fallback = document.createElement('span');
  fallback.className = opts.fallbackClassName;
  fallback.textContent = opts.token;

  let image: HTMLImageElement | null = null;
  const maybeAppendImage = (visible: boolean): HTMLImageElement | null => {
    if (!imageUrl) return null;
    image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '';
    image.decoding = 'async';
    image.loading = 'eager';
    image.draggable = false;
    if (!visible) image.style.display = 'none';
    image.addEventListener('error', () => {
      image!.style.display = 'none';
      fallback.style.display = 'grid';
    }, { once: true });
    opts.container.appendChild(image);
    return image;
  };

  let video: HTMLVideoElement | null = null;
  if (!opts.disabled && (hasCustomVideo || useDefaultVideo)) {
    video = document.createElement('video');
    video.autoplay = true;
    video.loop = true;
    video.preload = 'metadata';
    applyVideoMuteState(video, opts.muted ?? true);

    if (imageUrl) {
      video.poster = imageUrl;
    }

    const webmUrl = customWebmUrl || (!hasCustomVideo ? DEFAULT_MASCOT_WEBM : '');
    const mp4Url = customMp4Url || (!hasCustomVideo ? DEFAULT_MASCOT_MP4 : '');
    if (webmUrl) {
      const webm = document.createElement('source');
      webm.src = webmUrl;
      webm.type = 'video/webm';
      video.appendChild(webm);
    }
    if (mp4Url) {
      const mp4 = document.createElement('source');
      mp4.src = mp4Url;
      mp4.type = 'video/mp4';
      video.appendChild(mp4);
    }
    opts.container.appendChild(video);
    maybeAppendImage(false);
    opts.container.appendChild(fallback);
    fallback.style.display = 'none';

    video.addEventListener('error', () => {
      video!.style.display = 'none';
      if (image) image.style.display = '';
      else fallback.style.display = 'grid';
    }, { once: true });
  } else if (!opts.disabled && imageUrl) {
    maybeAppendImage(true);
    opts.container.appendChild(fallback);
    fallback.style.display = 'none';
  } else {
    opts.container.appendChild(fallback);
  }

  return {
    video,
    image,
    setMuted(muted: boolean) {
      applyVideoMuteState(video, muted);
    },
  };
}
