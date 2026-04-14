export const liveStackStyles = `
    /* ── Live Stack (floating card stack above input bar) ── */
    .liveStack {
      position: fixed;
      bottom: 96px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 640px;
      width: calc(100vw - 32px);
      display: none;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      z-index: 2147483645;
      pointer-events: auto;
    }

    .liveStack.open {
      display: flex;
      animation: liveStackIn 320ms var(--rv-ease-spring) forwards;
    }

    .liveStack.closing {
      animation: liveStackOut 220ms ease forwards;
    }

    /* ── Header ── */
    .liveStackHeader {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 10px;
      background: rgba(255, 255, 255, 0.6);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.4);
    }

    .liveStackDot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--rv-accent);
      animation: livePulse 1.6s ease-in-out infinite;
      flex-shrink: 0;
    }

    .liveStackLabel {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--rv-accent);
      user-select: none;
    }

    .liveStackExpandBtn {
      margin-left: auto;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      cursor: pointer;
      display: grid;
      place-items: center;
      color: var(--rv-text-secondary);
      font-size: 11px;
      padding: 0;
      transition: background 150ms ease, color 150ms ease;
    }
    .liveStackExpandBtn:hover {
      background: var(--rv-bg-alt);
      color: var(--rv-text);
    }

    /* ── Cards Container ── */
    .liveStackCards {
      display: flex;
      flex-direction: column-reverse;
      gap: 6px;
    }

    /* ── Individual Card ── */
    .liveStackCard {
      border-radius: 14px;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.6);
      box-shadow:
        0 8px 32px rgba(10, 14, 24, 0.08),
        0 0 0 1px rgba(255, 255, 255, 0.35);
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: liveCardIn 280ms var(--rv-ease-spring) forwards;
      transition: opacity 200ms ease, filter 200ms ease, transform 200ms ease, box-shadow 200ms ease;
      cursor: pointer;
      position: relative;
    }

    /* Active card — latest step */
    .liveStackCard.active {
      border-color: var(--rv-accent-border);
      background: rgba(255, 255, 255, 0.96);
      box-shadow:
        0 0 0 2px rgba(var(--rv-accent-rgb, 16, 185, 129), 0.10),
        0 8px 32px rgba(10, 14, 24, 0.10);
      animation: liveCardIn 280ms var(--rv-ease-spring) forwards, liveGlow 2.4s ease-in-out infinite;
    }

    .liveStackCard.active:hover {
      box-shadow:
        0 0 0 3px rgba(var(--rv-accent-rgb, 16, 185, 129), 0.14),
        0 12px 40px rgba(10, 14, 24, 0.12);
    }

    /* Previous card — slightly faded + blurred */
    .liveStackCard.previous {
      opacity: 0.55;
      filter: blur(0.8px);
      transform: scale(0.97);
      cursor: pointer;
    }

    .liveStackCard.previous:hover {
      opacity: 0.88;
      filter: blur(0);
      transform: scale(0.99);
    }

    /* Hidden cards */
    .liveStackCard.hidden {
      display: none;
    }

    /* ── Card Internals ── */
    .liveStackCardTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .liveStackCardMeta {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .liveStackCardTs {
      font-size: 10px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--rv-accent);
      flex-shrink: 0;
      letter-spacing: 0.02em;
    }

    .liveStackCardSep {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      flex-shrink: 0;
    }

    .liveStackCardStatus {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--rv-accent);
      flex-shrink: 0;
    }

    .liveStackCardTitle {
      font-size: 13px;
      font-weight: 500;
      color: var(--rv-text);
      line-height: 1.45;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .liveStack[data-thought-style="minimal"] .liveStackCard {
      padding: 8px 12px;
      gap: 3px;
    }

    .liveStack[data-thought-style="minimal"] .liveStackCardTop {
      gap: 6px;
    }

    .liveStack[data-thought-style="minimal"] .liveStackCardStatus {
      font-size: 8px;
      letter-spacing: 0.1em;
    }

    .liveStack[data-thought-style="minimal"] .liveStackCardTitle {
      font-size: 12px;
      font-weight: 600;
      -webkit-line-clamp: 1;
    }

    /* Spinner on active card */
    .liveStackCardSpinner {
      display: none;
      width: 12px;
      height: 12px;
      border: 1.5px solid rgba(var(--rv-accent-rgb, 16, 185, 129), 0.22);
      border-top-color: var(--rv-accent);
      border-radius: 50%;
      animation: spin 0.85s linear infinite;
      flex-shrink: 0;
    }

    .liveStackCard.active .liveStackCardSpinner {
      display: block;
    }

    /* ── Card Detail (shown on click/expand) ── */
    .liveStackCardDetail {
      font-size: 12px;
      color: var(--rv-text-secondary);
      line-height: 1.5;
      display: none;
      padding-top: 4px;
      border-top: 1px solid var(--rv-border);
      overflow: hidden;
      max-height: 80px;
      overflow-y: auto;
    }

    .liveStackCard.expanded .liveStackCardDetail,
    .liveStackCard[data-has-detail]:hover .liveStackCardDetail {
      display: block;
      animation: detailReveal 200ms ease forwards;
    }

    .liveStack[data-thought-style="minimal"] .liveStackCardDetail {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      max-height: 56px;
      padding-top: 3px;
    }

    /* ── Overflow Pill ── */
    .liveStackOverflow {
      width: 100%;
      padding: 5px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.80);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--rv-border);
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      color: var(--rv-text-secondary);
      cursor: pointer;
      text-align: center;
      transition: background 150ms ease, color 150ms ease;
      display: none;
    }

    .liveStackOverflow:hover {
      background: rgba(255, 255, 255, 0.95);
      color: var(--rv-text);
    }

    .liveStackOverflow.visible {
      display: block;
    }

    /* ── Keyframes ── */
    @keyframes liveStackIn {
      0%   { opacity: 0; transform: translateX(-50%) translateY(20px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes liveStackOut {
      0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
      100% { opacity: 0; transform: translateX(-50%) translateY(16px); }
    }

    @keyframes liveCardIn {
      0%   { opacity: 0; transform: translateY(12px) scale(0.96); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes detailReveal {
      0%   { opacity: 0; max-height: 0; }
      100% { opacity: 1; max-height: 80px; }
    }

    /* ── Dark Mode ── */
    :host(.dark) .liveStackCard {
      background: rgba(22, 24, 33, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow:
        0 10px 36px rgba(0, 0, 0, 0.32),
        0 0 0 1px rgba(255, 255, 255, 0.04);
    }

    :host(.dark) .liveStackCard.active {
      background: rgba(26, 29, 40, 0.96);
      box-shadow:
        0 0 0 2px rgba(var(--rv-accent-rgb, 16, 185, 129), 0.14),
        0 10px 36px rgba(0, 0, 0, 0.36);
    }

    :host(.dark) .liveStackOverflow {
      background: rgba(22, 24, 33, 0.85);
      border-color: rgba(255, 255, 255, 0.08);
      color: var(--rv-text-secondary);
    }

    :host(.dark) .liveStackOverflow:hover {
      background: rgba(30, 33, 45, 0.95);
      color: var(--rv-text);
    }

    :host(.dark) .liveStackHeader {
      background: rgba(22, 24, 33, 0.7);
      border-color: rgba(255, 255, 255, 0.06);
    }

    :host(.dark) .liveStackExpandBtn {
      background: rgba(22, 24, 33, 0.9);
      border-color: rgba(255, 255, 255, 0.08);
    }

    :host(.dark) .liveStackExpandBtn:hover {
      background: rgba(40, 44, 58, 0.9);
    }

    /* ── Responsive: Mobile ── */
    @media (max-width: 640px) {
      .liveStack {
        bottom: 84px;
        width: calc(100vw - 24px);
      }

      .liveStackCard {
        border-radius: 12px;
        padding: 8px 12px;
      }

      .liveStackCardTitle {
        font-size: 12.5px;
      }

      .liveStackCardTs {
        font-size: 9px;
      }
    }
`;
