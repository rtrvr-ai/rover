import { mountMascotMedia } from '../mascot-media.js';

export type InputBarOptions = {
  mascotDisabled: boolean;
  mascotImage?: string;
  mascotMp4?: string;
  mascotWebm?: string;
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
  const bar = document.createElement('div');
  bar.className = 'inputBar';

  // Mascot circle (leftmost)
  const mascotEl = document.createElement('div');
  mascotEl.className = 'inputBarMascot';
  const mascotMedia = mountMascotMedia({
    container: mascotEl,
    token: opts.launcherToken,
    disabled: opts.mascotDisabled,
    imageUrl: opts.mascotImage,
    mp4Url: opts.mascotMp4,
    webmUrl: opts.mascotWebm,
    muted: opts.isMuted,
    fallbackClassName: 'inputBarMascotFallback',
  });
  const mascotVideo = mascotMedia.video;

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
      mascotMedia.setMuted(muted);
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
