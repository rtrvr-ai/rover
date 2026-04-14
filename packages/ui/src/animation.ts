import type { RoverPresenceState } from './types.js';

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Capture bounding rect for FLIP animation. */
export function captureRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Apply inverse transform for FLIP animation. */
export function applyFLIPInverse(el: HTMLElement, from: Rect, to: Rect): void {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const sw = from.width / (to.width || 1);
  const sh = from.height / (to.height || 1);
  el.style.transform = `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`;
  el.style.transformOrigin = '0 0';
}

/** Animate FLIP to identity. */
export function animateFLIP(
  el: HTMLElement,
  duration: number,
  easing: string,
): Animation {
  const animation = el.animate(
    [
      { transform: el.style.transform, transformOrigin: '0 0' },
      { transform: 'translate(0, 0) scale(1, 1)', transformOrigin: '0 0' },
    ],
    { duration, easing, fill: 'forwards' },
  );
  animation.finished.then(() => {
    el.style.transform = '';
    el.style.transformOrigin = '';
  }).catch(() => {});
  return animation;
}

export type MorphTransitionOptions = {
  seed: HTMLElement;
  panel: HTMLElement;
  backdrop?: HTMLElement;
  duration?: number;
  easing?: string;
  style?: 'morph' | 'crossfade';
};

/** Morph transition from seed to window. */
export function morphSeedToWindow(opts: MorphTransitionOptions): Promise<void> {
  const { seed, panel, backdrop, style = 'morph' } = opts;
  const duration = opts.duration ?? 480;
  const easing = opts.easing ?? 'cubic-bezier(0.16, 1, 0.3, 1)';

  if (style === 'crossfade') {
    return crossfadeTransition(seed, panel, backdrop, duration, easing);
  }

  return new Promise<void>((resolve) => {
    // Show backdrop
    if (backdrop) {
      backdrop.classList.add('visible');
    }

    // Morph panel in (seed stays visible)
    panel.style.animation = 'none';
    panel.classList.add('open');
    panel.style.display = 'flex';
    const panelAnim = panel.animate(
      [
        { opacity: 0, transform: 'scale(0.3)', filter: 'blur(6px)', borderRadius: '999px' },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', borderRadius: '28px' },
      ],
      { duration, easing, fill: 'forwards' },
    );

    panelAnim.finished.then(() => {
      panel.style.transform = '';
      panel.style.filter = '';
      panel.style.animation = '';
      resolve();
    }).catch(() => resolve());
  });
}

/** Morph transition from window to seed. */
export function morphWindowToSeed(opts: MorphTransitionOptions): Promise<void> {
  const { seed, panel, backdrop, style = 'morph' } = opts;
  const duration = opts.duration ?? 320;
  const easing = opts.easing ?? 'cubic-bezier(0.4, 0, 1, 1)';

  if (style === 'crossfade') {
    return crossfadeTransition(panel, seed, backdrop, duration, easing, true);
  }

  return new Promise<void>((resolve) => {
    // Phase 1: Morph panel out
    const panelAnim = panel.animate(
      [
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0)', borderRadius: '28px' },
        { opacity: 0, transform: 'scale(0.3)', filter: 'blur(6px)', borderRadius: '999px' },
      ],
      { duration, easing, fill: 'forwards' },
    );

    if (backdrop) {
      backdrop.classList.remove('visible');
    }

    panelAnim.finished.then(() => {
      panel.classList.remove('open');
      panel.style.display = 'none';
      panel.style.transform = '';
      panel.style.filter = '';
      panel.style.animation = '';

      // Seed attention-pulse after close
      seed.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
        { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );

      resolve();
    }).catch(() => resolve());
  });
}

