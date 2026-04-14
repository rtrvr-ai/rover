import type { RoverExperienceConfig, RoverPresencePosition, RoverMood } from '../types.js';
import { ROVER_WIDGET_MOBILE_BREAKPOINT_PX } from '../config.js';
import { clampNumber } from '../layout.js';
import { readPresencePosition, writePresencePosition, buildPresenceStorageKey } from '../storage.js';

export type SeedOptions = {
  agentName: string;
  launcherToken: string;
  mascotDisabled: boolean;
  mascotMp4?: string;
  mascotWebm?: string;
  experience: RoverExperienceConfig;
  siteId?: string;
  onClick: () => void;
};

export type SeedComponent = {
  root: HTMLButtonElement;
  greetingBubble: HTMLDivElement;
  video: HTMLVideoElement | null;
  update: (experience: RoverExperienceConfig) => void;
  setMood: (mood: RoverMood) => void;
  setMuted: (muted: boolean) => void;
  setGreeting: (text: string | null) => void;
  applyPosition: () => void;
  persistPosition: () => void;
  getPosition: () => RoverPresencePosition;
  destroy: () => void;
};

const DEFAULT_MASCOT_MP4 = 'https://www.rtrvr.ai/rover/mascot.mp4';
const DEFAULT_MASCOT_WEBM = 'https://www.rtrvr.ai/rover/mascot.webm';

