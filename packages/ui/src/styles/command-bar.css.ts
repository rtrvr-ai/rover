export const commandBarStyles = `
    /* ── Command Bar Overlay ── */
    .commandBarOverlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: none;
      align-items: flex-start;
      justify-content: center;
      padding-top: 20vh;
      background: rgba(0, 0, 0, 0.25);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    .commandBarOverlay.open {
      display: flex;
      animation: cmdBarOverlayIn 180ms ease forwards;
    }
    @keyframes cmdBarOverlayIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .commandBar {
      width: 100%;
      max-width: 480px;
      max-height: 420px;
      display: flex;
      flex-direction: column;
      background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(248,250,252,0.92));
      border: 1px solid rgba(255,255,255,0.6);
      border-radius: var(--rv-radius-xl, 20px);
      box-shadow: 0 24px 64px rgba(10, 14, 24, 0.22), 0 0 0 1px rgba(0,0,0,0.06);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      overflow: hidden;
      animation: cmdBarIn 200ms var(--rv-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) forwards;
    }
    @keyframes cmdBarIn {
      from { opacity: 0; transform: translateY(-8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .commandBarHeader {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--rv-border, rgba(0,0,0,0.06));
    }
    .commandBarSearchIcon {
      width: 18px;
      height: 18px;
      color: var(--rv-text-tertiary, #9ca3af);
      flex: 0 0 auto;
    }
    .commandBarSearchIcon svg {
      width: 100%;
      height: 100%;
    }
    .commandBarInput {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 15px;
      font-family: inherit;
      color: var(--rv-text, #1a1a2e);
      outline: none;
      line-height: 1.4;
    }
    .commandBarInput::placeholder {
      color: var(--rv-text-tertiary, #9ca3af);
    }
    .commandBarKbd {
      font-size: 11px;
      font-family: inherit;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--rv-bg-alt, rgba(0,0,0,0.04));
      color: var(--rv-text-tertiary, #9ca3af);
      border: 1px solid var(--rv-border, rgba(0,0,0,0.08));
      flex: 0 0 auto;
    }

    .commandBarList {
      flex: 1;
      overflow-y: auto;
      padding: 6px;
    }
    .commandBarItem {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      padding: 10px 12px;
      border: none;
      background: transparent;
      border-radius: var(--rv-radius-md, 10px);
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      transition: background 100ms ease;
    }
    .commandBarItem:hover,
    .commandBarItem.highlighted {
      background: var(--rv-accent-soft, rgba(255, 76, 0, 0.06));
    }
    .commandBarItemLabel {
      font-size: 14px;
      font-weight: 600;
      color: var(--rv-text, #1a1a2e);
      line-height: 1.3;
    }
    .commandBarItemDesc {
      font-size: 12px;
      color: var(--rv-text-secondary, #6b7280);
      line-height: 1.3;
    }
    .commandBarItemIcon {
      font-size: 16px;
      margin-right: 4px;
    }

    .commandBarEmpty {
      padding: 24px 16px;
      text-align: center;
      font-size: 13px;
      color: var(--rv-text-tertiary, #9ca3af);
      display: none;
    }
    .commandBarEmpty.visible {
      display: block;
    }

    /* ── Dark mode ── */
    :host(.dark) .commandBar {
      background: linear-gradient(135deg, rgba(30,32,40,0.96), rgba(22,24,30,0.92));
      border-color: rgba(255,255,255,0.08);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.06);
    }

    /* ── Mobile ── */
    @media (max-width: 640px) {
      .commandBar {
        max-width: calc(100vw - 16px);
      }
      .commandBarOverlay {
        padding-top: 10vh;
      }
    }
`;