function crossfadeTransition(
  from: HTMLElement,
  to: HTMLElement,
  backdrop: HTMLElement | undefined,
  duration: number,
  easing: string,
  isReverse = false,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const half = duration / 2;
    from.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: half, easing, fill: 'forwards' },
    ).finished.then(() => {
      // Only hide the panel on close (isReverse), not the seed on open
      if (isReverse) from.style.display = 'none';
      if (backdrop) {
        if (isReverse) backdrop.classList.remove('visible');
        else backdrop.classList.add('visible');
      }
      to.style.display = '';
      if (!isReverse) to.classList.add('open');
      to.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: half, easing, fill: 'forwards' },
      ).finished.then(() => {
        resolve();
      }).catch(() => resolve());
    }).catch(() => resolve());
  });
}

export type BarTransitionOptions = {
  bar: HTMLElement;
  panel: HTMLElement;
  backdrop?: HTMLElement;
  duration?: number;
  easing?: string;
};

/** Morph transition from window to bar. */
export function morphWindowToBar(opts: BarTransitionOptions): Promise<void> {
  const { panel, bar, backdrop } = opts;
  const duration = opts.duration ?? 350;
  const easing = opts.easing ?? 'cubic-bezier(0.4, 0, 0.2, 1)';

  return new Promise<void>((resolve) => {
    // Shrink panel out
    const panelAnim = panel.animate(
      [
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' },
        { opacity: 0, transform: 'scale(0.5) translateY(40px)', filter: 'blur(4px)' },
      ],
      { duration, easing, fill: 'forwards' },
    );

    if (backdrop) backdrop.classList.remove('visible');

    panelAnim.finished.then(() => {
      panel.classList.remove('open');
      panel.style.display = 'none';
      panel.style.transform = '';
      panel.style.filter = '';
      panel.style.animation = '';
      // Show bar
      bar.classList.add('open');
      resolve();
    }).catch(() => resolve());
  });
}

/** Morph transition from bar to window. */
export function morphBarToWindow(opts: BarTransitionOptions): Promise<void> {
  const { panel, bar, backdrop } = opts;
  const duration = opts.duration ?? 420;
  const easing = opts.easing ?? 'cubic-bezier(0.16, 1, 0.3, 1)';

  return new Promise<void>((resolve) => {
    // Hide bar
    bar.classList.remove('open');

    // Show panel with morph
    if (backdrop) backdrop.classList.add('visible');
    panel.style.animation = 'none';
    panel.classList.add('open');
    panel.style.display = 'flex';

    const panelAnim = panel.animate(
      [
        { opacity: 0, transform: 'scale(0.5) translateY(40px)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' },
      ],
      { duration, easing, fill: 'forwards' },
    );

    panelAnim.finished.then(() => {
      panel.style.transform = '';
      panel.style.filter = '';
      panel.style.animation = '';
      resolve();
    }).catch(() => resolve());
  });
}

/** Morph transition from seed to bar. */
export function morphSeedToBar(opts: { seed: HTMLElement; bar: HTMLElement; duration?: number }): Promise<void> {
  const { seed, bar } = opts;
  const duration = opts.duration ?? 300;

  return new Promise<void>((resolve) => {
    seed.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.9)' }],
      { duration: duration * 0.6, easing: 'ease-out', fill: 'forwards' },
    ).finished.then(() => {
      bar.classList.add('open');
      resolve();
    }).catch(() => resolve());
  });
}

/** Morph transition from bar to seed. */
export function morphBarToSeed(opts: { seed: HTMLElement; bar: HTMLElement; duration?: number }): Promise<void> {
  const { seed, bar } = opts;
  const duration = opts.duration ?? 280;

  return new Promise<void>((resolve) => {
    bar.classList.remove('open');
    seed.animate(
      [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }],
      { duration, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' },
    ).finished.then(() => {
      seed.style.transform = '';
      resolve();
    }).catch(() => resolve());
  });
}

/** Check if user prefers reduced motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scale duration based on motion intensity preference. */
export function scaleDuration(base: number, intensity: 'calm' | 'balanced' | 'expressive'): number {
  if (intensity === 'calm') return Math.round(base * 1.5);
  if (intensity === 'expressive') return Math.round(base * 0.8);
  return base;
}
