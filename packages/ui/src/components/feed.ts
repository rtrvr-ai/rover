import type { RoverMessageBlock, RoverTimelineEvent, RoverThoughtStyle, RoverExperienceConfig } from '../types.js';
import { sanitizeText, EXPAND_THRESHOLD_OUTPUT, EXPAND_THRESHOLD_THOUGHT, EXPAND_THRESHOLD_TOOL } from '../config.js';
import {
  createId,
  formatTime,
  normalizeTimelineStatus,
  deriveTraceKey,
  classifyVisibility,
  deriveTimelineBody,
  deriveTimelineHeading,
  deriveTimelineStatusLabel,
  renderAssistantMessageContent,
  renderRichContent,
  createExpandableRichContent,
  renderMessageBlock,
} from '../dom-helpers.js';

export type FeedComponent = {
  root: HTMLDivElement;         // feedWrapper
  feed: HTMLDivElement;         // the scrollable feed
  scrollBtn: HTMLButtonElement;
  typingIndicator: HTMLDivElement;
  traceToggleBar: HTMLDivElement;
  traceOrder: HTMLDivElement[];
  addMessage: (role: 'user' | 'assistant' | 'system', text: string, blocks?: RoverMessageBlock[]) => void;
  addTimelineEvent: (event: RoverTimelineEvent) => void;
  clearMessages: () => void;
  clearTimeline: () => void;
  setTraceExpanded: (expanded: boolean, maxLiveCards?: number) => void;
  setLiveMode: (active: boolean, onExpand?: () => void) => void;
  setThoughtStyle: (style?: RoverThoughtStyle) => void;
  setStreamConfig: (stream?: RoverExperienceConfig['stream']) => void;
  showTyping: (show: boolean) => void;
  smartScrollToBottom: () => void;
  getScrollPosition: () => number;
  setScrollPosition: (position: number) => void;
};

type FeedOptions = {
  thoughtStyle?: RoverThoughtStyle;
  stream?: RoverExperienceConfig['stream'];
};

function clampLiveCardCount(value?: number): number {
  if (!Number.isFinite(Number(value))) return 2;
  return Math.max(1, Math.min(4, Math.trunc(Number(value))));
}

