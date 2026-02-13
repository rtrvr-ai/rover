// shared/frame-extract.ts

import { SemanticNode } from '@rover/a11y-tree';

export type FrameUnavailableReason =
  | 'timeout'
  | 'no_content_script'
  | 'cross_origin_blocked'
  | 'cross_origin_disabled'
  | 'empty_dom'
  | 'tree_failed'
  | 'depth_limit'
  | 'not_traversed'
  | 'unknown';

export type FrameExtract =
  | {
      kind: 'tree';
      url: string;
      title: string;
      contentType: string; // usually text/html
      roots: number[];
      nodes: Record<number, SemanticNode>;
    }
  | {
      kind: 'content';
      url: string;
      title: string;
      contentType: string; // application/pdf, application/gdoc, etc.
      content: string; // FULL content, never truncated
    }
  | {
      kind: 'unavailable';
      url: string;
      title: string;
      contentType: string;
      reason: FrameUnavailableReason;
      detail?: string;
    };

export const GLOBAL_ID_STRIDE = 1_000_000_000;

export function globalIdToFrameId(globalId: string | number): number {
  const n = Number(globalId);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor((n - 1) / GLOBAL_ID_STRIDE);
}

export function isIdInFrame(globalId: number, frameId: number): boolean {
  return globalIdToFrameId(globalId) === frameId;
}
