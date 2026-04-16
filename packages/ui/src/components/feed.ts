import type { RoverMessageBlock, RoverTimelineEvent, RoverThoughtStyle, RoverExperienceConfig } from '../types.js';
import { sanitizeText, EXPAND_THRESHOLD_OUTPUT, EXPAND_THRESHOLD_THOUGHT, EXPAND_THRESHOLD_TOOL } from '../config.js';
import {
  buildTranscriptSegments,
  createExpandableRichContent,
  createId,
  classifyVisibility,
  deriveTimelineBody,
  deriveTimelineHeading,
  deriveTimelineStatusLabel,
  formatTime,
  mergeTranscriptItems,
  normalizeTimelineStatus,
  deriveTraceKey,
  renderAssistantMessageContent,
  renderMessageBlock,
  renderRichContent,
  type TranscriptMessageLike,
  type TranscriptSegment,
  type TranscriptTimelineLike,
} from '../dom-helpers.js';

export type FeedComponent = {
  root: HTMLDivElement;
  feed: HTMLDivElement;
  scrollBtn: HTMLButtonElement;
  typingIndicator: HTMLDivElement;
  traceOrder: HTMLDivElement[];
  addMessage: (role: 'user' | 'assistant' | 'system', text: string, blocks?: RoverMessageBlock[]) => void;
  setTranscript: (
    messages: Array<{
      id?: string;
      role: 'user' | 'assistant' | 'system';
      text: string;
      blocks?: RoverMessageBlock[];
      ts?: number;
    }>,
    timeline: RoverTimelineEvent[],
  ) => void;
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

type FeedMessageRecord = TranscriptMessageLike & {
  id: string;
  ts: number;
  order: number;
};

type FeedTimelineRecord = TranscriptTimelineLike & {
  id: string;
  title: string;
  ts: number;
  order: number;
};

type FeedTimelineSegment = Extract<TranscriptSegment, { kind: 'timeline' }>;

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

  const transcriptContainer = document.createElement('div');
  transcriptContainer.className = 'transcriptContainer';
  feed.appendChild(transcriptContainer);

  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'typingIndicator';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'typingDot';
    typingIndicator.appendChild(dot);
  }
  feed.appendChild(typingIndicator);

  const scrollBtn = document.createElement('button');
  scrollBtn.type = 'button';
  scrollBtn.className = 'scrollBtn';
  scrollBtn.setAttribute('aria-label', 'Scroll to bottom');
  scrollBtn.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  const stepTooltip = document.createElement('div');
  stepTooltip.className = 'stepTooltip';
  stepTooltip.style.display = 'none';
  feedWrapper.appendChild(stepTooltip);

  feedWrapper.appendChild(feed);
  feedWrapper.appendChild(scrollBtn);

  let userScrolledUp = false;
  let lastAutoScrollTs = 0;
  let liveMode = false;
  let onLiveExpand: (() => void) | null = null;
  let nextSequence = 0;
  let defaultTraceExpanded = false;

  const traceOrder: HTMLDivElement[] = [];
  const messages: FeedMessageRecord[] = [];
  const timelineEvents: FeedTimelineRecord[] = [];
  const traceSegmentExpansion = new Map<string, boolean>();

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

  function getCollapsedVisibleCount(total: number): number {
    if (!collapseCompletedSteps) return total;
    return Math.min(total, maxVisibleLiveCards);
  }

  function normalizeMessageRecord(
    message: {
      id?: string;
      role: 'user' | 'assistant' | 'system';
      text: string;
      blocks?: RoverMessageBlock[];
      ts?: number;
      order?: number;
    },
    orderOverride?: number,
  ): FeedMessageRecord {
    return {
      id: sanitizeText(message.id || '') || createId('msg'),
      role: message.role,
      text: String(message.text || ''),
      blocks: Array.isArray(message.blocks) ? message.blocks : [],
      ts: Number(message.ts) || Date.now(),
      order: Number.isFinite(Number(orderOverride))
        ? Number(orderOverride)
        : (Number.isFinite(Number(message.order)) ? Number(message.order) : nextSequence++),
    };
  }

  function normalizeTimelineRecord(
    event: RoverTimelineEvent & { order?: number },
    orderOverride?: number,
  ): FeedTimelineRecord {
    return {
      ...event,
      id: sanitizeText(event.id || '') || createId('timeline'),
      title: String(event.title || ''),
      detail: event.detail ? String(event.detail) : undefined,
      detailBlocks: Array.isArray(event.detailBlocks) ? event.detailBlocks : [],
      ts: Number(event.ts) || Date.now(),
      order: Number.isFinite(Number(orderOverride))
        ? Number(orderOverride)
        : (Number.isFinite(Number(event.order)) ? Number(event.order) : nextSequence++),
    };
  }

  function upsertMessage(record: FeedMessageRecord): void {
    const index = messages.findIndex(message => message.id === record.id);
    if (index >= 0) {
      messages[index] = {
        ...messages[index],
        ...record,
        order: messages[index].order,
      };
      return;
    }
    messages.push(record);
  }

  function upsertTimeline(record: FeedTimelineRecord): void {
    const index = timelineEvents.findIndex(event => event.id === record.id);
    if (index >= 0) {
      timelineEvents[index] = {
        ...timelineEvents[index],
        ...record,
        order: timelineEvents[index].order,
      };
      return;
    }
    timelineEvents.push(record);
  }

  function prepareTranscriptMessage(
    message: {
      id?: string;
      role: 'user' | 'assistant' | 'system';
      text: string;
      blocks?: RoverMessageBlock[];
      ts?: number;
      order?: number;
    },
  ): TranscriptMessageLike {
    const prepared: TranscriptMessageLike = {
      id: sanitizeText(message.id || '') || createId('msg'),
      role: message.role,
      text: String(message.text || ''),
      blocks: Array.isArray(message.blocks) ? message.blocks : [],
      ts: Number(message.ts) || Date.now(),
    };
    if (Number.isFinite(Number(message.order))) prepared.order = Number(message.order);
    return prepared;
  }

  function prepareTranscriptTimeline(event: RoverTimelineEvent & { order?: number }): TranscriptTimelineLike {
    const prepared: TranscriptTimelineLike = {
      ...event,
      id: sanitizeText(event.id || '') || createId('timeline'),
      title: String(event.title || ''),
      detail: event.detail ? String(event.detail) : undefined,
      detailBlocks: Array.isArray(event.detailBlocks) ? event.detailBlocks : [],
      ts: Number(event.ts) || Date.now(),
    };
    if (Number.isFinite(Number(event.order))) prepared.order = Number(event.order);
    return prepared;
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
      if (keywords.some(keyword => lower.includes(keyword))) {
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
    for (const category of categories) {
      const pill = document.createElement('span');
      pill.className = `intentPill ${category}`;
      pill.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      container.appendChild(pill);
    }
    return container;
  }

  function createMessageEntry(message: FeedMessageRecord): HTMLDivElement {
    const entry = document.createElement('div');
    entry.className = `entry message ${message.role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const clean = sanitizeText(message.text);
    if (message.role === 'assistant') {
      bubble.appendChild(renderAssistantMessageContent(clean, message.blocks));
    } else {
      bubble.textContent = clean;
    }
    const stamp = document.createElement('div');
    stamp.className = 'stamp';
    stamp.textContent = formatTime(message.ts);
    entry.appendChild(bubble);
    entry.appendChild(stamp);
    return entry;
  }

  function buildDisplayedTraceEvents(events: FeedTimelineRecord[]): FeedTimelineRecord[] {
    const displayed: Array<{ key: string; event: FeedTimelineRecord }> = [];
    const stableIndexByKey = new Map<string, number>();
    for (const rawEvent of events) {
      const title = sanitizeText(rawEvent.title || '');
      if (!title) continue;
      if (title.toLowerCase() === 'assistant update') continue;
      const event = { ...rawEvent, title };
      const key = deriveTraceKey(event);
      const useStableKey =
        key === 'run'
        || key.startsWith('tool:')
        || event.kind === 'tool_result'
        || (event.kind === 'status' && stableIndexByKey.has(key));
      if (useStableKey && stableIndexByKey.has(key)) {
        displayed[stableIndexByKey.get(key)!] = { key, event };
        continue;
      }
      if (useStableKey) {
        stableIndexByKey.set(key, displayed.length);
      }
      displayed.push({ key, event });
    }
    return displayed.map(item => item.event);
  }

  function createTraceEntry(event: FeedTimelineRecord): HTMLDivElement {
    const entry = document.createElement('div');
    entry.className = 'entry trace pending';

    const top = document.createElement('div');
    top.className = 'traceTop';
    const traceMeta = document.createElement('div');
    traceMeta.className = 'traceMeta';
    const stage = document.createElement('span');
    stage.className = 'traceStage';
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
      const topPosition = rect.top;
      stepTooltip.style.display = 'block';
      stepTooltip.style.top = `${topPosition}px`;
      stepTooltip.style.left = `${Math.min(left, window.innerWidth - 320)}px`;
    });
    entry.addEventListener('mouseleave', () => {
      stepTooltip.style.display = 'none';
    });

    const status = normalizeTimelineStatus(event);
    const statusLabel = deriveTimelineStatusLabel(event);
    const heading = deriveTimelineHeading(event);
    const derivedBody = deriveTimelineBody(event);
    const detailBlocks = Array.isArray(event.detailBlocks) ? event.detailBlocks : [];
    const detailText = sanitizeText(event.detail || '');
    const bodyText = detailText || (derivedBody !== heading ? derivedBody : '');

    title.textContent = heading || 'Step';
    stage.textContent = statusLabel;
    stage.style.display = statusLabel ? '' : 'none';
    ts.textContent = formatTime(event.ts);
    entry.classList.toggle('minimalThought', thoughtStyle === 'minimal');

    if (event.kind === 'plan') {
      const pills = renderIntentPills(`${event.title || ''} ${event.detail || ''}`);
      if (pills) entry.appendChild(pills);
    }

    if (detailBlocks.length > 0) {
      if (bodyText) {
        const line = document.createElement('div');
        line.className = 'rvLine';
        line.appendChild(renderRichContent(bodyText));
        detail.appendChild(line);
      }
      for (const block of detailBlocks) {
        const node = renderMessageBlock(block);
        if (!node) continue;
        detail.appendChild(node);
      }
      detail.style.display = '';
    } else if (bodyText) {
      const threshold = event.kind === 'thought'
        ? EXPAND_THRESHOLD_THOUGHT
        : (event.kind === 'tool_start' || event.kind === 'tool_result')
          ? EXPAND_THRESHOLD_TOOL
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
    if (tooltipText) entry.dataset.tooltipText = tooltipText.slice(0, 400);
    else delete entry.dataset.tooltipText;

    return entry;
  }

  function applyTraceSegmentVisibility(cards: HTMLDivElement[], expanded: boolean): void {
    const visibleCards = expanded ? cards.length : getCollapsedVisibleCount(cards.length);
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const isVisible = expanded || i >= cards.length - visibleCards;
      card.style.display = isVisible ? '' : 'none';
      const status = card.dataset.status;
      const done = status === 'success' || status === 'error' || status === 'info';
      card.classList.toggle('compact', !expanded && collapseCompletedSteps && done);
    }
  }

  function createTraceSegment(segment: FeedTimelineSegment): HTMLElement | null {
    const displayedEvents = buildDisplayedTraceEvents(segment.events as FeedTimelineRecord[]);
    if (!displayedEvents.length) return null;

    const expanded = traceSegmentExpansion.get(segment.id) ?? defaultTraceExpanded;
    const container = document.createElement('section');
    container.className = 'traceSegment';
    container.dataset.segmentId = segment.id;

    const header = document.createElement('div');
    header.className = 'traceSegmentHeader';

    const label = document.createElement('span');
    label.className = 'traceSegmentLabel';
    label.textContent = 'Execution log';

    const count = document.createElement('span');
    count.className = 'traceSegmentCount';
    count.textContent = `${displayedEvents.length} step${displayedEvents.length !== 1 ? 's' : ''}`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'traceSegmentToggle';
    toggle.textContent = expanded ? 'Collapse' : `Show all (${displayedEvents.length})`;
    toggle.style.display = displayedEvents.length > getCollapsedVisibleCount(displayedEvents.length) || expanded ? '' : 'none';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      traceSegmentExpansion.set(segment.id, !expanded);
      renderTranscript();
    });

    header.appendChild(label);
    header.appendChild(count);
    header.appendChild(toggle);
    container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'traceSegmentBody';
    const cards: HTMLDivElement[] = [];
    for (const displayedEvent of displayedEvents) {
      const card = createTraceEntry(displayedEvent);
      traceOrder.push(card);
      cards.push(card);
      body.appendChild(card);
    }
    applyTraceSegmentVisibility(cards, expanded);
    container.appendChild(body);
    return container;
  }

  function renderTranscript(): void {
    transcriptContainer.innerHTML = '';
    traceOrder.length = 0;
    const fragment = document.createDocumentFragment();
    const activeSegmentIds = new Set<string>();
    const segments = buildTranscriptSegments(messages, timelineEvents);
    for (const segment of segments) {
      if (segment.kind === 'message') {
        fragment.appendChild(createMessageEntry(segment.message as FeedMessageRecord));
        continue;
      }
      activeSegmentIds.add(segment.id);
      const node = createTraceSegment(segment);
      if (node) fragment.appendChild(node);
    }
    for (const segmentId of Array.from(traceSegmentExpansion.keys())) {
      if (!activeSegmentIds.has(segmentId)) traceSegmentExpansion.delete(segmentId);
    }
    transcriptContainer.appendChild(fragment);
  }

  function setTranscript(
    nextMessages: Array<{
      id?: string;
      role: 'user' | 'assistant' | 'system';
      text: string;
      blocks?: RoverMessageBlock[];
      ts?: number;
    }>,
    nextTimeline: RoverTimelineEvent[],
  ): void {
    nextSequence = 0;
    messages.length = 0;
    timelineEvents.length = 0;
    traceSegmentExpansion.clear();
    const ordered = mergeTranscriptItems(
      nextMessages.map(message => prepareTranscriptMessage(message)),
      nextTimeline.map(event => prepareTranscriptTimeline(event)),
    );
    for (const item of ordered) {
      if (item.kind === 'message') {
        messages.push(normalizeMessageRecord(item.message, nextSequence++));
      } else {
        timelineEvents.push(normalizeTimelineRecord(item.event, nextSequence++));
      }
    }
    renderTranscript();
  }

  return {
    root: feedWrapper,
    feed,
    scrollBtn,
    typingIndicator,
    traceOrder,
    addMessage(role, text, blocks) {
      const clean = String(text || '');
      if (!clean && (!blocks || blocks.length === 0)) return;
      upsertMessage(normalizeMessageRecord({
        role,
        text: clean,
        blocks,
      }));
      renderTranscript();
      smartScrollToBottom();
    },
    setTranscript,
    addTimelineEvent(event) {
      const title = sanitizeText(event.title || '');
      if (!title) return;
      upsertTimeline(normalizeTimelineRecord({ ...event, title }));
      renderTranscript();
      smartScrollToBottom();
    },
    clearMessages() {
      messages.length = 0;
      renderTranscript();
    },
    clearTimeline() {
      timelineEvents.length = 0;
      traceSegmentExpansion.clear();
      renderTranscript();
    },
    setTraceExpanded(expanded: boolean, maxLiveCards = 2) {
      defaultTraceExpanded = expanded;
      maxVisibleLiveCards = clampLiveCardCount(maxLiveCards);
      traceSegmentExpansion.clear();
      renderTranscript();
    },
    setLiveMode(active: boolean, onExpand?: () => void) {
      liveMode = active;
      onLiveExpand = onExpand ?? null;
      feed.classList.toggle('liveMode', active);
    },
    setThoughtStyle(style) {
      thoughtStyle = style === 'minimal' ? 'minimal' : 'concise_cards';
      feedWrapper.dataset.thoughtStyle = thoughtStyle;
      feed.dataset.thoughtStyle = thoughtStyle;
      renderTranscript();
    },
    setStreamConfig(stream) {
      maxVisibleLiveCards = clampLiveCardCount(stream?.maxVisibleLiveCards);
      collapseCompletedSteps = stream?.collapseCompletedSteps !== false;
      renderTranscript();
    },
    showTyping(show) {
      if (show) {
        typingIndicator.classList.add('visible');
        smartScrollToBottom();
      } else {
        typingIndicator.classList.remove('visible');
      }
    },
    smartScrollToBottom,
    getScrollPosition: () => feed.scrollTop,
    setScrollPosition(position) {
      requestAnimationFrame(() => {
        feed.scrollTop = position;
      });
    },
  };
}
