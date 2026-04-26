import type { RoverActionCue, RoverTimelineEvent } from '../types.js';
import { sanitizeText } from '../config.js';

export type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type ActionSpotlightSystemOptions = {
  container: HTMLElement;
  panel: HTMLElement;
  resolveElement?: (elementId: number) => Element | null;
  mobileBreakpoint?: number;
  reducedMotion?: boolean;
};

type ActiveSpotlight = {
  key: string;
  elementId: number;
  cue?: RoverActionCue;
  toolName?: string;
  ring: HTMLDivElement;
  chip?: HTMLDivElement;
  createdAt: number;
  fadeTimer?: ReturnType<typeof setTimeout>;
};

export type ActionSpotlightSystem = {
  overlay: HTMLDivElement;
  addEvent: (event: RoverTimelineEvent) => void;
  fadeEvent: (event: RoverTimelineEvent) => void;
  clearAll: () => void;
  destroy: () => void;
};

const MAX_ACTIVE_SPOTLIGHTS = 3;
const FADE_DURATION_MS = 420;
const MOBILE_BREAKPOINT_PX = 640;
const MIN_SPOTLIGHT_SIZE_PX = 28;
const DESKTOP_EXPAND_PX = 6;
const MOBILE_EXPAND_PX = 4;

function normalizeLabel(input: unknown, maxLength = 48): string {
  const clean = sanitizeText(String(input || '')).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 3).trim()}...`;
}

function readTextFromIds(doc: Document, ids: string): string {
  return ids
    .split(/\s+/)
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => {
      try {
        const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/"/g, '\\"');
        return doc.querySelector(`#${escaped}`)?.textContent || '';
      } catch {
        return '';
      }
    })
    .join(' ');
}

function roleFallback(el: Element): string {
  const role = normalizeLabel(el.getAttribute('role'));
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'text area';
  if (tag === 'input') {
    const type = normalizeLabel((el as HTMLInputElement).type || 'input');
    return type === 'submit' || type === 'button' ? 'button' : 'field';
  }
  return tag ? titleCase(tag.replace(/[-_]+/g, ' ')) : 'element';
}

function titleCase(input: string): string {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function deriveElementLabel(el?: Element | null): string {
  if (!el) return '';
  const doc = el.ownerDocument || document;
  const labelledBy = normalizeLabel(el.getAttribute('aria-labelledby'), 180);
  const labelFromIds = labelledBy ? normalizeLabel(readTextFromIds(doc, labelledBy)) : '';
  if (labelFromIds) return labelFromIds;

  const ariaLabel = normalizeLabel(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  const labels = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels;
  if (labels && labels.length) {
    const text = Array.from(labels).map(label => label.textContent || '').join(' ');
    const label = normalizeLabel(text);
    if (label) return label;
  }

  const placeholder = normalizeLabel((el as HTMLInputElement | HTMLTextAreaElement).placeholder);
  if (placeholder) return placeholder;

  if (el instanceof HTMLInputElement) {
    const type = String(el.type || '').toLowerCase();
    if ((type === 'button' || type === 'submit' || type === 'reset') && el.value) {
      const valueLabel = normalizeLabel(el.value);
      if (valueLabel) return valueLabel;
    }
  }

  const text = normalizeLabel(el.textContent);
  if (text) return text;
  return roleFallback(el);
}

function cueElementIds(event: RoverTimelineEvent): number[] {
  const raw = [
    ...(Array.isArray(event.actionCue?.elementIds) ? event.actionCue!.elementIds! : []),
    event.actionCue?.primaryElementId,
    event.elementId,
  ];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of raw) {
    const id = Math.trunc(Number(value));
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_ACTIVE_SPOTLIGHTS) break;
  }
  return ids;
}

function isMobile(width = window.innerWidth): boolean {
  return width <= MOBILE_BREAKPOINT_PX;
}

function isVisibleRect(rect: RectLike, viewport: RectLike): boolean {
  return rect.width > 0
    && rect.height > 0
    && rect.right >= 0
    && rect.bottom >= 0
    && rect.left <= viewport.width
    && rect.top <= viewport.height;
}

function toRectLike(rect: DOMRect | RectLike): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function rectsIntersect(a: RectLike, b?: RectLike): boolean {
  if (!b || b.width <= 0 || b.height <= 0) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function expandedRect(rect: RectLike, amount: number): RectLike {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  };
}

