export const seedStyles = `
    /* ── Launcher / Seed ── */
    .launcher {
      position: fixed;
      right: calc(20px + env(safe-area-inset-right));
      bottom: calc(20px + env(safe-area-inset-bottom));
      width: 58px;
      height: 58px;
      border-radius: 18px;
      border: 1.5px solid var(--rv-accent-border);
      background: linear-gradient(140deg, var(--rv-accent), #FF7A39);
      box-shadow: 0 18px 44px rgba(255, 76, 0, 0.25);
      color: #fff;
      cursor: pointer;
      z-index: 2147483647;
      overflow: hidden;
      display: grid;
      place-items: center;
      padding: 0;
      transition: transform 300ms var(--rv-ease-spring), box-shadow 300ms var(--rv-ease-spring);
      animation: launcherPulse 3s ease-in-out infinite;
    }

    .launcher:hover {
      transform: translateY(-2px) scale(1.04);
      box-shadow: 0 22px 50px rgba(255, 76, 0, 0.32), 0 0 0 4px rgba(255, 76, 0, 0.08);
    }
    .launcher:active {
      transform: scale(0.98);
      box-shadow: 0 14px 36px rgba(255, 76, 0, 0.22);
    }

    .launcherShine {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(135deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 50%);
      pointer-events: none;
    }

    .launcher video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
      transform: scale(1.15);
      transform-origin: center 45%;
      transition: filter 180ms ease, transform 300ms var(--rv-ease-spring);
    }

    .rover[data-mood="running"] .launcher video,
    .rover[data-mood="running"] .avatar video {
      filter: saturate(1.2);
      transform: scale(1.18);
    }

    .rover[data-mood="typing"] .launcher {
      box-shadow: 0 20px 54px rgba(59, 130, 246, 0.22);
      border-color: rgba(59, 130, 246, 0.24);
    }

    .rover[data-mood="success"] .launcher {
      box-shadow: 0 20px 54px rgba(5, 150, 105, 0.22);
      border-color: rgba(5, 150, 105, 0.28);
    }

    .rover[data-mood="error"] .launcher {
      box-shadow: 0 20px 54px rgba(220, 38, 38, 0.22);
      border-color: rgba(220, 38, 38, 0.28);
    }

    .launcherFallback {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.7px;
    }

    /* ── Rover V3: Seed Overrides ── */
    .launcher {
      inset: auto;
      width: auto;
      min-width: 212px;
      max-width: min(320px, calc(100vw - 24px));
      height: 72px;
      border-radius: 999px;
      padding: 8px 14px 8px 10px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      background: linear-gradient(135deg, rgba(255,255,255,0.94), rgba(245, 247, 250, 0.84));
      color: var(--rv-text);
      border: 1px solid rgba(255,255,255,0.66);
      box-shadow: 0 18px 44px rgba(10, 14, 24, 0.14), 0 0 0 1px rgba(255,255,255,0.34);
      animation: none;
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      touch-action: none;
      user-select: none;
      transform-origin: center;
    }

    .launcher.breathe {
      animation: seedBreathe 3.6s ease-in-out infinite;
    }
    .launcher.dragging {
      cursor: grabbing;
      box-shadow: 0 26px 56px rgba(10, 14, 24, 0.22);
      transform: scale(1.02);
    }
    .launcher:hover {
      transform: translateY(-2px);
      box-shadow: 0 26px 56px rgba(10, 14, 24, 0.18), 0 0 0 1px rgba(255,255,255,0.44);
    }

    /* ── Seed Glow (mood-reactive) ── */
    .seed-glow {
      position: absolute;
      inset: -8px;
      border-radius: inherit;
      pointer-events: none;
      z-index: 0;
      opacity: 0;
      transition: opacity 400ms var(--rv-ease-smooth);
    }
    .seed-glow::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: radial-gradient(ellipse at center, var(--rv-accent-glow) 0%, transparent 70%);
      animation: moodGlow 3s ease-in-out infinite;
    }

    .launcher[data-mood="thinking"] .seed-glow {
      opacity: 1;
    }
    .launcher[data-mood="thinking"] .seed-glow::before {
      background: radial-gradient(ellipse at center, rgba(59, 130, 246, 0.18) 0%, transparent 70%);
    }
    .launcher[data-mood="running"] .seed-glow {
      opacity: 1;
    }
    .launcher[data-mood="running"] .seed-glow::before {
      background: radial-gradient(ellipse at center, rgba(255, 76, 0, 0.18) 0%, transparent 70%);
    }
    .launcher[data-mood="success"] .seed-glow {
      opacity: 1;
    }
    .launcher[data-mood="success"] .seed-glow::before {
      background: radial-gradient(ellipse at center, rgba(5, 150, 105, 0.18) 0%, transparent 70%);
    }
    .launcher[data-mood="error"] .seed-glow {
      opacity: 1;
    }
    .launcher[data-mood="error"] .seed-glow::before {
      background: radial-gradient(ellipse at center, rgba(220, 38, 38, 0.18) 0%, transparent 70%);
    }

    /* ── Seed Shine (specular highlight) ── */
    .seed-shine {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      pointer-events: none;
      z-index: 2;
    }
    .seed-shine::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 40%, transparent 60%);
    }

    .launcherBody {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      position: relative;
      z-index: 1;
    }
    .launcherMedia {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      overflow: hidden;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, var(--rv-accent), #ff9a63);
      color: white;
      flex: 0 0 auto;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
    }
    .launcher video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: inherit;
      transform: none;
    }
    .launcherFallback {
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #fff;
    }
    .launcherCopy {
      display: flex;
      flex-direction: column;
      min-width: 0;
      align-items: flex-start;
    }
    .launcherLabel {
      font-size: 15px;
      line-height: 1.1;
      font-weight: 800;
      color: var(--rv-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 220px;
    }
    .launcherShine {
      background: radial-gradient(circle at top right, rgba(255,255,255,0.38), transparent 44%);
    }

    /* ── Greeting Bubble ── */
    .greetingBubble {
      position: fixed;
      max-width: 260px;
      padding: 10px 28px 10px 14px;
      background:
        radial-gradient(120% 80% at 100% 0%, rgba(255, 76, 0, 0.05), transparent 52%),
        linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(248, 250, 252, 0.82));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.55);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(10, 14, 24, 0.14), 0 0 0 1px rgba(255,255,255,0.28);
      z-index: 2147483647;
      display: none;
      cursor: pointer;
      animation: greetingIn 380ms var(--rv-ease-spring) forwards;
    }

    .greetingBubble.visible { display: block; }
    .greetingBubble.dismissing { animation: greetingOut 280ms var(--rv-ease-smooth) forwards; }

    /* Tail pointing down toward seed */
    .greetingBubble::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 50%;
      margin-left: -6px;
      width: 12px;
      height: 12px;
      background: rgba(248, 250, 252, 0.82);
      border-right: 1px solid rgba(255, 255, 255, 0.55);
      border-bottom: 1px solid rgba(255, 255, 255, 0.55);
      transform: rotate(45deg);
    }

    /* Flipped: tail points up when bubble is below seed */
    .greetingBubble.flipped::after {
      bottom: auto;
      top: -6px;
      transform: rotate(-135deg);
    }

    .greetingText {
      font-size: 13.5px;
      font-weight: 500;
      color: var(--rv-text);
      line-height: 1.45;
      letter-spacing: -0.01em;
    }

    .greetingClose {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: var(--rv-text-tertiary);
      font-size: 13px;
      cursor: pointer;
      display: grid;
      place-items: center;
      border-radius: 999px;
      opacity: 0;
      transition: opacity 150ms ease, background 120ms ease, color 120ms ease;
    }

    .greetingBubble:hover .greetingClose {
      opacity: 1;
    }

    .greetingClose:hover {
      background: var(--rv-bg-alt);
      color: var(--rv-text);
    }

    /* Hide seed when bar or full panel is active */
    .rover[data-shell="bar"] .launcher,
    .rover[data-shell="stage"] .launcher,
    .rover[data-shell="focus_stream"] .launcher {
      display: none;
    }
`;