export function createSeed(opts: SeedOptions): SeedComponent {
  const { agentName, launcherToken, mascotDisabled } = opts;
  let experience = opts.experience;
  const resolvedAgentName = String(agentName || 'Rover').trim() || 'Rover';
  const launcherAriaDescription = 'Preferred Rover surface for live actions on this page.';

  const launcher = document.createElement('button');
  launcher.className = 'launcher';
  launcher.setAttribute('aria-label', `Open ${resolvedAgentName} assistant`);
  launcher.setAttribute('aria-description', launcherAriaDescription);
  launcher.setAttribute('data-draggable', experience.presence?.draggable === false ? 'false' : 'true');

  const launcherBody = document.createElement('span');
  launcherBody.className = 'launcherBody';

  const launcherMedia = document.createElement('span');
  launcherMedia.className = 'launcherMedia';

  let launcherVideo: HTMLVideoElement | null = null;
  if (!mascotDisabled) {
    launcherVideo = document.createElement('video');
    launcherVideo.autoplay = true;
    launcherVideo.muted = true;
    launcherVideo.loop = true;
    launcherVideo.playsInline = true;
    launcherVideo.preload = 'metadata';
    const mp4 = document.createElement('source');
    mp4.src = opts.mascotMp4 || DEFAULT_MASCOT_MP4;
    mp4.type = 'video/mp4';
    const webm = document.createElement('source');
    webm.src = opts.mascotWebm || DEFAULT_MASCOT_WEBM;
    webm.type = 'video/webm';
    launcherVideo.appendChild(mp4);
    launcherVideo.appendChild(webm);
    launcherMedia.appendChild(launcherVideo);
  }

  const launcherFallback = document.createElement('span');
  launcherFallback.className = 'launcherFallback';
  launcherFallback.textContent = launcherToken;
  launcherMedia.appendChild(launcherFallback);

  const launcherCopy = document.createElement('span');
  launcherCopy.className = 'launcherCopy';

  const launcherLabel = document.createElement('span');
  launcherLabel.className = 'launcherLabel';
  launcherLabel.textContent = experience.presence?.ctaText || `Do it with ${agentName}`;

  const launcherShine = document.createElement('div');
  launcherShine.className = 'launcherShine';

  // Glow layer for mood-reactive ambient effect
  const seedGlow = document.createElement('div');
  seedGlow.className = 'seed-glow';

  // Greeting bubble (positioned above seed)
  const greetingBubble = document.createElement('div');
  greetingBubble.className = 'greetingBubble';
  const greetingText = document.createElement('span');
  greetingText.className = 'greetingText';
  const greetingClose = document.createElement('button');
  greetingClose.type = 'button';
  greetingClose.className = 'greetingClose';
  greetingClose.setAttribute('aria-label', 'Dismiss greeting');
  greetingClose.textContent = '\u00D7';
  greetingBubble.appendChild(greetingText);
  greetingBubble.appendChild(greetingClose);

  launcherCopy.appendChild(launcherLabel);
  launcherBody.appendChild(launcherMedia);
  launcherBody.appendChild(launcherCopy);
  launcher.appendChild(launcherBody);
  launcher.appendChild(launcherShine);
  launcher.appendChild(seedGlow);

  // Video fallback
  if (launcherVideo) {
    const showFallback = () => {
      launcherVideo!.style.display = 'none';
      launcherFallback.style.display = 'grid';
    };
    launcherVideo.addEventListener('error', showFallback, { once: true });
    launcherFallback.style.display = 'none';
  }

  // Idle animation
  launcher.classList.toggle('breathe', experience.presence?.idleAnimation !== 'none');
  launcher.classList.toggle('orbit', experience.presence?.idleAnimation === 'orbit');

  // Drag state
  let presencePosition: RoverPresencePosition | null = null;
  let suppressClick = false;
  let dragState: {
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    moved: boolean;
  } | null = null;

  function getViewportWidth(): number {
    return Math.max(320, Math.round(window.visualViewport?.width ?? window.innerWidth ?? 320));
  }

  function getViewportHeight(): number {
    return Math.max(320, Math.round(window.visualViewport?.height ?? window.innerHeight ?? 320));
  }

  function getPresenceBreakpoint(): 'desktop' | 'mobile' {
    return getViewportWidth() <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 'mobile' : 'desktop';
  }

  function getPresenceStorageKey(): string {
    return buildPresenceStorageKey(opts.siteId, getPresenceBreakpoint());
  }

  function getDefaultPosition(): RoverPresencePosition {
    const w = getViewportWidth();
    const h = getViewportHeight();
    const safeInset = experience.shell?.safeAreaInsetPx ?? 16;
    const rect = launcher.getBoundingClientRect();
    const elW = rect.width || (w <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 198 : 248);
    const elH = rect.height || (w <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 64 : 72);
    const anchor = experience.presence?.defaultAnchor || 'bottom-center';
    const xRight = Math.max(safeInset, w - elW - safeInset);
    const yBottom = Math.max(safeInset, h - elH - safeInset);
    if (anchor === 'bottom-left') return { x: safeInset, y: yBottom };
    if (anchor === 'top-left') return { x: safeInset, y: safeInset };
    if (anchor === 'top-right') return { x: xRight, y: safeInset };
    if (anchor === 'bottom-right') return { x: xRight, y: yBottom };
    // bottom-center (default)
    return { x: Math.max(safeInset, Math.round((w - elW) / 2)), y: yBottom };
  }

  function clampPosition(pos: RoverPresencePosition): RoverPresencePosition {
    const w = getViewportWidth();
    const h = getViewportHeight();
    const safeInset = experience.shell?.safeAreaInsetPx ?? 16;
    const rect = launcher.getBoundingClientRect();
    const elW = rect.width || (w <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 198 : 248);
    const elH = rect.height || (w <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 64 : 72);
    return {
      x: clampNumber(Math.round(pos.x), safeInset, Math.max(safeInset, w - elW - safeInset)),
      y: clampNumber(Math.round(pos.y), safeInset, Math.max(safeInset, h - elH - safeInset)),
    };
  }

  function applyPosition(): void {
    const storageKey = getPresenceStorageKey();
    const stored = experience.presence?.persistPosition ? readPresencePosition(storageKey) : null;
    presencePosition = stored || getDefaultPosition();
    presencePosition = clampPosition(presencePosition);
    launcher.style.left = `${presencePosition.x}px`;
    launcher.style.top = `${presencePosition.y}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
  }

  function persistPosition(): void {
    if (experience.presence?.persistPosition === false) return;
    writePresencePosition(getPresenceStorageKey(), presencePosition);
  }

  // Click handler
  launcher.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    opts.onClick();
  });

  // Drag handlers
  launcher.addEventListener('pointerdown', (ev) => {
    if (experience.presence?.draggable === false) return;
    if (ev.button !== 0) return;
    const rect = launcher.getBoundingClientRect();
    dragState = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      offsetX: ev.clientX - rect.left,
      offsetY: ev.clientY - rect.top,
      moved: false,
    };
    launcher.setPointerCapture(ev.pointerId);
  });

  // Snap point constants
  const SNAP_THRESHOLD = 40;
  const SNAP_FORCE = 0.3;

  function getSnapCorners(): { x: number; y: number }[] {
    const w = getViewportWidth();
    const h = getViewportHeight();
    const safeInset = experience.shell?.safeAreaInsetPx ?? 16;
    const rect = launcher.getBoundingClientRect();
    const elW = rect.width || (w <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 198 : 248);
    const elH = rect.height || (w <= ROVER_WIDGET_MOBILE_BREAKPOINT_PX ? 64 : 72);
    return [
      { x: safeInset, y: safeInset },                                              // top-left
      { x: Math.max(safeInset, w - elW - safeInset), y: safeInset },               // top-right
      { x: safeInset, y: Math.max(safeInset, h - elH - safeInset) },               // bottom-left
      { x: Math.max(safeInset, w - elW - safeInset), y: Math.max(safeInset, h - elH - safeInset) }, // bottom-right
    ];
  }

  function findNearestSnap(pos: { x: number; y: number }): { corner: { x: number; y: number }; dist: number } | null {
    const corners = getSnapCorners();
    let nearest: { corner: { x: number; y: number }; dist: number } | null = null;
    for (const corner of corners) {
      const dist = Math.hypot(pos.x - corner.x, pos.y - corner.y);
      if (!nearest || dist < nearest.dist) nearest = { corner, dist };
    }
    return nearest;
  }

  launcher.addEventListener('pointermove', (ev) => {
    if (!dragState || dragState.pointerId !== ev.pointerId) return;
    let nextX = ev.clientX - dragState.offsetX;
    let nextY = ev.clientY - dragState.offsetY;
    if (!dragState.moved) {
      const distance = Math.hypot(ev.clientX - dragState.startX, ev.clientY - dragState.startY);
      dragState.moved = distance >= 6;
      if (!dragState.moved) return;
      launcher.classList.add('dragging');
    }

    // Snap zone detection: interpolate toward corner if within threshold
    const snap = findNearestSnap({ x: nextX, y: nextY });
    if (snap && snap.dist < SNAP_THRESHOLD) {
      nextX += (snap.corner.x - nextX) * SNAP_FORCE;
      nextY += (snap.corner.y - nextY) * SNAP_FORCE;
      launcher.classList.add('snap-resist');
    } else {
      launcher.classList.remove('snap-resist');
    }

    presencePosition = clampPosition({ x: nextX, y: nextY });
    launcher.style.left = `${presencePosition.x}px`;
    launcher.style.top = `${presencePosition.y}px`;
    // Reposition greeting bubble during drag
    if (greetingBubble.classList.contains('visible')) {
      positionGreetingBubble();
    }
  });

  launcher.addEventListener('pointerup', (ev) => {
    if (!dragState || dragState.pointerId !== ev.pointerId) return;
    launcher.classList.remove('snap-resist');
    if (dragState.moved) {
      suppressClick = true;
      // Snap-to on release
      const snap = findNearestSnap(presencePosition || { x: 0, y: 0 });
      if (snap && snap.dist < SNAP_THRESHOLD) {
        const target = snap.corner;
        presencePosition = { x: target.x, y: target.y };
        launcher.style.left = `${target.x}px`;
        launcher.style.top = `${target.y}px`;
        try {
          const anim = launcher.animate(
            [
              { left: `${presencePosition!.x}px`, top: `${presencePosition!.y}px` },
              { left: `${target.x}px`, top: `${target.y}px` },
            ],
            { duration: 250, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' },
          );
          anim.onfinish = () => persistPosition();
        } catch {
          persistPosition();
        }
      } else {
        persistPosition();
      }
    }
    launcher.classList.remove('dragging');
    dragState = null;
    launcher.releasePointerCapture(ev.pointerId);
  });

  launcher.addEventListener('pointercancel', (ev) => {
    if (!dragState || dragState.pointerId !== ev.pointerId) return;
    launcher.classList.remove('dragging');
    dragState = null;
    launcher.releasePointerCapture(ev.pointerId);
  });

  function update(nextExperience: RoverExperienceConfig): void {
    experience = nextExperience;
    launcher.setAttribute('data-draggable', experience.presence?.draggable === false ? 'false' : 'true');
    launcherLabel.textContent = experience.presence?.ctaText || `Do it with ${agentName}`;
    launcher.setAttribute('aria-label', `Open ${resolvedAgentName} assistant`);
    launcher.setAttribute('aria-description', launcherAriaDescription);
    launcher.classList.toggle('orbit', experience.presence?.idleAnimation === 'orbit');
    launcher.classList.toggle('breathe', experience.presence?.idleAnimation !== 'none');
    applyPosition();
  }

  function setMood(mood: RoverMood): void {
    // Mood is applied via wrapper data attribute, not directly on seed
  }

  function setMuted(muted: boolean): void {
    if (launcherVideo) launcherVideo.muted = muted;
  }

  function positionGreetingBubble(): void {
    const rect = launcher.getBoundingClientRect();
    const bubbleWidth = greetingBubble.offsetWidth || 220;
    const bubbleHeight = greetingBubble.offsetHeight || 48;
    const seedCenterX = rect.left + rect.width / 2;
    const vw = window.innerWidth || document.documentElement.clientWidth;

    // Center bubble above seed, clamp to viewport
    let left = seedCenterX - bubbleWidth / 2;
    left = Math.max(8, Math.min(vw - bubbleWidth - 8, left));
    let top = rect.top - bubbleHeight - 12;

    // If near top, flip below seed
    if (top < 8) {
      top = rect.bottom + 12;
      greetingBubble.classList.add('flipped');
    } else {
      greetingBubble.classList.remove('flipped');
    }

    greetingBubble.style.left = `${left}px`;
    greetingBubble.style.top = `${top}px`;
  }

  let greetingDismissing = false;
  function setGreeting(text: string | null): void {
    if (text) {
      greetingText.textContent = text;
      greetingBubble.classList.remove('dismissing');
      greetingBubble.classList.add('visible');
      greetingDismissing = false;
      // Position after visible so we can measure
      requestAnimationFrame(() => positionGreetingBubble());
    } else {
      if (!greetingBubble.classList.contains('visible') || greetingDismissing) return;
      greetingDismissing = true;
      greetingBubble.classList.add('dismissing');
      const onEnd = () => {
        greetingBubble.removeEventListener('animationend', onEnd);
        greetingBubble.classList.remove('visible', 'dismissing');
        greetingDismissing = false;
      };
      greetingBubble.addEventListener('animationend', onEnd);
    }
  }

  // Dismiss greeting on close button
  greetingClose.addEventListener('click', (e) => {
    e.stopPropagation();
    setGreeting(null);
  });

  // Click greeting text → open chat + dismiss
  greetingBubble.addEventListener('click', () => {
    setGreeting(null);
    opts.onClick();
  });

  function destroy(): void {
    // Cleanup handled by parent removing from DOM
  }

  return {
    root: launcher,
    greetingBubble,
    video: launcherVideo,
    update,
    setMood,
    setMuted,
    setGreeting,
    applyPosition,
    persistPosition,
    getPosition: () => presencePosition || getDefaultPosition(),
    destroy,
  };
}
