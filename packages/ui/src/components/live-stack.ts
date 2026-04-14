import type { RoverTimelineEvent, RoverThoughtStyle, RoverExperienceConfig } from '../types.js';
import { sanitizeText } from '../config.js';
import {
  deriveTraceKey,
  normalizeTimelineStatus,
  formatTime,
  createId,
  deriveTimelineBody,
  deriveTimelineHeading,
  deriveTimelineStatusLabel,
} from '../dom-helpers.js';

export type LiveStackComponent = {
  root: HTMLDivElement;
  addTimelineEvent: (event: RoverTimelineEvent) => void;
  clear: () => void;
  show: () => void;
  hide: () => void;
  setOnExpand: (handler: () => void) => void;
  setThoughtStyle: (style?: RoverThoughtStyle) => void;
  setStreamConfig: (stream?: RoverExperienceConfig['stream']) => void;
  destroy: () => void;
};

type LiveStackOptions = {
  thoughtStyle?: RoverThoughtStyle;
  stream?: RoverExperienceConfig['stream'];
};

function clampLiveCardCount(value?: number): number {
  if (!Number.isFinite(Number(value))) return 2;
  return Math.max(1, Math.min(4, Math.trunc(Number(value))));
}

export function createLiveStack(options: LiveStackOptions = {}): LiveStackComponent {
  const root = document.createElement('div');
  root.className = 'liveStack';
  let thoughtStyle: RoverThoughtStyle = options.thoughtStyle === 'minimal' ? 'minimal' : 'concise_cards';
  let maxVisibleCards = clampLiveCardCount(options.stream?.maxVisibleLiveCards);
  let collapseCompletedSteps = options.stream?.collapseCompletedSteps !== false;
  root.dataset.thoughtStyle = thoughtStyle;

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'liveStackHeader';

  const dot = document.createElement('span');
  dot.className = 'liveStackDot';

  const label = document.createElement('span');
  label.className = 'liveStackLabel';
  label.textContent = 'LIVE STREAM';

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'liveStackExpandBtn';
  expandBtn.setAttribute('aria-label', 'Expand to full view');
  expandBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';

  header.appendChild(dot);
  header.appendChild(label);
  header.appendChild(expandBtn);

  // ── Overflow Pill ──
  const overflowPill = document.createElement('button');
  overflowPill.type = 'button';
  overflowPill.className = 'liveStackOverflow';

  // ── Cards Container ──
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'liveStackCards';

  root.appendChild(header);
  root.appendChild(cardsContainer);
  root.appendChild(overflowPill);

  // ── State ──
  const cardEntries = new Map<string, HTMLDivElement>();
  const cardOrder: HTMLDivElement[] = [];
  const seenIds = new Set<string>();
  let onExpandHandler: (() => void) | null = null;
  let pendingRaf: number | null = null;
  let hideTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // ── Expand callback ──
  expandBtn.addEventListener('click', () => { onExpandHandler?.(); });
  overflowPill.addEventListener('click', () => { onExpandHandler?.(); });

  // ── Card Factory ──
  function createCard(): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'liveStackCard hidden';

    const top = document.createElement('div');
    top.className = 'liveStackCardTop';

    const meta = document.createElement('div');
    meta.className = 'liveStackCardMeta';

    const ts = document.createElement('span');
    ts.className = 'liveStackCardTs';

    const sep = document.createElement('span');
    sep.className = 'liveStackCardSep';
    sep.textContent = '\u2014';

    const status = document.createElement('span');
    status.className = 'liveStackCardStatus';

    const spinner = document.createElement('div');
    spinner.className = 'liveStackCardSpinner';

    meta.appendChild(ts);
    meta.appendChild(sep);
    meta.appendChild(status);
    top.appendChild(meta);
    top.appendChild(spinner);

    const title = document.createElement('div');
    title.className = 'liveStackCardTitle';

    const detail = document.createElement('div');
    detail.className = 'liveStackCardDetail';

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(detail);

    // Click to toggle expanded detail
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      if (card.classList.contains('expanded')) {
        card.classList.remove('expanded');
      } else {
        // Collapse all others first
        for (const c of cardOrder) c.classList.remove('expanded');
        card.classList.add('expanded');
      }
    });

    return card;
  }

  function ensureCard(key: string): HTMLDivElement {
    const existing = cardEntries.get(key);
    if (existing) return existing;

    const card = createCard();
    cardEntries.set(key, card);
    cardOrder.push(card);
    cardsContainer.appendChild(card);
    return card;
  }

  function updateCard(card: HTMLDivElement, event: RoverTimelineEvent): void {
    const ts = Number(event.ts) || Date.now();
    const heading = deriveTimelineHeading(event);
    const statusLabel = deriveTimelineStatusLabel(event);
    const body = deriveTimelineBody(event);

    const tsEl = card.querySelector('.liveStackCardTs') as HTMLSpanElement;
    const statusEl = card.querySelector('.liveStackCardStatus') as HTMLSpanElement;
    const titleEl = card.querySelector('.liveStackCardTitle') as HTMLDivElement;
    const detailEl = card.querySelector('.liveStackCardDetail') as HTMLDivElement;

    tsEl.textContent = formatTime(ts);
    statusEl.textContent = statusLabel;
    titleEl.textContent = heading || 'Processing...';
    card.classList.toggle('minimalThought', thoughtStyle === 'minimal');

    // Update detail content
    const detailText = sanitizeText(event.detail || '') || (body !== heading ? body : '');
    if (detailText) {
      detailEl.textContent = detailText.slice(0, 500);
      card.dataset.hasDetail = 'true';
    } else {
      detailEl.textContent = '';
      delete card.dataset.hasDetail;
    }

    // Status-based styling via data attribute
    const status = normalizeTimelineStatus(event);
    card.dataset.status = status;
  }

  function syncVisibility(): void {
    const total = cardOrder.length;
    const visibleCards = collapseCompletedSteps ? Math.min(total, maxVisibleCards) : total;
    const overflowCount = Math.max(0, total - visibleCards);

    for (let i = 0; i < total; i++) {
      const card = cardOrder[i];
      const posFromEnd = total - 1 - i;

      card.classList.remove('active', 'previous', 'hidden');

      if (posFromEnd === 0) {
        // Latest card
        card.classList.add('active');
        card.style.display = '';
      } else if (posFromEnd < visibleCards) {
        // Previous card
        card.classList.add('previous');
        card.style.display = '';
      } else {
        // Older cards
        card.classList.add('hidden');
        card.style.display = 'none';
      }
    }

    // Overflow pill
    if (overflowCount > 0) {
      overflowPill.textContent = 'More steps';
      overflowPill.classList.add('visible');
    } else {
      overflowPill.classList.remove('visible');
    }
  }

  function scheduleSync(): void {
    if (pendingRaf != null) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = null;
      syncVisibility();
    });
  }

  return {
    root,

    addTimelineEvent(event: RoverTimelineEvent): void {
      const title = sanitizeText(event.title || '');
      if (!title) return;
      if (title.toLowerCase() === 'assistant update') return;

      const id = event.id || createId('ls');
      if (event.id && seenIds.has(id)) return;
      seenIds.add(id);

      const key = deriveTraceKey(event);
      const useStableKey = key === 'run' || key.startsWith('tool:') || event.kind === 'tool_result'
        || (event.kind === 'status' && cardEntries.has(key));
      const card = useStableKey ? ensureCard(key) : ensureCard(`${key}:${id}`);
      updateCard(card, { ...event, title });

      scheduleSync();
    },

    clear(): void {
      seenIds.clear();
      cardEntries.clear();
      cardOrder.length = 0;
      cardsContainer.innerHTML = '';
      overflowPill.classList.remove('visible');
      if (pendingRaf != null) {
        cancelAnimationFrame(pendingRaf);
        pendingRaf = null;
      }
    },

    show(): void {
      // Cancel any pending hide timeout to prevent race condition
      if (hideTimeoutId != null) {
        clearTimeout(hideTimeoutId);
        hideTimeoutId = null;
      }
      root.classList.remove('closing');
      root.classList.add('open');
    },

    hide(): void {
      if (!root.classList.contains('open')) return;
      root.classList.add('closing');
      const cleanup = () => {
        root.classList.remove('open', 'closing');
        hideTimeoutId = null;
      };
      root.addEventListener('animationend', () => cleanup(), { once: true });
      // Fallback if animation doesn't fire
      hideTimeoutId = setTimeout(cleanup, 280);
    },

    setOnExpand(handler: () => void): void {
      onExpandHandler = handler;
    },

    setThoughtStyle(style) {
      thoughtStyle = style === 'minimal' ? 'minimal' : 'concise_cards';
      root.dataset.thoughtStyle = thoughtStyle;
      for (const card of cardOrder) {
        card.classList.toggle('minimalThought', thoughtStyle === 'minimal');
      }
    },

    setStreamConfig(stream) {
      maxVisibleCards = clampLiveCardCount(stream?.maxVisibleLiveCards);
      collapseCompletedSteps = stream?.collapseCompletedSteps !== false;
      scheduleSync();
    },

    destroy(): void {
      if (pendingRaf != null) cancelAnimationFrame(pendingRaf);
      root.remove();
    },
  };
}
