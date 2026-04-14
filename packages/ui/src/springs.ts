/**
 * Lightweight spring solver that pre-computes keyframe arrays for the Web Animations API.
 * No persistent rAF loop — compute once, animate with WAAPI.
 */

export type SpringConfig = {
  stiffness: number;
  damping: number;
  mass: number;
  precision: number;
};

export type SpringPreset = 'gentle' | 'wobbly' | 'stiff' | 'heartbeat';

const PRESETS: Record<SpringPreset, SpringConfig> = {
  gentle: { stiffness: 120, damping: 14, mass: 1, precision: 0.001 },
  wobbly: { stiffness: 180, damping: 8, mass: 1, precision: 0.001 },
  stiff: { stiffness: 300, damping: 24, mass: 1, precision: 0.001 },
  heartbeat: { stiffness: 260, damping: 10, mass: 0.8, precision: 0.001 },
};

export function getSpringPreset(name: SpringPreset): SpringConfig {
  return { ...PRESETS[name] };
}

/**
 * Solves a damped harmonic oscillator from 0→1, returning normalized position samples.
 * Uses Euler integration at ~60fps intervals.
 */
export function solveSpring(config: SpringConfig, durationMs: number, sampleCount?: number): number[] {
  const { stiffness, damping, mass, precision } = config;
  const steps = sampleCount ?? Math.max(2, Math.ceil((durationMs / 1000) * 60));
  const dt = durationMs / 1000 / steps;
  const samples: number[] = [];

  let pos = 0;
  let vel = 0;
  const target = 1;

  for (let i = 0; i <= steps; i++) {
    samples.push(pos);
    const force = -stiffness * (pos - target) - damping * vel;
    const acceleration = force / mass;
    vel += acceleration * dt;
    pos += vel * dt;
  }

  // Ensure last sample is exactly at target if settled
  if (Math.abs(pos - target) < precision && Math.abs(vel) < precision) {
    samples[samples.length - 1] = target;
  }

  return samples;
}

/**
 * Generates an array of Keyframe objects by interpolating between `from` and `to`
 * using spring physics for each numeric property.
 */
export function springKeyframes<T extends Keyframe>(
  from: T,
  to: T,
  config: SpringConfig | SpringPreset,
  durationMs: number,
): Keyframe[] {
  const cfg = typeof config === 'string' ? getSpringPreset(config) : config;
  const samples = solveSpring(cfg, durationMs);
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.delete('offset');
  keys.delete('easing');
  keys.delete('composite');

  return samples.map((t, i) => {
    const frame: Keyframe = { offset: i / (samples.length - 1) };
    for (const key of keys) {
      const a = (from as Record<string, unknown>)[key];
      const b = (to as Record<string, unknown>)[key];
      if (typeof a === 'number' && typeof b === 'number') {
        (frame as Record<string, unknown>)[key] = a + (b - a) * t;
      } else {
        // For non-numeric values, snap at halfway
        (frame as Record<string, unknown>)[key] = t < 0.5 ? a : b;
      }
    }
    return frame;
  });
}

/**
 * Convenience: animate an element from→to using spring physics via Web Animations API.
 */
export function springAnimate(
  el: HTMLElement,
  from: Keyframe,
  to: Keyframe,
  config: SpringConfig | SpringPreset,
  durationMs: number,
  options?: { fill?: FillMode },
): Animation {
  const keyframes = springKeyframes(from, to, config, durationMs);
  return el.animate(keyframes, {
    duration: durationMs,
    fill: options?.fill ?? 'forwards',
    easing: 'linear', // easing is baked into the keyframes
  });
}
