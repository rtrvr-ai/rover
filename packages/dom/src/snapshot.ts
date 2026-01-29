import { extractSemanticTree, getIndexedAnnotatedElement } from '@rover/a11y-tree';
import type { SemanticNode } from '@rover/a11y-tree';
import type { FrameworkElementMetadata } from '@rover/shared';
import type { InstrumentationController } from '@rover/instrumentation';

export type Snapshot = {
  rootNodes: number[];
  semanticNodes: Record<number, SemanticNode>;
  elementMeta: Record<number, FrameworkElementMetadata>;
};

export type SnapshotOptions = {
  includeFrames?: boolean;
  frameContextLabel?: string | null;
  disableDomAnnotations?: boolean;
};

export function buildSnapshot(
  root: Element,
  instrumentation: InstrumentationController,
  opts: SnapshotOptions = {},
): Snapshot {
  const { rootNodes, semanticNodes } = extractSemanticTree(root, {
    includeFrameContents: opts.includeFrames ?? true,
    clearIframes: opts.includeFrames ?? true,
    frameContextLabel: opts.frameContextLabel ?? null,
    signalProvider: instrumentation.signalProvider,
    disableDomAnnotations: opts.disableDomAnnotations ?? true,
  });

  const elementMeta: Record<number, FrameworkElementMetadata> = {};
  for (const idStr of Object.keys(semanticNodes)) {
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    const el = getIndexedAnnotatedElement(id);
    if (el) elementMeta[id] = instrumentation.getFrameworkMetadata(el);
  }

  return { rootNodes, semanticNodes, elementMeta };
}