export function computeChipPlacement(params: {
  target: RectLike;
  chip: { width: number; height: number };
  viewport: RectLike;
  panel?: RectLike;
  occupied?: RectLike[];
  gap?: number;
  margin?: number;
}): { left: number; top: number; side: 'top' | 'right' | 'bottom' | 'left' } | null {
  const gap = params.gap ?? 8;
  const margin = params.margin ?? 8;
  const chip = {
    width: Math.max(1, params.chip.width),
    height: Math.max(1, params.chip.height),
  };
  const viewport = params.viewport;
  const spaces = [
    { side: 'right' as const, value: viewport.width - params.target.right },
    { side: 'left' as const, value: params.target.left },
    { side: 'bottom' as const, value: viewport.height - params.target.bottom },
    { side: 'top' as const, value: params.target.top },
  ].sort((a, b) => b.value - a.value);

  for (const { side } of spaces) {
    let left = 0;
    let top = 0;
    if (side === 'right') {
      left = params.target.right + gap;
      top = params.target.top + (params.target.height - chip.height) / 2;
    } else if (side === 'left') {
      left = params.target.left - chip.width - gap;
      top = params.target.top + (params.target.height - chip.height) / 2;
    } else if (side === 'bottom') {
      left = params.target.left + (params.target.width - chip.width) / 2;
      top = params.target.bottom + gap;
    } else {
      left = params.target.left + (params.target.width - chip.width) / 2;
      top = params.target.top - chip.height - gap;
    }
    const candidate: RectLike = {
      left,
      top,
      right: left + chip.width,
      bottom: top + chip.height,
      width: chip.width,
      height: chip.height,
    };
    if (
      candidate.left < margin
      || candidate.top < margin
      || candidate.right > viewport.width - margin
      || candidate.bottom > viewport.height - margin
    ) {
      continue;
    }
    if (rectsIntersect(candidate, expandedRect(params.target, gap))) continue;
    if (rectsIntersect(candidate, params.panel)) continue;
    if ((params.occupied || []).some(rect => rectsIntersect(candidate, rect))) continue;
    return { left, top, side };
  }
  return null;
}

function inlineVerb(kind?: RoverActionCue['kind']): string {
  const labels: Record<RoverActionCue['kind'], string> = {
    click: 'Click',
    type: 'Type',
    select: 'Select',
    clear: 'Clear',
    focus: 'Focus',
    hover: 'Hover',
    press: 'Press',
    scroll: 'Scroll',
    drag: 'Drag',
    navigate: 'Open',
    read: 'Read',
    wait: 'Wait',
    unknown: 'Act',
  };
  return labels[kind || 'unknown'] || labels.unknown;
}

function inlineChipText(cue: RoverActionCue | undefined, label: string): string {
  const verb = inlineVerb(cue?.kind);
  const target = normalizeLabel(label || cue?.targetLabel, 36);
  return target ? `${verb} ${target}` : verb;
}