export function createFeed(options: FeedOptions = {}): FeedComponent {
  const feedWrapper = document.createElement('div');
  feedWrapper.className = 'feedWrapper';
  feedWrapper.style.cssText = 'position:relative;flex:1;min-height:0;display:flex;flex-direction:column;';

  const feed = document.createElement('div');
  feed.className = 'feed';
  let thoughtStyle: RoverThoughtStyle = options.thoughtStyle === 'minimal' ? 'minimal' : 'concise_cards';
  let maxVisibleLiveCards = clampLiveCardCount(options.stream?.maxVisibleLiveCards);
  let collapseCompletedSteps = options.stream?.collapseCompletedSteps !== false;
  feedWrapper.dataset.thoughtStyle = thoughtStyle;
  feed.dataset.thoughtStyle = thoughtStyle;

  // Trace Toggle Bar
  const traceToggleBar = document.createElement('div');
  traceToggleBar.className = 'traceToggleBar';
  const traceToggleLabel = document.createElement('span');
  traceToggleLabel.className = 'traceToggleLabel';
  traceToggleLabel.textContent = 'Execution Log';
  const traceToggleCount = document.createElement('span');
  traceToggleCount.className = 'traceToggleCount';
  traceToggleCount.textContent = '0 steps';
  const traceToggleBtn = document.createElement('button');
  traceToggleBtn.type = 'button';
  traceToggleBtn.className = 'traceToggleBtn';
  traceToggleBtn.textContent = 'Show all';
  traceToggleBar.appendChild(traceToggleLabel);
  traceToggleBar.appendChild(traceToggleCount);
  traceToggleBar.appendChild(traceToggleBtn);
  feed.appendChild(traceToggleBar);

  // Live Stream Header (shown only in live mode)
  const liveStreamHeader = document.createElement('div');
  liveStreamHeader.className = 'liveStreamHeader';
  liveStreamHeader.style.display = 'none';
  const liveDot = document.createElement('span');
  liveDot.className = 'liveDot';
  const liveLabel = document.createElement('span');
  liveLabel.className = 'liveLabel';
  liveLabel.textContent = 'Live';
  const liveViewAllBtn = document.createElement('button');
  liveViewAllBtn.type = 'button';
  liveViewAllBtn.className = 'liveViewAllBtn';
  liveViewAllBtn.textContent = 'View all';
  liveStreamHeader.appendChild(liveDot);
  liveStreamHeader.appendChild(liveLabel);
  liveStreamHeader.appendChild(liveViewAllBtn);
  feed.appendChild(liveStreamHeader);

  // Trace Container (wraps all trace entries)
  const traceContainer = document.createElement('div');
  traceContainer.className = 'traceContainer';
  feed.appendChild(traceContainer);

  // Overflow Pill (shows "↑ N more steps" when >3 exist in live mode)
  const liveOverflowPill = document.createElement('button');
  liveOverflowPill.type = 'button';
  liveOverflowPill.className = 'liveOverflowPill';
  liveOverflowPill.style.display = 'none';
  feed.insertBefore(liveOverflowPill, traceContainer.nextSibling);

  // Typing Indicator
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'typingIndicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typingDot';
    typingIndicator.appendChild(dot);
  }
  feed.appendChild(typingIndicator);

  // Scroll Button
  const scrollBtn = document.createElement('button');
  scrollBtn.type = 'button';
  scrollBtn.className = 'scrollBtn';
  scrollBtn.setAttribute('aria-label', 'Scroll to bottom');
  scrollBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  // Step Hover Tooltip
  const stepTooltip = document.createElement('div');
  stepTooltip.className = 'stepTooltip';
  stepTooltip.style.display = 'none';
  feedWrapper.appendChild(stepTooltip);

  feedWrapper.appendChild(feed);
  feedWrapper.appendChild(scrollBtn);

  // Scroll tracking
  let userScrolledUp = false;
  let lastAutoScrollTs = 0;

  function isNearBottom(): boolean {
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight < 60;
  }

  function smartScrollToBottom(): void {
    if (!userScrolledUp) {
      requestAnimationFrame(() => {
        feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
        lastAutoScrollTs = Date.now();
      });
      scrollBtn.classList.remove('visible');
    } else {
      scrollBtn.classList.add('visible');
    }
  }

  feed.addEventListener('scroll', () => {
    if (Date.now() - lastAutoScrollTs < 200) return;
    if (isNearBottom()) {
      userScrolledUp = false;
      scrollBtn.classList.remove('visible');
    } else {
      userScrolledUp = true;
      scrollBtn.classList.add('visible');
    }
  }, { passive: true });

  scrollBtn.addEventListener('click', () => {
    userScrolledUp = false;
    lastAutoScrollTs = Date.now();
    feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
    scrollBtn.classList.remove('visible');
  });

  // Trace state
  const seenTimelineIds = new Set<string>();
  const traceEntries = new Map<string, HTMLDivElement>();
  const traceOrder: HTMLDivElement[] = [];
  let traceExpanded = false;

  function getCollapsedVisibleCount(total: number): number {
    if (!collapseCompletedSteps) return total;
    return Math.min(total, maxVisibleLiveCards);
  }

  function syncCollapsedTraceVisibility(): void {
    const visibleLiveCards = getCollapsedVisibleCount(traceOrder.length);
    for (let i = 0; i < traceOrder.length; i++) {
      const item = traceOrder[i];
      const isRecent = i >= traceOrder.length - visibleLiveCards;
      item.style.display = isRecent ? '' : 'none';
      const status = item.dataset.status;
      const done = status === 'success' || status === 'error' || status === 'info';
      item.classList.toggle('compact', collapseCompletedSteps && done);
    }
  }

  function ensureTraceEntry(key: string): HTMLDivElement {
    const existing = traceEntries.get(key);
    if (existing) return existing;

    const entry = document.createElement('div');
    entry.className = 'entry trace pending';

    const top = document.createElement('div');
    top.className = 'traceTop';
    const traceMeta = document.createElement('div');
    traceMeta.className = 'traceMeta';
    const stage = document.createElement('span');
    stage.className = 'traceStage';
    stage.textContent = 'step';
    const title = document.createElement('div');
    title.className = 'traceTitle';
    const ts = document.createElement('div');
    ts.className = 'traceTs';
    traceMeta.appendChild(stage);
    traceMeta.appendChild(title);
    top.appendChild(traceMeta);
    top.appendChild(ts);

    const detail = document.createElement('div');
    detail.className = 'traceDetail';

    entry.appendChild(top);
    entry.appendChild(detail);

    entry.addEventListener('click', () => {
      if (liveMode && onLiveExpand) onLiveExpand();
    });

    entry.addEventListener('mouseenter', () => {
      const text = entry.dataset.tooltipText;
      if (!text) return;
      stepTooltip.textContent = text;
      const rect = entry.getBoundingClientRect();
      const left = rect.right + 8;
      const top = rect.top;
      stepTooltip.style.display = 'block';
      stepTooltip.style.top = `${top}px`;
      stepTooltip.style.left = `${Math.min(left, window.innerWidth - 320)}px`;
    });
    entry.addEventListener('mouseleave', () => {
      stepTooltip.style.display = 'none';
    });

    traceEntries.set(key, entry);
    traceOrder.push(entry);
    traceContainer.appendChild(entry);
    return entry;
  }

  const INTENT_KEYWORDS: Record<string, string[]> = {
    navigate: ['navigate', 'click', 'go to', 'open', 'visit', 'redirect', 'scroll', 'switch'],
    read: ['read', 'extract', 'scrape', 'inspect', 'check', 'fetch', 'get', 'find'],
    act: ['write', 'fill', 'type', 'input', 'submit', 'upload', 'create', 'set', 'update', 'edit', 'modify', 'act', 'execute', 'run', 'trigger'],
    analyze: ['analyze', 'compare', 'evaluate', 'assess', 'verify', 'validate', 'test', 'review'],
    watch: ['watch', 'monitor', 'wait', 'listen', 'poll', 'track', 'observe'],
  };

  function extractIntentKeywords(text: string): string[] {
    const lower = text.toLowerCase();
    const found: string[] = [];
    for (const [category, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        found.push(category);
      }
    }
    if (found.length === 0) found.push('default');
    return found.slice(0, 3);
  }

  function renderIntentPills(text: string): HTMLDivElement | null {
    const categories = extractIntentKeywords(text);
    if (categories.length === 0 || (categories.length === 1 && categories[0] === 'default')) return null;
    const container = document.createElement('div');
    container.className = 'intentPills';
    for (const cat of categories) {
      const pill = document.createElement('span');
      pill.className = `intentPill ${cat}`;
      pill.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
      container.appendChild(pill);
    }
    return container;
  }

  function updateTraceEntry(entry: HTMLDivElement, event: RoverTimelineEvent): void {
    const ts = Number(event.ts) || Date.now();
    const status = normalizeTimelineStatus(event);
    const top = entry.querySelector('.traceTop') as HTMLDivElement;
    const traceMeta = top.querySelector('.traceMeta') as HTMLDivElement;
    const stageEl = traceMeta.querySelector('.traceStage') as HTMLSpanElement;
    const title = top.querySelector('.traceTitle') as HTMLDivElement;
    const tsEl = top.querySelector('.traceTs') as HTMLDivElement;
    const detail = entry.querySelector('.traceDetail') as HTMLDivElement;
    const statusLabel = deriveTimelineStatusLabel(event);
    const heading = deriveTimelineHeading(event);
    const derivedBody = deriveTimelineBody(event);

    title.textContent = heading || 'Step';
    stageEl.textContent = statusLabel;
    stageEl.style.display = statusLabel ? '' : 'none';
    tsEl.textContent = formatTime(ts);
    entry.classList.toggle('minimalThought', thoughtStyle === 'minimal');

    // Render intent pills for plan events
    const existingPills = entry.querySelector('.intentPills');
    if (existingPills) existingPills.remove();
    if (event.kind === 'plan') {
      const pillText = `${event.title || ''} ${event.detail || ''}`;
      const pills = renderIntentPills(pillText);
      if (pills) {
        const top = entry.querySelector('.traceTop') as HTMLDivElement;
        top.insertAdjacentElement('afterend', pills);
      }
    }

    detail.innerHTML = '';
    const detailBlocks = Array.isArray(event.detailBlocks) ? event.detailBlocks : [];
    const detailText = sanitizeText(event.detail || '');
    const bodyText = detailText || (derivedBody !== heading ? derivedBody : '');
    if (detailBlocks.length > 0) {
      for (const block of detailBlocks) {
        const node = renderMessageBlock(block);
        if (!node) continue;
        detail.appendChild(node);
      }
      if (bodyText) {
        const line = document.createElement('div');
        line.className = 'rvLine';
        line.appendChild(renderRichContent(bodyText));
        detail.insertBefore(line, detail.firstChild);
      }
      detail.style.display = '';
    } else if (bodyText) {
      const threshold = event.kind === 'thought' ? EXPAND_THRESHOLD_THOUGHT
        : (event.kind === 'tool_start' || event.kind === 'tool_result') ? EXPAND_THRESHOLD_TOOL
        : EXPAND_THRESHOLD_OUTPUT;
      if (bodyText.length > threshold) {
        detail.appendChild(createExpandableRichContent(bodyText, threshold));
      } else {
        detail.appendChild(renderRichContent(bodyText));
      }
      detail.style.display = '';
    } else {
      detail.style.display = 'none';
    }

    entry.classList.remove('pending', 'success', 'error', 'info');
    entry.classList.add(status);
    entry.dataset.status = status;
    entry.dataset.kind = event.kind;
    entry.dataset.visibility = classifyVisibility(event);

    const tooltipText = sanitizeText(event.detail || '');
    if (tooltipText) {
      entry.dataset.tooltipText = tooltipText.slice(0, 400);
    } else {
      delete entry.dataset.tooltipText;
    }

    const done = status === 'success' || status === 'error' || status === 'info';
    entry.classList.toggle('compact', !traceExpanded && done);
  }

  // Live mode state
  let liveMode = false;
  let onLiveExpand: (() => void) | null = null;

  function syncLiveVisibility(): void {
    if (!liveMode) return;
    const total = traceOrder.length;
    const visibleLiveCards = getCollapsedVisibleCount(total);
    const overflowCount = Math.max(0, total - visibleLiveCards);
    for (let i = 0; i < total; i++) {
      const entry = traceOrder[i];
      const isVisible = i >= total - visibleLiveCards;
      entry.style.display = isVisible ? '' : 'none';
      entry.classList.remove('liveActive', 'livePrev');
      if (i === total - 1) {
        entry.classList.add('liveActive');   // latest = active
      } else if (isVisible) {
        entry.classList.add('livePrev');     // recent history = dimmed
      }
    }
    liveOverflowPill.style.display = overflowCount > 0 ? 'flex' : 'none';
    liveOverflowPill.textContent = 'More steps';
  }

  liveViewAllBtn.addEventListener('click', () => { if (onLiveExpand) onLiveExpand(); });
  liveOverflowPill.addEventListener('click', () => { if (onLiveExpand) onLiveExpand(); });

  traceToggleBtn.addEventListener('click', () => {
    setTraceExpanded(!traceExpanded);
  });

  function setTraceExpanded(next: boolean, maxLiveCards = 2): void {
    traceExpanded = next;
    traceToggleBtn.textContent = traceExpanded ? 'Collapse' : `Show all (${traceOrder.length})`;
    maxVisibleLiveCards = clampLiveCardCount(maxLiveCards);
    if (traceExpanded) {
      for (const item of traceOrder) {
        item.style.display = '';
        item.classList.toggle('compact', false);
      }
    } else {
      syncCollapsedTraceVisibility();
    }
  }

  return {
    root: feedWrapper,
    feed,
    scrollBtn,
    typingIndicator,
    traceToggleBar,
    traceOrder,
    addMessage(role, text, blocks) {
      const clean = sanitizeText(text);
      if (!clean && (!blocks || blocks.length === 0)) return;
      const entry = document.createElement('div');
      entry.className = `entry message ${role}`;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      if (role === 'assistant') {
        bubble.appendChild(renderAssistantMessageContent(clean, blocks));
      } else {
        bubble.textContent = clean;
      }
      const stamp = document.createElement('div');
      stamp.className = 'stamp';
      stamp.textContent = formatTime(Date.now());
      entry.appendChild(bubble);
      entry.appendChild(stamp);
      feed.appendChild(entry);
      smartScrollToBottom();
    },
    addTimelineEvent(event) {
      const title = sanitizeText(event.title || '');
      if (!title) return;
      if (title.toLowerCase() === 'assistant update') return;
      const id = event.id || createId('timeline');
      if (event.id && seenTimelineIds.has(id)) return;
      seenTimelineIds.add(id);
      const key = deriveTraceKey(event);
      const useStableKey = key === 'run' || key.startsWith('tool:') || event.kind === 'tool_result' || (event.kind === 'status' && traceEntries.has(key));
      const entry = useStableKey ? ensureTraceEntry(key) : ensureTraceEntry(`${key}:${id}`);
      updateTraceEntry(entry, { ...event, title });
      const stepCount = traceOrder.length;
      traceToggleCount.textContent = `${stepCount} step${stepCount !== 1 ? 's' : ''}`;
      traceToggleBar.classList.toggle('visible', stepCount > 0);
      if (!traceExpanded) {
        traceToggleBtn.textContent = `Show all (${stepCount})`;
        syncCollapsedTraceVisibility();
      }
      if (liveMode) syncLiveVisibility();
      smartScrollToBottom();
    },
    clearMessages() {
      for (const node of Array.from(feed.querySelectorAll('.entry.message'))) {
        node.remove();
      }
    },
    clearTimeline() {
      liveMode = false;
      feed.classList.remove('liveMode');
      liveStreamHeader.style.display = 'none';
      liveOverflowPill.style.display = 'none';
      seenTimelineIds.clear();
      traceEntries.clear();
      traceOrder.length = 0;
      for (const node of Array.from(feed.querySelectorAll('.entry.trace'))) {
        node.remove();
      }
      traceToggleBar.classList.remove('visible');
      traceToggleCount.textContent = '0 steps';
    },
    setTraceExpanded,
    setLiveMode(active: boolean, onExpand?: () => void) {
      liveMode = active;
      onLiveExpand = onExpand ?? null;
      feed.classList.toggle('liveMode', active);
      liveStreamHeader.style.display = active ? 'flex' : 'none';
      liveOverflowPill.style.display = 'none'; // syncLiveVisibility will set correctly
      if (active) {
        syncLiveVisibility();
      } else {
        // Exit: remove live classes, restore all entries to normal visibility
        for (const entry of traceOrder) {
          entry.classList.remove('liveActive', 'livePrev');
        }
        // Let existing setTraceExpanded logic take over
        setTraceExpanded(traceExpanded, maxVisibleLiveCards);
      }
    },
    setThoughtStyle(style) {
      thoughtStyle = style === 'minimal' ? 'minimal' : 'concise_cards';
      feedWrapper.dataset.thoughtStyle = thoughtStyle;
      feed.dataset.thoughtStyle = thoughtStyle;
      for (const entry of traceOrder) {
        entry.classList.toggle('minimalThought', thoughtStyle === 'minimal');
      }
    },
    setStreamConfig(stream) {
      maxVisibleLiveCards = clampLiveCardCount(stream?.maxVisibleLiveCards);
      collapseCompletedSteps = stream?.collapseCompletedSteps !== false;
      if (liveMode) syncLiveVisibility();
      else if (!traceExpanded) syncCollapsedTraceVisibility();
    },
    showTyping(show) {
      if (show) {
        typingIndicator.classList.add('visible');
        feed.appendChild(typingIndicator);
        smartScrollToBottom();
      } else {
        typingIndicator.classList.remove('visible');
      }
    },
    smartScrollToBottom,
    getScrollPosition: () => feed.scrollTop,
    setScrollPosition(position) {
      requestAnimationFrame(() => { feed.scrollTop = position; });
    },
  };
}
