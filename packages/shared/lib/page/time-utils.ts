// shared/time.ts (or near your extractors)

export function nowMs(): number {
  return Date.now();
}

export function timeLeftMs(deadlineEpochMs?: number): number {
  if (!deadlineEpochMs || !Number.isFinite(deadlineEpochMs)) return Number.POSITIVE_INFINITY;
  return Math.max(0, deadlineEpochMs - nowMs());
}

// Use your existing sleepBgSafe
export async function delayBgSafe(ms: number, doc: Document, deadlineEpochMs?: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const left = timeLeftMs(deadlineEpochMs);
  if (left <= 0) return;

  // Only delay if we have room; otherwise skip delay entirely.
  if (left < ms + 40) return;

  await sleepBgSafe(ms, doc);
}

export async function withBgSafeTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  doc: Document,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'timeout' }> {
  const t = Math.max(0, Math.floor(timeoutMs));
  if (!t) return { ok: false, reason: 'timeout' };

  const r = await Promise.race([
    p.then(value => ({ ok: true as const, value })),
    (async () => {
      await sleepBgSafe(t, doc);
      return { ok: false as const, reason: 'timeout' as const };
    })(),
  ]);

  return r;
}

/**
 * Background-safe sleep (avoids timer clamping in hidden tabs).
 * Use this for ALL timeouts / deadlines that must behave in background tabs.
 */
export const sleepBgSafe = (() => {
  const ch = new MessageChannel();
  const q: Array<() => void> = [];
  ch.port1.onmessage = () => {
    const r = q.shift();
    if (r) r();
  };

  const yieldOnce = () =>
    new Promise<void>(resolve => {
      q.push(resolve);
      ch.port2.postMessage(0);
    });

  return async (ms: number, doc: Document) => {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return;

    if (!doc.hidden) {
      // Use the document realm timer when possible (avoids cross-realm edge cases).
      const w = doc.defaultView || window;
      const st = (w as any).setTimeout ? (w as any).setTimeout.bind(w) : setTimeout;
      await new Promise<void>(r => st(r, t));
      return;
    }

    const startWall = Date.now();
    while (Date.now() - startWall < t) {
      await yieldOnce();
    }
  };
})();
