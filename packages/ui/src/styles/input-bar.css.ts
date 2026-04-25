export const inputBarStyles = `
    /* ── Input Bar (minimized state) ── */
    .inputBar {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 640px;
      width: calc(100vw - 32px);
      min-height: 60px;
      border-radius: 999px;
      transition: border-radius 200ms ease;
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 10px 6px 6px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.92), rgba(248, 250, 252, 0.86));
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.6);
      box-shadow: 0 16px 48px rgba(10, 14, 24, 0.14), 0 0 0 1px rgba(255,255,255,0.35), 0 0 36px rgba(255, 76, 0, 0.07);
      z-index: 2147483646;
      transform-origin: center bottom;
    }

    .inputBar.open {
      display: flex;
      animation: barOpen 300ms var(--rv-ease-spring) forwards;
    }

    :host(.dark) .inputBar {
      background:
        linear-gradient(135deg, rgba(15, 17, 23, 0.94), rgba(26, 29, 39, 0.88));
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 18px 52px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.05);
    }

    .inputBarMascot {
      width: 40px;
      height: 40px;
      min-width: 40px;
      border-radius: 50%;
      overflow: hidden;
      cursor: pointer;
      background: linear-gradient(135deg, var(--rv-accent), #ff9a63);
      display: grid;
      place-items: center;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.18);
    }
    .inputBarMascot video {
      width: 100%; height: 100%; object-fit: cover; border-radius: inherit;
    }
    .inputBarMascot img {
      width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block;
    }
    .inputBarMascotFallback {
      font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: #fff;
    }

    .inputBarExpand {
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      cursor: pointer;
      display: grid;
      place-items: center;
      color: var(--rv-text-secondary);
      padding: 0;
      transition: background 150ms ease, color 150ms ease;
    }
    .inputBarExpand:hover {
      background: rgba(255, 76, 0, 0.07);
      color: var(--rv-accent);
    }

    .inputBarComposerSlot {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
    }

    /* Composer overrides when inside bar */
    .inputBarComposerSlot .composer {
      flex: 1;
      width: 100%;
      min-width: 0;
      padding: 0;
      background: transparent;
      border: none;
      box-shadow: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
    .inputBarComposerSlot .composerRow {
      flex: 1;
      width: 100%;
      gap: 6px;
    }
    .inputBarComposerSlot .composer textarea {
      flex: 1;
      min-width: 0;
      width: 100%;
      min-height: 40px;
      max-height: 96px;
      padding: 8px 10px;
      font-size: 14px;
      resize: none;
      border-radius: 12px;
      border: none;
      background: transparent;
      box-shadow: none;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 76, 0, 0.18) transparent;
    }
    .inputBarComposerSlot .composer textarea::-webkit-scrollbar {
      width: 4px;
    }
    .inputBarComposerSlot .composer textarea::-webkit-scrollbar-track {
      background: transparent;
    }
    .inputBarComposerSlot .composer textarea::-webkit-scrollbar-thumb {
      background: rgba(255, 76, 0, 0.18);
      border-radius: 999px;
    }
    .inputBarComposerSlot .attachmentStrip {
      display: none;
    }
    .inputBarComposerSlot .composerStatus {
      display: none;
    }
    .inputBarComposerSlot .attachmentBtn {
      height: 36px;
      width: 36px;
      min-width: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      box-shadow: none;
      color: var(--rv-text-secondary);
      cursor: pointer;
      transition: color 150ms ease, background 150ms ease;
    }
    .inputBarComposerSlot .attachmentBtn:hover {
      color: var(--rv-accent);
      background: rgba(255, 76, 0, 0.07);
    }
    .inputBarComposerSlot .voiceBtn {
      height: 36px;
      width: 36px;
      min-width: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      box-shadow: none;
      color: var(--rv-text-secondary);
    }
    .inputBarComposerSlot .voiceBtn:hover {
      color: var(--rv-accent);
      background: rgba(255, 76, 0, 0.07);
    }
    .inputBarComposerSlot .voiceBtn.active {
      color: var(--rv-accent);
      background: var(--rv-accent-soft);
    }
    .inputBarComposerSlot .sendBtn {
      height: 36px;
      width: 36px;
      min-width: 36px;
      border-radius: 50%;
    }

    .inputBar.running {
      border-color: rgba(var(--rv-accent-rgb, 255, 76, 0), 0.25);
      box-shadow:
        0 16px 48px rgba(10, 14, 24, 0.14),
        0 0 0 1px rgba(255,255,255,0.35),
        0 0 20px rgba(var(--rv-accent-rgb, 255, 76, 0), 0.08);
      animation: barOpen 300ms var(--rv-ease-spring) forwards, barRunningPulse 2.4s ease-in-out infinite;
    }

    :host(.dark) .inputBar.running {
      box-shadow:
        0 18px 52px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(255,255,255,0.05),
        0 0 20px rgba(var(--rv-accent-rgb, 255, 76, 0), 0.10);
    }

    @keyframes barRunningPulse {
      0%, 100% { border-color: rgba(var(--rv-accent-rgb, 255, 76, 0), 0.15); }
      50% { border-color: rgba(var(--rv-accent-rgb, 255, 76, 0), 0.35); }
    }

    .inputBarClose {
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      cursor: pointer;
      display: grid;
      place-items: center;
      color: var(--rv-text-tertiary);
      font-size: 16px;
      transition: background 150ms ease, color 150ms ease;
      padding: 0;
    }
    .inputBarClose:hover {
      background: rgba(255, 76, 0, 0.07);
      color: var(--rv-accent);
    }

    /* ── Expanded text state (textarea grew beyond single line) ── */
    .inputBar.expanded-text {
      border-radius: 28px;
      align-items: flex-end;
      padding-bottom: 10px;
    }

    /* Minimize button in header */
    .minimizeBtn {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      cursor: pointer;
      display: grid;
      place-items: center;
      color: var(--rv-text-secondary);
      font-size: 14px;
      line-height: 1;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      flex: 0 0 auto;
      padding: 0;
    }
    .minimizeBtn:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }
`;
