export type InputBarOptions = {
  mascotDisabled: boolean;
  mascotMp4?: string;
  mascotWebm?: string;
  launcherVideo?: HTMLVideoElement | null;
  launcherToken: string;
  isMuted: boolean;
  onExpand: () => void;
  onClose: () => void;
};

export type InputBarComponent = {
  root: HTMLDivElement;
  composerSlot: HTMLDivElement;
  mascotVideo: HTMLVideoElement | null;
  show: () => void;
  hide: () => void;
  setMuted: (muted: boolean) => void;
  setRunning: (running: boolean) => void;
  setExpanded: (expanded: boolean) => void;
  destroy: () => void;
};

export function createInputBar(opts: InputBarOptions): InputBarComponent {
  const applyVideoMuteState = (video: HTMLVideoElement | null, muted: boolean): void => {
    if (!video) return;
    video.muted = muted;
    video.defaultMuted = muted;
    if (muted) video.setAttribute('muted', '');
    else video.removeAttribute('muted');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
  };

  const bar = document.createElement('div');
  bar.className = 'inputBar';

  // Mascot circle (leftmost)
  const mascotEl = document.createElement('div');
  mascotEl.className = 'inputBarMascot';
  let mascotVideo: HTMLVideoElement | null = null;

  if (!opts.mascotDisabled && opts.launcherVideo) {
    const video = opts.launcherVideo.cloneNode(true) as HTMLVideoElement;
    applyVideoMuteState(video, opts.isMuted);
    mascotEl.appendChild(video);
    mascotVideo = video;
  } else if (!opts.mascotDisabled && (opts.mascotMp4 || opts.mascotWebm)) {
    const video = document.createElement('video');
    video.autoplay = true;
    video.loop = true;
    applyVideoMuteState(video, opts.isMuted);
    if (opts.mascotWebm) {
      const srcWebm = document.createElement('source');
      srcWebm.src = opts.mascotWebm;
      srcWebm.type = 'video/webm';
      video.appendChild(srcWebm);
    }
    if (opts.mascotMp4) {
      const srcMp4 = document.createElement('source');
      srcMp4.src = opts.mascotMp4;
      srcMp4.type = 'video/mp4';
      video.appendChild(srcMp4);
    }
    mascotEl.appendChild(video);
    mascotVideo = video;

    // Fallback if video fails
    const fallback = document.createElement('span');
    fallback.className = 'inputBarMascotFallback';
    fallback.textContent = opts.launcherToken;
    fallback.style.display = 'none';
    mascotEl.appendChild(fallback);
    video.addEventListener('error', () => {
      video.style.display = 'none';
      fallback.style.display = '';
    }, { once: true });
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'inputBarMascotFallback';
    fallback.textContent = opts.launcherToken;
    mascotEl.appendChild(fallback);
  }

  mascotEl.addEventListener('click', () => opts.onClose());

  // Composer slot (composer lives here permanently)
  const composerSlot = document.createElement('div');
  composerSlot.className = 'inputBarComposerSlot';

  // Expand button (toggles panel open/closed)
  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'inputBarExpand';
  expandBtn.setAttribute('aria-label', 'Expand to full panel');
  expandBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 17 7 7 17 7"/><line x1="7" y1="7" x2="17" y2="17"/></svg>';
  expandBtn.addEventListener('click', () => opts.onExpand());

  // Close button (back to seed)
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'inputBarClose';
  closeBtn.setAttribute('aria-label', 'Close input bar');
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => opts.onClose());

  bar.appendChild(mascotEl);
  bar.appendChild(composerSlot);
  bar.appendChild(expandBtn);
  bar.appendChild(closeBtn);

  return {
    root: bar,
    composerSlot,
    mascotVideo,
    show() {
      bar.classList.add('open');
    },
    hide() {
      bar.classList.remove('open');
    },
    setMuted(muted: boolean) {
      applyVideoMuteState(mascotVideo, muted);
    },
    setRunning(running: boolean) {
      bar.classList.toggle('running', running);
    },
    setExpanded(expanded: boolean) {
      expandBtn.innerHTML = expanded
        ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 7 17 17 7 17"/><line x1="17" y1="17" x2="7" y2="7"/></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="7 17 7 7 17 7"/><line x1="7" y1="7" x2="17" y2="17"/></svg>';
      expandBtn.setAttribute('aria-label', expanded ? 'Collapse panel' : 'Expand to full panel');
    },
    destroy() {},
  };
}
