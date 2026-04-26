export const effectsStyles = `
    /* ── Particle Canvas ── */
    .particle-canvas {
      pointer-events: none;
      z-index: 0;
    }

    /* ── Filament SVG Overlay ── */
    .filament-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
    }
    .filament-overlay path {
      fill: none;
      stroke: var(--rv-accent, #ff4c00);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-dasharray: 6 4;
    }

    /* ── Action Spotlight (agent target highlight) ── */
    .actionSpotlightLayer {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483645;
    }

    .actionSpotlightRing {
      position: fixed;
      left: 0;
      top: 0;
      border-radius: 10px;
      border: 2px solid var(--rv-accent, #ff4c00);
      background: rgba(255, 76, 0, 0.045);
      box-shadow:
        0 0 0 2px rgba(255, 255, 255, 0.74),
        0 0 0 6px rgba(255, 76, 0, 0.12),
        0 12px 32px rgba(255, 76, 0, 0.18);
      opacity: 1;
      transform-origin: center;
      will-change: transform, width, height, opacity;
      transition: opacity 420ms ease, box-shadow 220ms ease;
    }

    .actionSpotlightRing.pulse {
      animation: actionSpotlightPulse 720ms var(--rv-ease-decel) 1;
    }

    .actionSpotlightRing.fading {
      opacity: 0;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.4),
        0 0 0 2px rgba(255, 76, 0, 0);
    }

    .actionSpotlightChip {
      position: fixed;
      left: 0;
      top: 0;
      max-width: 180px;
      min-height: 26px;
      padding: 5px 9px;
      border-radius: 999px;
      background: rgba(26, 26, 25, 0.88);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 10px 28px rgba(10, 14, 24, 0.16);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      font: 700 11px/1.35 'Manrope', system-ui, -apple-system, sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 1;
      will-change: transform, opacity;
      transition: opacity 420ms ease;
    }

    .actionSpotlightChip.fading {
      opacity: 0;
    }

    :host(.dark) .actionSpotlightRing {
      background: rgba(255, 76, 0, 0.07);
      box-shadow:
        0 0 0 2px rgba(15, 17, 23, 0.72),
        0 0 0 6px rgba(255, 76, 0, 0.16),
        0 12px 32px rgba(255, 76, 0, 0.22);
    }

    @keyframes actionSpotlightPulse {
      0% {
        opacity: 0.2;
        box-shadow:
          0 0 0 0 rgba(255, 255, 255, 0.74),
          0 0 0 0 rgba(255, 76, 0, 0.22),
          0 12px 32px rgba(255, 76, 0, 0.12);
      }
      55% {
        opacity: 1;
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.74),
          0 0 0 10px rgba(255, 76, 0, 0.06),
          0 12px 32px rgba(255, 76, 0, 0.2);
      }
      100% {
        opacity: 1;
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, 0.74),
          0 0 0 6px rgba(255, 76, 0, 0.12),
          0 12px 32px rgba(255, 76, 0, 0.18);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .actionSpotlightRing.pulse {
        animation: none;
      }
      .actionSpotlightRing,
      .actionSpotlightChip {
        transition: opacity 120ms ease;
      }
    }

    /* ── Tool Ripple ── */
    .tool-ripple {
      position: fixed;
      width: 80px;
      height: 80px;
      border-radius: 50%;
      border: 2px solid var(--rv-accent, #ff4c00);
      pointer-events: none;
      z-index: 2147483644;
      transform: translate(-50%, -50%);
    }

    /* ── Palimpsest (page dim during running) ── */
    .panelBackdrop.palimpsest {
      background: radial-gradient(
        ellipse at var(--rv-palimpsest-x, 50%) var(--rv-palimpsest-y, 50%),
        rgba(0, 0, 0, 0.02) 0%,
        rgba(0, 0, 0, 0.08) 100%
      );
    }

    /* ── Tide-line (progress along panel edge) ── */
    .panel.open::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 3px;
      height: 100%;
      pointer-events: none;
      z-index: 10;
      background: linear-gradient(
        to top,
        var(--rv-accent, #ff4c00) 0%,
        var(--rv-accent, #ff4c00) var(--rv-tide-progress, 0%),
        transparent var(--rv-tide-progress, 0%),
        transparent 100%
      );
      opacity: 0.5;
      border-radius: 0 2px 2px 0;
      transition: opacity 300ms ease;
    }

    /* ── Pulse Badge (step count on minimized seed) ── */
    .pulse-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      border-radius: 999px;
      background: var(--rv-accent, #ff4c00);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      z-index: 10;
      box-shadow: 0 2px 8px rgba(255, 76, 0, 0.3);
      pointer-events: none;
    }

    /* ── Completion Burst (green flash on seed) ── */
    .launcher.completion-burst {
      box-shadow: 0 0 32px rgba(5, 150, 105, 0.4), 0 18px 44px rgba(10, 14, 24, 0.14) !important;
    }

    /* ── Error Wobble (red flash on seed) ── */
    .launcher.error-wobble {
      box-shadow: 0 0 32px rgba(220, 38, 38, 0.4), 0 18px 44px rgba(10, 14, 24, 0.14) !important;
    }

    /* ── Voice Active (mic-driven pulsing) ── */
    .launcher.voice-active {
      transform: scale(var(--rv-audio-scale, 1));
      box-shadow: 0 0 24px rgba(59, 130, 246, 0.3), 0 18px 44px rgba(10, 14, 24, 0.14);
      transition: transform 80ms ease-out, box-shadow 200ms ease;
    }

    /* ── Waiting State ── */
    .rover[data-mood="waiting"] .launcher {
      border-color: rgba(245, 158, 11, 0.28);
      box-shadow: 0 20px 54px rgba(245, 158, 11, 0.22);
    }
    .rover[data-mood="waiting"] .seed-glow {
      opacity: 1;
    }
    .rover[data-mood="waiting"] .seed-glow::before {
      background: radial-gradient(ellipse at center, rgba(245, 158, 11, 0.18) 0%, transparent 70%);
    }
    .rover[data-mood="waiting"] .launcher.breathe {
      animation-duration: 5.4s;
    }
    /* ── Drag Snap Resist ── */
    .launcher.snap-resist {
      transform: scale(0.98);
    }

`;
