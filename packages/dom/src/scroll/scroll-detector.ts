// scroll.ts - Main world script for smart scroll detection
// This will be compiled to scroll.iife.js and injected via background script

import { docOf, globalWindowSafe, isHTMLElementLike, isShadowRootLike, winOf, winOfDoc } from '@rover/a11y-tree';
import { getElementSelector, ScrollDirectionEnum, ScrollPositionEnum } from './scroll-helpers.js';

(() => {
  const SCROLL_DETECTOR_ID = '__rtrvr_scroll_detector';
  const SCROLL_API_FALLBACK = '__RTRVR_SCROLL_API__';
  const INTERNAL_KEY_FALLBACK = '__RTRVR_INTERNAL__';

  // Prevent multiple injections
  if ((window as any)[SCROLL_DETECTOR_ID]) {
    return;
  }

  interface ScrollCommand {
    action: 'detectPrimary' | 'scrollTo' | 'scrollBy' | 'getMetrics' | 'scrollElement';
    direction?: ScrollDirectionEnum;
    selector?: string;
    position?: ScrollPositionEnum;
    options?: {
      behavior?: ScrollBehavior;
      amount?: number;
      isTabActive?: boolean;
    };
  }

  type ScrollElementType = 'feed' | 'article' | 'sidebar' | 'chat' | 'modal' | 'document' | 'unknown';

  interface ScrollCandidateFeatures {
    geometry: {
      viewportCoverage: number; // fraction of viewport area
      widthProminence: number; // visible width / viewport width
      centerDistance: number; // normalized distance from vertical center [0..1]
      scrollCapacity: number; // scrollHeight - clientHeight
      scrollSurface: number; // scrollCapacity * visibleWidth
      zIndex: number;
    };
    content: {
      textDensity: number; // chars / element count
      linkDensity: number; // linkChars / textChars
      repetitionScore: number; // list/feed-like signal [0..1]
      semanticScore: number; // [-1..1]
    };
    interaction: {
      hasScrollListeners: boolean;
      hasFocus: boolean;
      recentActivity: number; // [0..1] (for now, mostly focus-based)
    };
  }

  interface ScrollCandidate {
    element: HTMLElement;
    selector: string;
    score: number; // final normalized score [0..1]
    features: ScrollCandidateFeatures;
    type: ScrollElementType;
  }

  interface TextMetrics {
    textChars: number;
    linkChars: number;
    textDensity: number;
    linkDensity: number;
  }

  interface ScrollCheck {
    vertical: boolean;
    horizontal: boolean;
    byOverflow: boolean;
  }

  class SmartScrollDetector {
    private doc: Document;
    private win: Window;
    private viewport: { width: number; height: number };
    private lastDetectedPrimary: HTMLElement | null = null;
    private detectionCache: Map<string, ScrollCandidate> = new Map();
    private lastDetectionTime = 0;
    private readonly CACHE_TTL = 5000; // 5 seconds

    constructor(doc: Document = document, win: Window = window) {
      this.doc = doc;
      this.win = win;
      this.viewport = { width: win.innerWidth, height: win.innerHeight };
      this.updateViewport();
    }

    private getValidPrimary(): HTMLElement | null {
      if (this.lastDetectedPrimary && !this.doc.contains(this.lastDetectedPrimary)) {
        this.lastDetectedPrimary = null;
      }
      return this.lastDetectedPrimary;
    }

    private async handleCommand(command: ScrollCommand): Promise<any> {
      switch (command.action) {
        case 'detectPrimary': {
          const cand = this.detectPrimaryScrollable();
          if (!cand) return null;

          const { target, isRoot } = this.getScrollContext(cand.element);
          const scrollHeight = target.scrollHeight;
          const win = globalWindowSafe();
          const clientHeight = isRoot && win ? win.innerHeight : target.clientHeight;
          const maxScroll = Math.max(0, scrollHeight - clientHeight);
          const scrollTop = target.scrollTop;

          // IMPORTANT: this object contains only JSON-serializable data
          return {
            selector: cand.selector,
            score: cand.score,
            type: cand.type,
            metrics: {
              scrollTop,
              scrollHeight,
              clientHeight,
              isAtTop: scrollTop <= 5,
              isAtBottom: scrollTop >= maxScroll - 5,
            },
          };
        }

        case 'scrollTo':
          if (!command.direction) throw new Error('scrollTo requires direction');
          return this.scrollToDirection(command.direction, command.options);

        case 'scrollBy':
          if (!command.direction) throw new Error('scrollBy requires direction');
          return this.scrollByAmount(command.direction, command.options);

        case 'scrollElement':
          if (!command.selector) {
            throw new Error('scrollElement requires selector');
          }
          return this.scrollElementIntoView(command.selector, command.position, command.options);

        case 'getMetrics':
          return this.getScrollMetrics();

        default:
          throw new Error(`Unknown command: ${command.action}`);
      }
    }

    private updateViewport(): void {
      this.viewport = { width: this.win.innerWidth, height: this.win.innerHeight };
    }

    // ------------ PUBLIC API ------------
    public async execute(command: ScrollCommand): Promise<any> {
      return this.handleCommand(command);
    }

    public detectPrimaryScrollable(): ScrollCandidate | null {
      // Cache check
      if (Date.now() - this.lastDetectionTime < this.CACHE_TTL && this.detectionCache.size > 0) {
        const cached = Array.from(this.detectionCache.values()).sort((a, b) => b.score - a.score)[0];
        if (cached) {
          this.lastDetectedPrimary = cached.element;
          return cached;
        }
      }

      this.updateViewport();
      const candidates = this.collectScrollableCandidates();

      if (candidates.length === 0) {
        // Fallback to document scroll
        const docElement =
          (this.doc.scrollingElement as HTMLElement | null) || this.doc.documentElement || (this.doc.body as any);

        if (!docElement) return null;

        const features = this.buildFeatures(docElement);
        const doc = docOf(docElement, this.doc);
        const fallbackCandidate: ScrollCandidate = {
          element: docElement,
          selector: getElementSelector(docElement, doc),
          score: 0.5,
          features,
          type: 'document',
        };

        this.detectionCache.clear();
        this.detectionCache.set(fallbackCandidate.selector, fallbackCandidate);
        this.lastDetectionTime = Date.now();
        this.lastDetectedPrimary = docElement;
        return fallbackCandidate;
      }

      // Score & sort
      const scored = this.scoreCandidates(candidates);
      if (scored.length === 0) return null;

      this.detectionCache.clear();
      for (const cand of scored) {
        this.detectionCache.set(cand.selector, cand);
      }
      this.lastDetectionTime = Date.now();

      const primary = scored[0];
      if (primary) {
        this.lastDetectedPrimary = primary.element;
      }
      return primary || null;
    }

    private collectAllElementsDeep(root: Document, maxNodes = 150000): HTMLElement[] {
      const out: HTMLElement[] = [];
      const stack: Array<Element | ShadowRoot> = [];
      const body = root.body || root.documentElement;
      if (body) stack.push(body);

      let visited = 0;

      const getAnyShadowRoot = (el: Element): ShadowRoot | null => {
        try {
          const k = (this.win as any).__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
          const i = (this.win as any)[k];
          // added this method on window in listener detection
          const fn = i?.shadow?.getRoot;
          if (typeof fn === 'function') {
            const sr = fn(el);
            if (sr) return sr;
          }
        } catch {}
        try {
          return ((el as any).shadowRoot as ShadowRoot | null) || null;
        } catch {
          return null;
        }
      };

      while (stack.length) {
        if (++visited > maxNodes) break;
        const node = stack.pop()!;
        if (isShadowRootLike(node)) {
          const kids = (node as ShadowRoot).children;
          for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
          continue;
        }

        const el = node as Element;
        const winEl = winOf(el);
        if (isHTMLElementLike(el, winEl)) out.push(el);

        // open + closed shadow (via internal helper)
        try {
          const sr = getAnyShadowRoot(el);
          if (sr) stack.push(sr);
        } catch {}

        for (let c = el.lastElementChild; c; c = c.previousElementSibling) stack.push(c);
      }

      return out;
    }

    // ------------ CANDIDATE COLLECTION & FEATURES ------------
    private collectScrollableCandidates(): HTMLElement[] {
      const candidates: HTMLElement[] = [];
      const processed = new WeakSet<HTMLElement>();

      // Always consider document roots
      const roots: (HTMLElement | null)[] = [
        this.doc.scrollingElement as HTMLElement | null,
        this.doc.documentElement,
        this.doc.body as HTMLElement | null,
      ];
      for (const el of roots) {
        if (!el) continue;
        if (processed.has(el)) continue;
        const scrollCheck = this.isScrollable(el);
        if (scrollCheck.vertical || scrollCheck.horizontal) {
          candidates.push(el);
          processed.add(el);
        }
      }

      // All other elements
      const allElements = this.collectAllElementsDeep(this.doc);
      for (const el of Array.from(allElements)) {
        if (processed.has(el)) continue;

        const rect = el.getBoundingClientRect();
        const style = this.win.getComputedStyle(el);
        if (!this.isElementRendered(el, rect, style)) continue;

        const scrollCheck = this.isScrollable(el);
        if (!scrollCheck.vertical) continue;

        // Filter tiny elements (except special cases)
        const minHeight = 40;
        const minWidth = this.viewport.width * 0.15;
        if (rect.height < minHeight || rect.width < minWidth) {
          const hasScrollName = (el.className || '').toLowerCase().includes('scroll');
          const hasOverflow =
            style.overflowY === 'auto' ||
            style.overflowY === 'scroll' ||
            style.overflow === 'auto' ||
            style.overflow === 'scroll';
          if (!hasScrollName && !hasOverflow) continue;
        }

        candidates.push(el);
        processed.add(el);
      }

      return candidates;
    }

    private isElementRendered(el: HTMLElement, rect: DOMRect, style: CSSStyleDeclaration): boolean {
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      const opacity = parseFloat(style.opacity || '1');
      if (!Number.isNaN(opacity) && opacity < 0.01) return false;

      if (rect.width <= 1 || rect.height <= 1) return false;

      return true;
    }

    private isScrollable(element: HTMLElement): ScrollCheck {
      const style = this.win.getComputedStyle(element);
      const overflowY = style.overflowY;
      const overflowX = style.overflowX;

      const scrollingElement = this.doc.scrollingElement as HTMLElement | null;
      const isRoot =
        element === this.doc.documentElement ||
        element === this.doc.body ||
        (!!scrollingElement && element === scrollingElement);

      let scrollHeight = element.scrollHeight;
      let clientHeight = element.clientHeight;
      let scrollWidth = element.scrollWidth;
      let clientWidth = element.clientWidth;

      if (isRoot) {
        // Use document metrics
        const docEl = this.doc.documentElement;
        const body = this.doc.body;
        const docScrollHeight = Math.max(docEl ? docEl.scrollHeight : 0, body ? body.scrollHeight : 0);
        scrollHeight = docScrollHeight;
        clientHeight = this.win.innerHeight;
      }

      const hasVerticalOverflow = scrollHeight - clientHeight > 8;
      const hasHorizontalOverflow = scrollWidth - clientWidth > 8;

      const overflowYScrollable = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      const overflowXScrollable = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';

      const canScrollY = isRoot ? hasVerticalOverflow : hasVerticalOverflow && overflowYScrollable;
      const canScrollX = isRoot ? hasHorizontalOverflow : hasHorizontalOverflow && overflowXScrollable;

      const byOverflow = overflowYScrollable || overflowXScrollable;

      return {
        vertical: canScrollY,
        horizontal: canScrollX,
        byOverflow,
      };
    }

    private calculateVisibleIntersection(rect: DOMRect): { width: number; height: number; area: number } {
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(this.viewport.width, rect.right);
      const bottom = Math.min(this.viewport.height, rect.bottom);

      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      return { width, height, area: width * height };
    }

    private analyzeTextContent(root: HTMLElement, maxNodes = 2000): TextMetrics {
      let textChars = 0;
      let linkChars = 0;

      const doc = root.ownerDocument || this.doc;
      const w = (doc.defaultView || this.win) as any;
      const NF = w.NodeFilter || NodeFilter;
      const walker = doc.createTreeWalker(root, NF.SHOW_ELEMENT | NF.SHOW_TEXT, null);

      let nodesVisited = 0;
      let node: Node | null = walker.currentNode;

      const elements: HTMLElement[] = [];

      while (node && nodesVisited < maxNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = (node.textContent || '').replace(/\s+/g, '');
          const len = text.length;
          if (len > 0) {
            textChars += len;
            const parent = node.parentElement;
            if (parent && parent.closest('a')) {
              linkChars += len;
            }
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          elements.push(node as HTMLElement);
        }

        nodesVisited++;
        node = walker.nextNode();
      }

      const elementCount = elements.length || 1;
      const textDensity = textChars / elementCount;
      const linkDensity = textChars > 0 ? linkChars / textChars : 0;

      return { textChars, linkChars, textDensity, linkDensity };
    }

    private calculateRepetitionScore(root: HTMLElement): number {
      const children = Array.from(root.children) as HTMLElement[];
      if (children.length < 3) return 0;

      const sample = children.slice(0, 50);
      const heightBuckets = new Map<number, number>();
      const widthBuckets = new Map<number, number>();
      const classMap = new Map<string, number>();

      for (const child of sample) {
        const winEl = winOf(child);
        if (!isHTMLElementLike(child, winEl)) continue;
        const rect = child.getBoundingClientRect();
        if (rect.height < 5 || rect.width < this.viewport.width * 0.1) continue;

        const hBucket = Math.round(rect.height / 10) * 10;
        const wBucket = Math.round(rect.width / 10) * 10;
        heightBuckets.set(hBucket, (heightBuckets.get(hBucket) || 0) + 1);
        widthBuckets.set(wBucket, (widthBuckets.get(wBucket) || 0) + 1);

        const classKey = (child.className || child.tagName).toString();
        classMap.set(classKey, (classMap.get(classKey) || 0) + 1);
      }

      const total = sample.length || 1;

      const maxHeightFreq = Math.max(0, ...heightBuckets.values());
      const maxWidthFreq = Math.max(0, ...widthBuckets.values());
      const maxClassFreq = Math.max(0, ...classMap.values());

      const heightScore = maxHeightFreq / total;
      const widthScore = maxWidthFreq / total;
      const classScore = maxClassFreq / total;

      const repetition = 0.4 * heightScore + 0.3 * widthScore + 0.3 * classScore;
      return Math.min(1, Math.max(0, repetition));
    }

    private calculateSemanticScore(el: HTMLElement): {
      semanticScore: number;
      typeHint: ScrollElementType | null;
      navLike: boolean;
    } {
      let score = 0;
      let typeHint: ScrollElementType | null = null;
      let navLike = false;

      const role = (el.getAttribute('role') || '').toLowerCase();
      const tag = el.tagName.toLowerCase();
      const id = (el.id || '').toLowerCase();
      const className = (el.className || '').toLowerCase();
      const tokens = `${role} ${tag} ${id} ${className}`;

      // Positive
      if (tag === 'main' || role === 'main') {
        score += 1.2;
        typeHint = 'article';
      }
      if (tag === 'article') {
        score += 1.0;
        typeHint = typeHint || 'article';
      }
      if (role === 'feed' || tokens.includes('feed')) {
        score += 1.0;
        typeHint = 'feed';
      }
      if (role === 'log' || tokens.includes('chat') || tokens.includes('messages')) {
        score += 1.0;
        typeHint = 'chat';
      }
      if (tokens.includes('content')) {
        score += 0.5;
      }
      if (tokens.includes('results') || tokens.includes('list')) {
        score += 0.4;
      }

      // NEW: jobs / job list
      if (tokens.includes('job') || tokens.includes('jobs')) {
        score += 0.4; // mild bump, mostly helps the left pane
      }

      // Negative / nav-like
      if (tag === 'nav' || role === 'navigation' || tokens.includes('sidebar')) {
        score -= 1.0;
        navLike = true;
      }
      if (tag === 'aside' || role === 'complementary') {
        score -= 0.7;
        navLike = true;
      }
      if (tag === 'footer' || role === 'contentinfo' || tokens.includes('footer')) {
        score -= 0.8;
        navLike = true;
      }
      if (tokens.includes('header')) {
        score -= 0.6;
      }

      // Clamp
      score = Math.max(-1, Math.min(1, score));
      return { semanticScore: score, typeHint, navLike };
    }

    private detectScrollListeners(element: HTMLElement): boolean {
      // Heuristic for infinite scroll patterns / scroll-aware content
      const indicators = [
        element.querySelector('[class*="infinite"]'),
        element.querySelector('[class*="load-more"]'),
        element.querySelector('[data-infinite]'),
        element.querySelector('[loading="lazy"]'),
        element.querySelector('.observer-target'),
        element.querySelector('[data-scroll]'),
      ];

      return indicators.some(el => el !== null);
    }

    private buildFeatures(element: HTMLElement): ScrollCandidateFeatures {
      const rect = element.getBoundingClientRect();
      const style = this.win.getComputedStyle(element);

      const intersection = this.calculateVisibleIntersection(rect);
      const viewportArea = this.viewport.width * this.viewport.height || 1;

      const viewportCoverage = intersection.area / viewportArea;
      const widthProminence = this.viewport.width > 0 ? intersection.width / this.viewport.width : 0;

      const centerY = rect.top + rect.height / 2;
      const viewportCenterY = this.viewport.height / 2 || 1;
      const centerDistance = Math.min(1, Math.abs(centerY - viewportCenterY) / viewportCenterY);

      // Scroll capacity & surface
      const scrollCheck = this.isScrollable(element);
      const scrollingElement = this.doc.scrollingElement as HTMLElement | null;
      const isRoot =
        element === this.doc.documentElement ||
        element === this.doc.body ||
        (!!scrollingElement && element === scrollingElement);

      let scrollHeight = element.scrollHeight;
      let clientHeight = element.clientHeight;
      if (isRoot) {
        const docEl = this.doc.documentElement;
        const body = this.doc.body;
        scrollHeight = Math.max(docEl ? docEl.scrollHeight : 0, body ? body.scrollHeight : 0);
        clientHeight = this.win.innerHeight;
      }

      const scrollCapacity = Math.max(0, scrollHeight - clientHeight);
      const scrollSurface = scrollCapacity * intersection.width;

      const textMetrics = this.analyzeTextContent(element);
      const repetitionScore = this.calculateRepetitionScore(element);
      const semanticInfo = this.calculateSemanticScore(element);

      const hasFocus = element.contains(this.doc.activeElement);
      const hasScrollListeners = this.detectScrollListeners(element);

      const zIndex = parseInt(style.zIndex || '0', 10);
      const safeZIndex = Number.isFinite(zIndex) ? zIndex : 0;

      return {
        geometry: {
          viewportCoverage,
          widthProminence,
          centerDistance,
          scrollCapacity,
          scrollSurface,
          zIndex: safeZIndex,
        },
        content: {
          textDensity: textMetrics.textDensity,
          linkDensity: textMetrics.linkDensity,
          repetitionScore,
          semanticScore: semanticInfo.semanticScore,
        },
        interaction: {
          hasScrollListeners,
          hasFocus,
          recentActivity: hasFocus ? 1 : 0,
        },
      };
    }

    private inferElementType(
      element: HTMLElement,
      features: ScrollCandidateFeatures,
      typeHint: ScrollElementType | null,
      navLike: boolean,
    ): ScrollElementType {
      if (typeHint) return typeHint;

      const role = (element.getAttribute('role') || '').toLowerCase();
      const className = (element.className || '').toLowerCase();
      const tag = element.tagName.toLowerCase();
      const geom = features.geometry;
      const content = features.content;

      // Chat
      if (role === 'log' || className.includes('chat') || className.includes('messages')) {
        return 'chat';
      }

      // Modal
      const style = this.win.getComputedStyle(element);
      const isModalLike =
        (style.position === 'fixed' || style.position === 'absolute') &&
        geom.zIndex > 100 &&
        geom.viewportCoverage > 0.2 &&
        geom.centerDistance < 0.4;

      if (isModalLike) {
        return 'modal';
      }

      // FEED detection (updated threshold)
      if (
        role === 'feed' ||
        (content.repetitionScore > 0.3 && // lower threshold from 0.6
          geom.scrollCapacity > 400 && // enough to feel like a list
          geom.widthProminence >= 0.25) // avoid tiny skinny navs
      ) {
        return 'feed';
      }

      // Article-style
      if (tag === 'article' || (content.textDensity > 40 && content.linkDensity < 0.4 && geom.widthProminence > 0.4)) {
        return 'article';
      }

      // Sidebar
      if (navLike || (geom.widthProminence < 0.3 && content.linkDensity > 0.3)) {
        return 'sidebar';
      }

      const scrollingElement = this.doc.scrollingElement as HTMLElement | null;
      if (
        element === this.doc.documentElement ||
        element === this.doc.body ||
        (!!scrollingElement && element === scrollingElement)
      ) {
        return 'document';
      }

      return 'unknown';
    }

    private scoreCandidates(elements: HTMLElement[]): ScrollCandidate[] {
      const candidates: ScrollCandidate[] = [];
      const scrollSurfaces: number[] = [];
      const textDensities: number[] = [];
      const semanticAbs: number[] = [];
      const repetitionScores: number[] = [];

      const temp: {
        element: HTMLElement;
        features: ScrollCandidateFeatures;
        type: ScrollElementType;
        navLike: boolean;
        semanticScore: number;
      }[] = [];

      for (const el of elements) {
        const features = this.buildFeatures(el);
        const semanticScore = features.content.semanticScore;
        const semanticInfo = this.calculateSemanticScore(el);

        const type = this.inferElementType(el, features, semanticInfo.typeHint, semanticInfo.navLike);

        temp.push({
          element: el,
          features: {
            geometry: {
              ...features.geometry,
            },
            content: {
              ...features.content,
              semanticScore: semanticInfo.semanticScore,
            },
            interaction: features.interaction,
          },
          type,
          navLike: semanticInfo.navLike,
          semanticScore: semanticInfo.semanticScore,
        });

        scrollSurfaces.push(features.geometry.scrollSurface);
        textDensities.push(features.content.textDensity);
        semanticAbs.push(Math.abs(semanticInfo.semanticScore));
        repetitionScores.push(features.content.repetitionScore);
      }

      const maxScrollSurface = Math.max(0, ...scrollSurfaces);
      const maxTextDensity = Math.max(0, ...textDensities);
      const maxSemanticAbs = Math.max(0, ...semanticAbs);
      const maxRepetition = Math.max(0, ...repetitionScores);

      let bestScore = -Infinity;

      for (const item of temp) {
        const { element, features, type, navLike, semanticScore } = item;
        const g = features.geometry;
        const c = features.content;
        const i = features.interaction;

        const normScrollSurface = maxScrollSurface > 0 ? g.scrollSurface / maxScrollSurface : 0;
        const normTextDensity = maxTextDensity > 0 ? c.textDensity / maxTextDensity : 0;
        const normSemantic = maxSemanticAbs > 0 ? (semanticScore / maxSemanticAbs + 1) / 2 : 0.5;

        const isFeedLike = type === 'feed' || (c.repetitionScore > 0.3 && g.scrollCapacity > 400);

        // Only penalize high link density if it's NOT a feed-like region
        const rawLinkPenalty = c.linkDensity > 0.5 ? (c.linkDensity - 0.5) / 0.5 : 0;
        const linkPenalty = isFeedLike ? 0 : rawLinkPenalty;

        // Stronger "feed strength": repeated items + long scroll
        const feedStrength = (isFeedLike ? 1 : 0.5) * c.repetitionScore * Math.min(1, g.scrollCapacity / 4000);

        const typeBonusMap: Record<ScrollElementType, number> = {
          feed: 0.2, // slightly higher than before
          chat: 0.2,
          article: 0.08,
          modal: 0.08,
          document: 0.05,
          sidebar: -0.12,
          unknown: 0,
        };
        const typeBonus = typeBonusMap[type] || 0;

        let score = 0;

        // Geometry – still important but width a bit less dominant
        score += g.viewportCoverage * 0.18;
        score += g.widthProminence * 0.15;
        score += (1 - g.centerDistance) * 0.07;
        score += normScrollSurface * 0.22;

        // Feed / structure term – this is what will make the jobs list win
        score += feedStrength * 0.18;

        // Content
        score += normTextDensity * 0.08;
        score += (maxRepetition > 0 ? c.repetitionScore / maxRepetition : 0) * 0.05;
        score += normSemantic * 0.07;
        score -= linkPenalty * 0.05;

        // Interaction
        if (i.hasFocus) score += 0.05;
        if (i.hasScrollListeners) score += 0.05;

        // Type + nav penalty
        score += typeBonus;
        if (navLike) score -= 0.05;

        const clampedScore = Math.max(0, Math.min(1, score));

        if (clampedScore > bestScore) {
          bestScore = clampedScore;
        }

        candidates.push({
          element,
          selector: getElementSelector(element, docOf(element)),
          score: clampedScore,
          features,
          type,
        });
      }

      // Sort high to low
      candidates.sort((a, b) => b.score - a.score);

      // Optional LinkedIn-style tie-break:
      if (candidates.length >= 2) {
        const first = candidates[0];
        const second = candidates[1];

        const close = Math.abs(first.score - second.score) < 0.08;
        if (close) {
          // If one is a feed and the other is an article, prefer the feed
          if (first.type === 'article' && second.type === 'feed') {
            candidates[0] = second;
            candidates[1] = first;
          }
        }
      }

      return candidates;
    }

    // ------------ SCROLLING (ACTIVE + BACKGROUND SAFE) ------------

    private getScrollContext(element: HTMLElement): { target: HTMLElement; isRoot: boolean } {
      const scrollingElement = document.scrollingElement as HTMLElement | null;
      const isDocRoot =
        element === document.documentElement ||
        element === document.body ||
        (!!scrollingElement && element === scrollingElement);

      if (isDocRoot) {
        const root = scrollingElement || (document.documentElement as HTMLElement) || document.body;
        return { target: root, isRoot: true };
      }

      return { target: element, isRoot: false };
    }

    private async scrollToDirection(
      direction: string,
      options?: { behavior?: ScrollBehavior; isTabActive?: boolean },
    ): Promise<any> {
      const primaryElement = this.getValidPrimary() || this.detectPrimaryScrollable()?.element;
      if (!primaryElement) {
        return { success: false, error: 'No scrollable element found' };
      }
      const { target, isRoot } = this.getScrollContext(primaryElement);
      const doc = docOf(target);
      const win = winOfDoc(doc);
      const isTabActive = options?.isTabActive ?? !doc.hidden;
      const requestedBehavior = options?.behavior;
      const useSmooth = isTabActive && requestedBehavior === 'smooth';

      const scrollHeight = isRoot
        ? Math.max(doc.documentElement ? doc.documentElement.scrollHeight : 0, doc.body ? doc.body.scrollHeight : 0)
        : target.scrollHeight;
      const clientHeight = isRoot ? win.innerHeight : target.clientHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      const scrollTop = () => (isRoot ? win.scrollY : target.scrollTop);

      const applyScrollTop = (top: number) => {
        if (useSmooth) {
          try {
            if (isRoot) {
              win.scrollTo({ top, behavior: 'smooth' });
            } else {
              target.scrollTo({ top, behavior: 'smooth' });
            }
          } catch {
            if (isRoot) {
              ((doc.scrollingElement as HTMLElement | null) || doc.documentElement || doc.body).scrollTop = top;
            } else {
              target.scrollTop = top;
            }
          }
        } else {
          // Background-tab-safe: direct assignment
          if (isRoot) {
            const scroller =
              (doc.scrollingElement as HTMLElement | null) ||
              (doc.documentElement as HTMLElement) ||
              (doc.body as HTMLElement);
            scroller.scrollTop = top;
          } else {
            target.scrollTop = top;
          }
        }
      };

      switch (direction) {
        case ScrollDirectionEnum.TOP: {
          applyScrollTop(0);
          return { success: true, scrollTop: 0, isAtTop: true };
        }
        case ScrollDirectionEnum.BOTTOM: {
          applyScrollTop(maxScroll);
          return { success: true, scrollTop: maxScroll, isAtBottom: true };
        }
        default:
          return { success: false, error: `Unknown direction: ${direction}` };
      }
    }

    private async scrollByAmount(
      direction: string,
      options?: { amount?: number; behavior?: ScrollBehavior; isTabActive?: boolean },
    ): Promise<any> {
      const primaryElement = this.getValidPrimary() || this.detectPrimaryScrollable()?.element;
      if (!primaryElement) {
        return { success: false, error: 'No scrollable element found' };
      }
      const { target, isRoot } = this.getScrollContext(primaryElement);
      const isTabActive = options?.isTabActive ?? !document.hidden;
      const requestedBehavior = options?.behavior;
      const useSmooth = isTabActive && requestedBehavior === 'smooth';

      const win = globalWindowSafe();
      const viewportHeight = isRoot && win ? win.innerHeight : target.clientHeight;
      const viewportWidth = isRoot && win ? win.innerWidth : target.clientWidth;
      const amount = options?.amount ?? viewportHeight * 0.8;

      const scrollHeight = isRoot
        ? Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0,
          )
        : target.scrollHeight;
      const clientHeight = isRoot && win ? win.innerHeight : target.clientHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      const applyVertical = (newTop: number) => {
        if (useSmooth) {
          try {
            if (isRoot) {
              win?.scrollTo({ top: newTop, behavior: 'smooth' });
            } else {
              target.scrollTo({ top: newTop, behavior: 'smooth' });
            }
          } catch {
            const scroller =
              (document.scrollingElement as HTMLElement | null) ||
              (document.documentElement as HTMLElement) ||
              (document.body as HTMLElement);
            scroller.scrollTop = newTop;
          }
        } else {
          const scroller = isRoot
            ? (document.scrollingElement as HTMLElement | null) ||
              (document.documentElement as HTMLElement) ||
              (document.body as HTMLElement)
            : target;
          scroller.scrollTop = newTop;
        }
      };

      const applyHorizontal = (deltaLeft: number) => {
        if (useSmooth) {
          try {
            target.scrollBy({ left: deltaLeft, behavior: 'smooth' });
          } catch {
            target.scrollLeft += deltaLeft;
          }
        } else {
          target.scrollLeft += deltaLeft;
        }
      };

      switch (direction) {
        case ScrollDirectionEnum.DOWN: {
          const current = isRoot && win ? win.scrollY : target.scrollTop;
          const newTop = current + amount;
          applyVertical(newTop);
          const finalTop = isRoot && win ? win.scrollY : target.scrollTop;
          return {
            success: true,
            scrollTop: finalTop,
            isAtTop: finalTop <= 5,
            isAtBottom: finalTop >= maxScroll - 5,
          };
        }
        case ScrollDirectionEnum.UP: {
          const current = isRoot && win ? win.scrollY : target.scrollTop;
          const newTop = Math.max(0, current - amount);
          applyVertical(newTop);
          const finalTop = isRoot && win ? win.scrollY : target.scrollTop;
          return {
            success: true,
            scrollTop: finalTop,
            isAtTop: finalTop <= 5,
            isAtBottom: finalTop >= maxScroll - 5,
          };
        }
        case ScrollDirectionEnum.LEFT: {
          const delta = -(options?.amount ?? viewportWidth * 0.8);
          applyHorizontal(delta);
          return {
            success: true,
            scrollLeft: target.scrollLeft,
          };
        }
        case ScrollDirectionEnum.RIGHT: {
          const delta = options?.amount ?? viewportWidth * 0.8;
          applyHorizontal(delta);
          return {
            success: true,
            scrollLeft: target.scrollLeft,
          };
        }
        default:
          return { success: false, error: `Unknown direction: ${direction}` };
      }
    }

    private normalizeScrollPosition(position?: ScrollPositionEnum): ScrollLogicalPosition {
      switch (position) {
        case ScrollPositionEnum.START:
          return 'start';
        case ScrollPositionEnum.END:
          return 'end';
        case ScrollPositionEnum.NEAREST:
          return 'nearest';
        case ScrollPositionEnum.CENTER:
        default:
          return 'center';
      }
    }

    private getScrollContainerForElement(element: HTMLElement): { container: HTMLElement; isRoot: boolean } {
      const scrollingElement = document.scrollingElement as HTMLElement | null;

      let current: HTMLElement | null = element;
      while (current && current !== document.body && current !== document.documentElement) {
        const style = getComputedStyle(current);
        const overflowY = style.overflowY;
        const hasOverflow = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        const hasVertical = current.scrollHeight - current.clientHeight > 8;

        if (hasOverflow && hasVertical) {
          return { container: current, isRoot: false };
        }

        current = current.parentElement;
      }

      const root = scrollingElement || (document.documentElement as HTMLElement) || (document.body as HTMLElement);

      return { container: root, isRoot: true };
    }

    private scrollElementIntoView(
      selector: string,
      position?: ScrollPositionEnum,
      options?: { behavior?: ScrollBehavior; isTabActive?: boolean },
    ): any {
      const element = document.querySelector(selector) as HTMLElement | null;
      if (!element) {
        return { success: false, error: `Element not found for selector: ${selector}` };
      }

      const { container, isRoot } = this.getScrollContainerForElement(element);
      const win = winOf(container);
      const WinDOMRect = (win as any)?.DOMRect || DOMRect;
      const containerRect = isRoot
        ? new WinDOMRect(0, 0, win.innerWidth ?? 0, win.innerHeight ?? 0)
        : container.getBoundingClientRect();

      const elementRect = element.getBoundingClientRect();
      const padding = 24;

      const isVisible =
        elementRect.top >= containerRect.top + padding && elementRect.bottom <= containerRect.bottom - padding;

      const isTabActive = options?.isTabActive ?? !document.hidden;
      const requestedBehavior = options?.behavior;
      const useSmooth = isTabActive && requestedBehavior === 'smooth';

      const block = this.normalizeScrollPosition(position);

      // For NEAREST + already visible, skip extra movement
      if (position === ScrollPositionEnum.NEAREST && isVisible) {
        const metrics = this.getScrollMetricsForContainer(container, isRoot);
        return {
          success: true,
          alreadyVisible: true,
          ...metrics,
        };
      }

      try {
        element.scrollIntoView({
          behavior: useSmooth ? 'smooth' : 'auto',
          block,
          inline: 'nearest',
        });
      } catch {
        // Fallback to default behaviour if scrollIntoView options are not supported
        element.scrollIntoView();
      }

      const metrics = this.getScrollMetricsForContainer(container, isRoot);

      return {
        success: true,
        position: block,
        ...metrics,
      };
    }

    private getScrollMetricsForContainer(target: HTMLElement, isRoot: boolean) {
      const scrollHeight = isRoot
        ? Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0,
          )
        : target.scrollHeight;

      const doc = docOf(target);
      const win = winOf(target);
      const clientHeight = isRoot && win ? win.innerHeight : target.clientHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      const scroller = isRoot
        ? (doc.scrollingElement as HTMLElement | null) ||
          (doc.documentElement as HTMLElement) ||
          (doc.body as HTMLElement)
        : target;

      const scrollTop = scroller.scrollTop;

      return {
        scrollTop,
        scrollHeight,
        clientHeight,
        maxScroll,
        isAtTop: scrollTop <= 5,
        isAtBottom: scrollTop >= maxScroll - 5,
        scrollPercentage: maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0,
      };
    }

    private getScrollMetrics(): any {
      const primaryElement = this.getValidPrimary() || this.detectPrimaryScrollable()?.element;
      if (!primaryElement) {
        return null;
      }

      const { target, isRoot } = this.getScrollContext(primaryElement);
      const doc = docOf(target);
      const win = winOfDoc(doc);

      const scrollHeight = isRoot
        ? Math.max(doc.documentElement ? doc.documentElement.scrollHeight : 0, doc.body ? doc.body.scrollHeight : 0)
        : target.scrollHeight;
      const clientHeight = isRoot ? win.innerHeight : target.clientHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      const scroller = isRoot
        ? (doc.scrollingElement as HTMLElement | null) ||
          (doc.documentElement as HTMLElement) ||
          (doc.body as HTMLElement)
        : target;
      const scrollTop = scroller.scrollTop;

      return {
        element: getElementSelector(target, doc),
        scrollTop,
        scrollHeight,
        clientHeight,
        maxScroll,
        isAtTop: scrollTop <= 5,
        isAtBottom: scrollTop >= maxScroll - 5,
        scrollPercentage: maxScroll > 0 ? (scrollTop / maxScroll) * 100 : 0,
      };
    }
  }

  // Initialize detector and expose to window
  const detector = new SmartScrollDetector();
  (window as any)[SCROLL_DETECTOR_ID] = detector;

  // Stable fallback API (works even if internal is frozen)
  const api = { execute: (cmd: any) => detector.execute(cmd) };
  try {
    Object.defineProperty(window, SCROLL_API_FALLBACK, {
      value: api,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {
    try {
      (window as any)[SCROLL_API_FALLBACK] = api;
    } catch {}
  }

  // Attach to internal namespace if possible (best-effort)
  const INTERNAL_KEY = (window as any).__RTRVR_INTERNAL_KEY__ || INTERNAL_KEY_FALLBACK;
  const existing = (window as any)[INTERNAL_KEY];
  const internal = existing && typeof existing === 'object' ? existing : null;
  if (internal) {
    try {
      // Prefer simple assignment if extensible
      (internal as any).scroll = (internal as any).scroll || api;
    } catch {}
    try {
      // If assignment didn’t work, attempt defineProperty
      if (!(internal as any).scroll) {
        Object.defineProperty(internal, 'scroll', {
          value: api,
          writable: false,
          configurable: false,
          enumerable: false,
        });
      }
    } catch {}
  }

  // Back-compat alias: if true key != '__RTRVR_INTERNAL__', try to expose alias for older callers/snippets.
  if (INTERNAL_KEY !== INTERNAL_KEY_FALLBACK) {
    try {
      if (!(window as any)[INTERNAL_KEY_FALLBACK] && internal) {
        Object.defineProperty(window, INTERNAL_KEY_FALLBACK, {
          value: internal,
          writable: false,
          configurable: false,
          enumerable: false,
        });
      }
    } catch {}
  }
})();