export function createActionSpotlightSystem(opts: ActionSpotlightSystemOptions): ActionSpotlightSystem {
  const { container, panel } = opts;
  const mobileBreakpoint = opts.mobileBreakpoint ?? MOBILE_BREAKPOINT_PX;
  let destroyed = false;
  let rafId: number | null = null;
  const active: ActiveSpotlight[] = [];

  const overlay = document.createElement('div');
  overlay.className = 'actionSpotlightLayer';
  container.appendChild(overlay);

  function viewportRect(): RectLike {
    const width = window.visualViewport?.width ?? window.innerWidth;
    const height = window.visualViewport?.height ?? window.innerHeight;
    return { left: 0, top: 0, right: width, bottom: height, width, height };
  }

  function updateOne(spotlight: ActiveSpotlight, occupied: RectLike[]): void {
    const el = opts.resolveElement?.(spotlight.elementId);
    const viewport = viewportRect();
    if (!el) {
      spotlight.ring.style.display = 'none';
      if (spotlight.chip) spotlight.chip.style.display = 'none';
      return;
    }

    const rect = toRectLike(el.getBoundingClientRect());
    if (!isVisibleRect(rect, viewport)) {
      spotlight.ring.style.display = 'none';
      if (spotlight.chip) spotlight.chip.style.display = 'none';
      return;
    }

    const mobile = (window.visualViewport?.width ?? window.innerWidth) <= mobileBreakpoint;
    const expand = mobile ? MOBILE_EXPAND_PX : DESKTOP_EXPAND_PX;
    const width = Math.max(MIN_SPOTLIGHT_SIZE_PX, rect.width + expand * 2);
    const height = Math.max(MIN_SPOTLIGHT_SIZE_PX, rect.height + expand * 2);
    const left = rect.left - (width - rect.width) / 2;
    const top = rect.top - (height - rect.height) / 2;

    spotlight.ring.style.display = 'block';
    spotlight.ring.style.width = `${width}px`;
    spotlight.ring.style.height = `${height}px`;
    spotlight.ring.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;

    if (!spotlight.chip || mobile || spotlight.cue?.kind === 'unknown') {
      if (spotlight.chip) spotlight.chip.style.display = 'none';
      return;
    }

    const label = deriveElementLabel(el);
    spotlight.chip.textContent = inlineChipText(spotlight.cue, label);
    spotlight.chip.style.display = 'block';
    spotlight.chip.style.transform = 'translate3d(-10000px, -10000px, 0)';
    const chipRect = spotlight.chip.getBoundingClientRect();
    const placement = computeChipPlacement({
      target: rect,
      chip: {
        width: Math.min(180, Math.max(1, chipRect.width || 72)),
        height: Math.max(1, chipRect.height || 28),
      },
      viewport,
      panel: toRectLike(panel.getBoundingClientRect()),
      occupied,
    });
    if (!placement) {
      spotlight.chip.style.display = 'none';
      return;
    }
    spotlight.chip.dataset.side = placement.side;
    spotlight.chip.style.transform = `translate3d(${Math.round(placement.left)}px, ${Math.round(placement.top)}px, 0)`;
    occupied.push({
      left: placement.left,
      top: placement.top,
      right: placement.left + Math.min(180, Math.max(1, chipRect.width || 72)),
      bottom: placement.top + Math.max(1, chipRect.height || 28),
      width: Math.min(180, Math.max(1, chipRect.width || 72)),
      height: Math.max(1, chipRect.height || 28),
    });
  }

  function updatePositions(): void {
    if (destroyed || active.length === 0) {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      return;
    }
    const occupied: RectLike[] = [];
    for (const spotlight of active) updateOne(spotlight, occupied);
    rafId = requestAnimationFrame(updatePositions);
  }

  function startLoop(): void {
    if (rafId != null || destroyed) return;
    rafId = requestAnimationFrame(updatePositions);
  }

  function removeSpotlight(spotlight: ActiveSpotlight): void {
    if (spotlight.fadeTimer) clearTimeout(spotlight.fadeTimer);
    spotlight.ring.remove();
    spotlight.chip?.remove();
    const idx = active.indexOf(spotlight);
    if (idx >= 0) active.splice(idx, 1);
  }

  function fadeSpotlight(spotlight: ActiveSpotlight): void {
    if (spotlight.ring.classList.contains('fading')) return;
    spotlight.ring.classList.add('fading');
    spotlight.chip?.classList.add('fading');
    spotlight.fadeTimer = setTimeout(() => removeSpotlight(spotlight), FADE_DURATION_MS);
  }

  function createSpotlight(elementId: number, event: RoverTimelineEvent): ActiveSpotlight {
    const ring = document.createElement('div');
    ring.className = 'actionSpotlightRing';
    if (!opts.reducedMotion) ring.classList.add('pulse');
    overlay.appendChild(ring);

    const chip = document.createElement('div');
    chip.className = 'actionSpotlightChip';
    chip.textContent = inlineVerb(event.actionCue?.kind);
    overlay.appendChild(chip);

    const spotlight: ActiveSpotlight = {
      key: String(elementId),
      elementId,
      cue: event.actionCue,
      toolName: event.toolName,
      ring,
      chip,
      createdAt: Date.now(),
    };
    active.push(spotlight);
    return spotlight;
  }

  function addEvent(event: RoverTimelineEvent): void {
    if (destroyed) return;
    const ids = cueElementIds(event);
    if (!ids.length) return;
    const newIds = ids.filter(elementId => !active.some(item => item.elementId === elementId));
    while (active.length + newIds.length > MAX_ACTIVE_SPOTLIGHTS && active.length > 0) {
      const oldest = active.shift();
      if (oldest) fadeSpotlight(oldest);
    }
    for (const elementId of ids) {
      const existing = active.find(item => item.elementId === elementId);
      if (existing) {
        existing.cue = event.actionCue;
        existing.toolName = event.toolName;
        existing.ring.classList.remove('fading');
        existing.chip?.classList.remove('fading');
      } else {
        createSpotlight(elementId, event);
      }
    }
    startLoop();
  }

  function fadeEvent(event: RoverTimelineEvent): void {
    const ids = cueElementIds(event);
    if (!ids.length) return;
    for (const elementId of ids) {
      const spotlight = active.find(item => item.elementId === elementId);
      if (spotlight) fadeSpotlight(spotlight);
    }
  }

  function clearAll(): void {
    while (active.length) removeSpotlight(active[0]);
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  const scheduleUpdate = () => startLoop();
  window.addEventListener('scroll', scheduleUpdate, true);
  window.addEventListener('resize', scheduleUpdate);
  window.visualViewport?.addEventListener('resize', scheduleUpdate);
  window.visualViewport?.addEventListener('scroll', scheduleUpdate);

  return {
    overlay,
    addEvent,
    fadeEvent,
    clearAll,
    destroy(): void {
      destroyed = true;
      clearAll();
      window.removeEventListener('scroll', scheduleUpdate, true);
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleUpdate);
      overlay.remove();
    },
  };
}
