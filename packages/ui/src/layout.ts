import type {
  RoverViewportMetrics,
  RoverPanelLayout,
  RoverPanelOrientation,
  RoverPanelLayoutKey,
  RoverDesktopPanelState,
  RoverSheetPreset,
} from './types.js';
import {
  ROVER_WIDGET_MOBILE_BREAKPOINT_PX,
  PANEL_DESKTOP_MIN_WIDTH,
  PANEL_DESKTOP_MIN_HEIGHT,
  PANEL_DESKTOP_MAX_WIDTH,
  PANEL_DESKTOP_DEFAULT_WIDTH,
  PANEL_DESKTOP_DEFAULT_HEIGHT,
  PANEL_DESKTOP_MARGIN,
  PANEL_PHONE_SNAP_RATIOS,
  PANEL_TABLET_SNAP_RATIOS,
  PANEL_PHONE_MIN_HEIGHT,
  PANEL_TABLET_MIN_HEIGHT,
  PANEL_PHONE_BOTTOM_OFFSET,
  PANEL_TABLET_BOTTOM_OFFSET,
  PANEL_PHONE_TOP_OFFSET,
  PANEL_TABLET_TOP_OFFSET,
} from './config.js';

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getViewportMetrics(): RoverViewportMetrics {
  const docEl = document.documentElement;
  const vv = window.visualViewport;
  const width = Math.max(320, Math.round(vv?.width ?? window.innerWidth ?? docEl.clientWidth ?? 0));
  const height = Math.max(320, Math.round(vv?.height ?? window.innerHeight ?? docEl.clientHeight ?? 0));
  const orientation: RoverPanelOrientation = width >= height ? 'landscape' : 'portrait';
  const layout: RoverPanelLayout = width <= 640 ? 'phone' : width <= 1023 ? 'tablet' : 'desktop';
  const storageKey: RoverPanelLayoutKey = layout === 'desktop' ? 'desktop' : `${layout}-${orientation}`;
  const keyboardInset = vv
    ? Math.max(0, Math.round((window.innerHeight || height) - (vv.height + vv.offsetTop)))
    : 0;
  return {
    width,
    height,
    layout,
    orientation,
    storageKey,
    keyboardInset,
  };
}

export function clampDesktopPanelState(input: RoverDesktopPanelState, metrics: RoverViewportMetrics): RoverDesktopPanelState {
  const maxWidth = Math.max(PANEL_DESKTOP_MIN_WIDTH, Math.min(PANEL_DESKTOP_MAX_WIDTH, metrics.width - PANEL_DESKTOP_MARGIN));
  const maxHeight = Math.max(PANEL_DESKTOP_MIN_HEIGHT, metrics.height - PANEL_DESKTOP_MARGIN);
  return {
    width: clampNumber(Math.round(input.width), PANEL_DESKTOP_MIN_WIDTH, maxWidth),
    height: clampNumber(Math.round(input.height), PANEL_DESKTOP_MIN_HEIGHT, maxHeight),
  };
}

export function getDefaultDesktopPanelState(metrics: RoverViewportMetrics): RoverDesktopPanelState {
  return clampDesktopPanelState({
    width: PANEL_DESKTOP_DEFAULT_WIDTH,
    height: PANEL_DESKTOP_DEFAULT_HEIGHT,
  }, metrics);
}

export function normalizeStoredDesktopPanelState(input: unknown, metrics: RoverViewportMetrics): RoverDesktopPanelState | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const width = Number((input as RoverDesktopPanelState).width);
  const height = Number((input as RoverDesktopPanelState).height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  return clampDesktopPanelState({ width, height }, metrics);
}

export function normalizeSheetPreset(input: unknown): RoverSheetPreset | undefined {
  const parsed = Number(input);
  if (!Number.isInteger(parsed)) return undefined;
  if (parsed < 0 || parsed > 2) return undefined;
  return parsed as RoverSheetPreset;
}

export function getSheetPresetHeights(metrics: RoverViewportMetrics): [number, number, number] {
  const ratios = metrics.layout === 'tablet' ? PANEL_TABLET_SNAP_RATIOS : PANEL_PHONE_SNAP_RATIOS;
  const minHeight = metrics.layout === 'tablet' ? PANEL_TABLET_MIN_HEIGHT : PANEL_PHONE_MIN_HEIGHT;
  const baseBottom = metrics.layout === 'tablet' ? PANEL_TABLET_BOTTOM_OFFSET : PANEL_PHONE_BOTTOM_OFFSET;
  const topOffset = metrics.layout === 'tablet' ? PANEL_TABLET_TOP_OFFSET : PANEL_PHONE_TOP_OFFSET;
  const maxHeight = Math.max(minHeight, Math.round(metrics.height - baseBottom - topOffset));
  return ratios.map((ratio, index) => {
    if (index === ratios.length - 1) return maxHeight;
    return clampNumber(Math.round((metrics.height - baseBottom) * ratio), Math.min(minHeight, maxHeight), maxHeight);
  }) as [number, number, number];
}

export function findNearestSheetPreset(height: number, presets: readonly number[]): RoverSheetPreset {
  let nearest: RoverSheetPreset = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < presets.length; i += 1) {
    const distance = Math.abs(presets[i] - height);
    if (distance < nearestDistance) {
      nearest = i as RoverSheetPreset;
      nearestDistance = distance;
    }
  }
  return nearest;
}
