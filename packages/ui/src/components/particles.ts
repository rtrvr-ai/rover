/**
 * Canvas 2D ember/particle system around the seed.
 * Pool-based (zero GC pressure), self-pausing rAF.
 */

export type ParticleMode = 'idle' | 'ambient' | 'burst' | 'pulse';

export type ParticleSystemOptions = {
  /** Parent element to append canvas to (typically the seed/launcher) */
  container: HTMLElement;
  /** Canvas size in CSS pixels */
  size?: number;
  /** Accent color for particles (CSS color string) */
  color?: string;
  /** Whether reduced motion is preferred */
  reducedMotion?: boolean;
  /** Whether on mobile (halves pool and spawn rate) */
  mobile?: boolean;
};

type Particle = {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
};

export type ParticleSystem = {
  canvas: HTMLCanvasElement;
  setMode: (mode: ParticleMode) => void;
  setSpawnRate: (rate: number) => void;
  setColor: (color: string) => void;
  resize: () => void;
  destroy: () => void;
};

export function createParticleSystem(opts: ParticleSystemOptions): ParticleSystem {
  const { container, reducedMotion = false, mobile = false } = opts;
  const size = opts.size ?? 200;
  const poolSize = mobile ? 32 : 64;
  const mobileMultiplier = mobile ? 0.5 : 1;

  let accentColor = opts.color || 'rgba(255, 76, 0, 0.6)';
  let mode: ParticleMode = 'idle';
  let spawnRate = 4; // particles per second
  let rafId: number | null = null;
  let lastTime = 0;
  let spawnAccumulator = 0;
  let destroyed = false;

  // Canvas setup
  const canvas = document.createElement('canvas');
  canvas.className = 'particle-canvas';
  canvas.style.cssText = `position:absolute;inset:${-size / 2 + (size > 200 ? 50 : 36)}px;width:${size}px;height:${size}px;pointer-events:none;z-index:0;`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  container.appendChild(canvas);

  // Particle pool
  const pool: Particle[] = [];
  for (let i = 0; i < poolSize; i++) {
    pool.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 2, alpha: 0 });
  }

  function getInactiveParticle(): Particle | null {
    for (const p of pool) {
      if (!p.active) return p;
    }
    return null;
  }

  function spawnParticle(burstAngle?: number): void {
    const p = getInactiveParticle();
    if (!p) return;

    const cx = size / 2;
    const cy = size / 2;
    const angle = burstAngle ?? Math.random() * Math.PI * 2;
    const speed = mode === 'burst'
      ? 30 + Math.random() * 40
      : mode === 'pulse'
        ? 15 + Math.random() * 20
        : 10 + Math.random() * 25;

    p.active = true;
    p.x = cx + Math.cos(angle) * (20 + Math.random() * 10);
    p.y = cy + Math.sin(angle) * (20 + Math.random() * 10);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.maxLife = mode === 'burst' ? 0.4 + Math.random() * 0.3 : 0.8 + Math.random() * 0.6;
    p.life = p.maxLife;
    p.size = 1.5 + Math.random() * 2;
    p.alpha = 0.5 + Math.random() * 0.3;

    // Pulse mode: add tangential velocity for orbiting
    if (mode === 'pulse') {
      const tangentAngle = angle + Math.PI / 2;
      p.vx += Math.cos(tangentAngle) * 12;
      p.vy += Math.sin(tangentAngle) * 12;
    }
  }

  function update(dt: number): void {
    for (const p of pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Slow down
      p.vx *= 0.98;
      p.vy *= 0.98;
    }
  }

  function render(): void {
    ctx.clearRect(0, 0, size, size);
    for (const p of pool) {
      if (!p.active) continue;
      const lifeRatio = p.life / p.maxLife;
      const alpha = p.alpha * lifeRatio;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function tick(timestamp: number): void {
    if (destroyed || mode === 'idle') { rafId = null; return; }
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min((timestamp - lastTime) / 1000, 0.05); // cap at 50ms
    lastTime = timestamp;

    // Spawn logic
    if (mode === 'ambient' || mode === 'pulse') {
      spawnAccumulator += spawnRate * mobileMultiplier * dt;
      while (spawnAccumulator >= 1) {
        spawnParticle();
        spawnAccumulator -= 1;
      }
    }

    update(dt);
    render();

    // Check if any particles still active
    const hasActive = pool.some(p => p.active);
    if (hasActive || mode === 'ambient' || mode === 'pulse') {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      // Clear canvas when all done
      ctx.clearRect(0, 0, size, size);
    }
  }

  function startLoop(): void {
    if (rafId != null || destroyed || reducedMotion) return;
    lastTime = 0;
    spawnAccumulator = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Deactivate all particles
    for (const p of pool) p.active = false;
    ctx.clearRect(0, 0, size, size);
  }

  function setMode(nextMode: ParticleMode): void {
    if (nextMode === mode) return;
    mode = nextMode;

    if (mode === 'idle') {
      stopLoop();
      return;
    }

    if (reducedMotion) return;

    if (mode === 'burst') {
      // One-shot burst: 20-30 radial particles
      const count = mobile ? 12 : 20 + Math.floor(Math.random() * 11);
      for (let i = 0; i < count; i++) {
        spawnParticle((Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.3);
      }
      startLoop();
      return;
    }

    if (mode === 'ambient') {
      spawnRate = mobile ? 3 : 4;
    } else if (mode === 'pulse') {
      spawnRate = mobile ? 4 : 6;
    }
    startLoop();
  }

  function resize(): void {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * nextDpr;
    canvas.height = size * nextDpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(nextDpr, nextDpr);
  }

  function setColor(color: string): void {
    accentColor = color;
  }

  function destroy(): void {
    destroyed = true;
    stopLoop();
    canvas.remove();
  }

  return {
    canvas,
    setMode,
    setSpawnRate: (rate: number) => { spawnRate = rate; },
    setColor,
    resize,
    destroy,
  };
}
