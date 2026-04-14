/**
 * SVG overlay drawing curved bezier paths from panel edge to target page elements.
 * Max 3 concurrent filaments; oldest force-faded if exceeded.
 * Disabled on mobile (≤640px).
 */

export type FilamentSystemOptions = {
  /** Wrapper element to append SVG overlay to */
  container: HTMLElement;
  /** Panel element for edge calculations */
  panel: HTMLElement;
  /** Callback to resolve element by ID from the main document */
  resolveElement?: (elementId: number) => Element | null;
  /** Mobile breakpoint (disable filaments on mobile) */
  mobileBreakpoint?: number;
};

type ActiveFilament = {
  elementId: number;
  toolName?: string;
  path: SVGPathElement;
  fadeTimer?: ReturnType<typeof setTimeout>;
};

export type FilamentSystem = {
  overlay: SVGSVGElement;
  addTarget: (elementId: number, toolName?: string) => void;
  fadeTarget: (elementId: number) => void;
  clearAll: () => void;
  resize: () => void;
  destroy: () => void;
};

const MAX_FILAMENTS = 3;
const FADE_DURATION_MS = 400;

export function createFilamentSystem(opts: FilamentSystemOptions): FilamentSystem {
  const { container, panel, mobileBreakpoint = 640 } = opts;
  let destroyed = false;
  let rafId: number | null = null;
  const active: ActiveFilament[] = [];

  // SVG overlay
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('filament-overlay');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645;';
  container.appendChild(svg);

  function isMobile(): boolean {
    return window.innerWidth <= mobileBreakpoint;
  }

  function createPath(): SVGPathElement {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'var(--rv-accent, #ff4c00)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-dasharray', '6 4');
    path.setAttribute('stroke-opacity', '0.6');
    return path;
  }

  function computeBezier(panelRect: DOMRect, targetRect: DOMRect): string {
    // Start from nearest panel edge center
    const panelCx = panelRect.left + panelRect.width / 2;
    const panelCy = panelRect.top + panelRect.height / 2;
    const targetCx = targetRect.left + targetRect.width / 2;
    const targetCy = targetRect.top + targetRect.height / 2;

    // Determine nearest panel edge point
    let sx: number, sy: number;
    const dx = targetCx - panelCx;
    const dy = targetCy - panelCy;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Left or right edge
      sx = dx > 0 ? panelRect.right : panelRect.left;
      sy = Math.max(panelRect.top + 20, Math.min(panelRect.bottom - 20, targetCy));
    } else {
      // Top or bottom edge
      sy = dy > 0 ? panelRect.bottom : panelRect.top;
      sx = Math.max(panelRect.left + 20, Math.min(panelRect.right - 20, targetCx));
    }

    const ex = targetCx;
    const ey = targetCy;

    // Control points for a smooth curve
    const midX = (sx + ex) / 2;
    const midY = (sy + ey) / 2;
    const cpOffset = Math.max(40, Math.hypot(ex - sx, ey - sy) * 0.3);
    const cp1x = sx + (midX - sx) * 0.5;
    const cp1y = sy + (sy === panelRect.top || sy === panelRect.bottom ? -Math.sign(dy) * cpOffset : 0);
    const cp2x = ex - (ex - midX) * 0.5;
    const cp2y = ey + (ey > sy ? -cpOffset * 0.5 : cpOffset * 0.5);

    return `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${ex} ${ey}`;
  }

  function updatePaths(): void {
    if (destroyed || isMobile() || active.length === 0) {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      return;
    }

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) {
      rafId = requestAnimationFrame(updatePaths);
      return;
    }

    for (const filament of active) {
      const el = opts.resolveElement?.(filament.elementId);
      if (!el) continue;
      const targetRect = el.getBoundingClientRect();
      if (targetRect.width === 0 && targetRect.height === 0) continue;
      const d = computeBezier(panelRect, targetRect);
      filament.path.setAttribute('d', d);
    }

    rafId = requestAnimationFrame(updatePaths);
  }

  function startLoop(): void {
    if (rafId != null || destroyed) return;
    rafId = requestAnimationFrame(updatePaths);
  }

  function stopLoop(): void {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function removePath(filament: ActiveFilament): void {
    if (filament.fadeTimer) clearTimeout(filament.fadeTimer);
    filament.path.remove();
    const idx = active.indexOf(filament);
    if (idx >= 0) active.splice(idx, 1);
    if (active.length === 0) stopLoop();
  }

  function fadeAndRemove(filament: ActiveFilament): void {
    // Use Web Animations API for fade
    try {
      const anim = filament.path.animate(
        [{ strokeOpacity: '0.6' }, { strokeOpacity: '0' }],
        { duration: FADE_DURATION_MS, fill: 'forwards' },
      );
      anim.onfinish = () => removePath(filament);
    } catch {
      removePath(filament);
    }
  }

  function addTarget(elementId: number, toolName?: string): void {
    if (destroyed || isMobile()) return;

    // Check if already tracking this element
    const existing = active.find(f => f.elementId === elementId);
    if (existing) return;

    // Evict oldest if at max
    while (active.length >= MAX_FILAMENTS) {
      fadeAndRemove(active[0]);
    }

    const path = createPath();
    svg.appendChild(path);
    const filament: ActiveFilament = { elementId, toolName, path };
    active.push(filament);
    startLoop();
  }

  function fadeTarget(elementId: number): void {
    const filament = active.find(f => f.elementId === elementId);
    if (filament) fadeAndRemove(filament);
  }

  function clearAll(): void {
    while (active.length > 0) {
      removePath(active[0]);
    }
    stopLoop();
  }

  function resize(): void {
    // SVG is fixed/viewport-based, no explicit resize needed
  }

  function destroy(): void {
    destroyed = true;
    clearAll();
    svg.remove();
  }

  return {
    overlay: svg,
    addTarget,
    fadeTarget,
    clearAll,
    resize,
    destroy,
  };
}
