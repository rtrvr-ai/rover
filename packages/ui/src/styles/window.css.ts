export const windowStyles = `
    /* ── Panel Backdrop ── */
    .panelBackdrop {
      position: fixed;
      inset: 0;
      border: none;
      margin: 0;
      padding: 0;
      background: rgba(10, 14, 24, 0.18);
      opacity: 0;
      pointer-events: none;
      transition: opacity 220ms ease, backdrop-filter 220ms ease;
      backdrop-filter: blur(0px);
      -webkit-backdrop-filter: blur(0px);
      z-index: 2147483644;
    }
    .panelBackdrop.visible {
      opacity: 1;
      pointer-events: auto;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    /* ── Panel ── */
    .panel {
      position: fixed;
      left: 0;
      top: 0;
      width: 860px;
      height: 540px;
      min-width: 640px;
      min-height: 400px;
      max-width: min(1080px, calc(100vw - 16px));
      max-height: calc(100vh - 16px);
      background:
        radial-gradient(120% 80% at 100% 0%, rgba(255, 76, 0, 0.05), transparent 52%),
        linear-gradient(180deg, var(--rv-bg), var(--rv-bg-alt));
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-2xl);
      box-shadow: var(--rv-shadow-xl);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 2147483646;
      color: var(--rv-text);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      transform-origin: bottom right;
    }

    .panel[data-layout="tablet"],
    .panel[data-layout="phone"] {
      transform-origin: bottom center;
    }

    .panel.open {
      display: flex;
      animation: panelOpen 300ms var(--rv-ease-spring) forwards;
    }

    .panel.closing {
      display: flex;
      animation: panelClose 220ms var(--rv-ease-smooth) forwards;
    }

    /* ── V3: Panel glass treatment ── */
    .panel {
      background:
        radial-gradient(120% 120% at 0% 0%, rgba(255, 76, 0, 0.08), transparent 44%),
        radial-gradient(120% 120% at 100% 0%, rgba(59, 130, 246, 0.08), transparent 42%),
        linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.92));
      border: 1px solid rgba(255,255,255,0.72);
      box-shadow: 0 30px 100px rgba(10, 14, 24, 0.18), 0 8px 24px rgba(10, 14, 24, 0.08);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      transform-origin: center center;
    }

    /* ── V3: Dark mode glass treatment ── */
    :host(.dark) .panel {
      background:
        radial-gradient(120% 120% at 0% 0%, rgba(255, 76, 0, 0.06), transparent 44%),
        radial-gradient(120% 120% at 100% 0%, rgba(59, 130, 246, 0.06), transparent 42%),
        linear-gradient(180deg, rgba(15, 17, 23, 0.96), rgba(26, 29, 39, 0.92));
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 30px 100px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    :host(.dark) .panelBackdrop {
      background: rgba(0, 0, 0, 0.4);
    }

    .panel[data-layout="phone"] {
      border-radius: 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--rv-border);
      background: linear-gradient(180deg, rgba(255,255,255,0.96), rgba(250,250,247,0.94));
      min-height: 52px;
      position: relative;
    }

    /* V3: frosted header, no hard border */
    .header {
      padding: 16px 18px 12px;
      background: transparent;
      border-bottom: none;
    }

    /* Accent-tinted separator via ::after */
    .header::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 18px;
      right: 18px;
      height: 1px;
      background: linear-gradient(90deg, transparent, var(--rv-accent-border), transparent);
      opacity: 0.5;
    }

    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      overflow: hidden;
      border: 1.5px solid var(--rv-accent-border);
      background: var(--rv-surface);
      flex: 0 0 auto;
    }

    .avatar video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .avatarFallback {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;
      color: var(--rv-accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.45px;
    }

    .meta {
      min-width: 44px;
      flex: 1 1 44px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow: hidden;
    }

    .title {
      font-size: 14px;
      font-weight: 700;
      color: var(--rv-text);
      letter-spacing: -0.01em;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      color: var(--rv-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .statusDot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--rv-success);
      flex: 0 0 auto;
      animation: livePulse 2s ease-in-out infinite;
    }

    .headerActions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      margin-left: auto;
    }

    .sizeBtn,
    .overflowBtn,
    .closeBtn {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      cursor: pointer;
      display: grid;
      place-items: center;
      color: var(--rv-text-secondary);
      font-size: 16px;
      line-height: 1;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
      flex: 0 0 auto;
      padding: 0;
    }

    .modeLabel {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 999px;
      margin-left: 4px;
      border: 1px solid transparent;
    }

    .modeLabel.controller {
      color: #9a3412;
      background: rgba(255, 76, 0, 0.08);
      border-color: var(--rv-accent-border);
    }

    .modeLabel.observer {
      color: var(--rv-text-secondary);
      background: rgba(0, 0, 0, 0.04);
      border-color: var(--rv-border-strong);
    }

    .cancelPill {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1.5px solid rgba(220, 38, 38, 0.3);
      background: rgba(220, 38, 38, 0.08);
      color: var(--rv-error);
      font-size: 12px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      flex: 0 0 auto;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .cancelPill:hover {
      background: rgba(220, 38, 38, 0.14);
      border-color: rgba(220, 38, 38, 0.45);
    }
    .cancelPill.visible {
      display: flex;
    }
    .cancelIcon {
      display: block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--rv-error);
    }

    .sizeBtn {
      font-size: 14px;
    }

    .sizeBtn svg {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
    }

    .sizeBtn:hover,
    .overflowBtn:hover,
    .closeBtn:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }

    .sizeBtn.hidden {
      display: none;
    }

    .closeBtn {
      font-size: 18px;
    }

    /* ── Execution Progress Bar ── */
    .executionBar {
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      overflow: hidden;
    }
    .executionBar::after {
      content: '';
      position: absolute;
      top: 0;
      left: -40%;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--rv-accent), transparent);
      border-radius: 999px;
      opacity: 0;
      transition: opacity 200ms ease;
    }
    .executionBar.active::after {
      opacity: 1;
      animation: executionSlide 1.5s ease-in-out infinite;
    }

    /* ── Trace Toggle Bar ── */
    .traceToggleBar {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--rv-radius-sm);
      background: var(--rv-bg-alt);
      border: 1px solid var(--rv-border);
    }
    .traceToggleBar.visible {
      display: flex;
    }
    .traceToggleLabel {
      font-size: 11px;
      font-weight: 700;
      color: var(--rv-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .traceToggleCount {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      flex: 1;
    }
    .traceToggleBtn {
      font-size: 11px;
      font-weight: 600;
      color: var(--rv-accent);
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: inherit;
    }
    .traceToggleBtn:hover {
      background: var(--rv-accent-soft);
    }

    /* V3: traceToggleBar */
    .traceToggleBar {
      order: 2;
      background: rgba(255,255,255,0.72);
      border-radius: 16px;
      padding: 8px 12px;
    }

    /* ── Overflow Menu ── */
    .overflowMenu {
      position: absolute;
      top: calc(100% + 4px);
      right: 14px;
      min-width: 180px;
      background: var(--rv-surface);
      border: 1px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-md);
      box-shadow: var(--rv-shadow-lg);
      z-index: 2147483647;
      padding: 4px;
      display: none;
      flex-direction: column;
      animation: msgIn 200ms var(--rv-ease-spring) forwards;
    }

    .overflowMenu.visible {
      display: flex;
    }

    .menuItem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border: none;
      background: transparent;
      border-radius: var(--rv-radius-sm);
      font-size: 13px;
      font-weight: 500;
      font-family: inherit;
      color: var(--rv-text);
      cursor: pointer;
      transition: background 120ms ease;
      text-align: left;
      width: 100%;
    }

    .menuItem:hover {
      background: var(--rv-bg-alt);
    }

    .menuItem.danger {
      color: var(--rv-error);
    }
    .menuItem.danger:hover {
      background: rgba(220, 38, 38, 0.06);
    }

    .menuDivider {
      height: 1px;
      background: var(--rv-border);
      margin: 4px 8px;
    }

    /* ── Feed & Scrollbar ── */
    .feed {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 14px 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: radial-gradient(circle at 10% 0%, var(--rv-accent-soft), transparent 45%);
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 76, 0, 0.18) transparent;
      position: relative;
    }

    .feed::-webkit-scrollbar {
      width: 6px;
    }
    .feed::-webkit-scrollbar-track {
      background: transparent;
    }
    .feed::-webkit-scrollbar-thumb {
      background: rgba(255, 76, 0, 0.18);
      border-radius: 999px;
    }
    .feed::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 76, 0, 0.30);
    }

    /* V3: Feed */
    .feed {
      padding: 10px 18px 16px;
      background: transparent;
      gap: 16px;
    }

    /* Ma whitespace: breathing room between trace and message */
    .entry.trace + .entry.message {
      margin-top: 8px;
    }
    /* Ma whitespace: consecutive assistant messages */
    .entry.message.assistant + .entry.message.assistant {
      margin-top: 4px;
    }

    /* ── Message Bubbles ── */
    .entry {
      display: flex;
      flex-direction: column;
      gap: 4px;
      animation: msgIn 400ms var(--rv-ease-spring) forwards;
    }

    .entry .stamp {
      font-size: 10px;
      color: var(--rv-text-tertiary);
      align-self: flex-end;
      padding: 0 2px;
    }

    .entry.message { max-width: 90%; }
    .panel[data-layout="phone"] .entry.message,
    .panel[data-layout="tablet"] .entry.message {
      max-width: 100%;
    }
    .entry.message.user { align-self: flex-end; }
    .entry.message.assistant,
    .entry.message.system { align-self: flex-start; }

    .bubble {
      border-radius: var(--rv-radius-md);
      padding: 10px 14px;
      line-height: 1.5;
      font-size: 13.5px;
      white-space: pre-wrap;
      word-break: break-word;
      border: 1px solid transparent;
    }

    .entry.message.user .bubble {
      background: var(--rv-surface);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
      box-shadow: var(--rv-shadow-sm);
    }

    .entry.message.assistant .bubble {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      color: var(--rv-text);
      position: relative;
    }

    /* Stream card: assistant accent bar on left */
    .entry.message.assistant .bubble {
      padding-left: 18px;
    }
    .entry.message.assistant .bubble::before {
      content: '';
      position: absolute;
      top: 8px;
      bottom: 8px;
      left: 0;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: linear-gradient(180deg, var(--rv-accent), rgba(255, 76, 0, 0.3));
      opacity: 0.85;
      transition: opacity 200ms ease;
    }

    .entry.message.system .bubble {
      background: rgba(0, 0, 0, 0.03);
      border-color: var(--rv-border);
      color: var(--rv-text-secondary);
      font-size: 12px;
    }

    /* V3: rounded bubbles */
    .entry.message.user .bubble,
    .entry.message.assistant .bubble,
    .entry.message.system .bubble {
      border-radius: 22px;
    }

    /* ── Trace/Timeline Cards ── */
    .entry.trace {
      width: 100%;
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-md);
      padding: 10px 12px;
      background: var(--rv-surface);
      transition: all 140ms ease;
      animation: msgIn 350ms var(--rv-ease-spring) forwards;
    }

    .entry.trace.pending {
      border-color: var(--rv-accent-border);
      background: rgba(255, 76, 0, 0.03);
    }

    .entry.trace.success {
      border-color: rgba(5, 150, 105, 0.15);
      background: rgba(5, 150, 105, 0.03);
    }

    .entry.trace.error {
      border-color: rgba(220, 38, 38, 0.15);
      background: rgba(220, 38, 38, 0.04);
    }

    .entry.trace.info {
      border-color: rgba(59, 130, 246, 0.15);
      background: rgba(59, 130, 246, 0.03);
    }

    /* V3: trace cards */
    .entry.trace {
      border-radius: 22px;
      padding: 14px 16px;
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(15, 23, 42, 0.08);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
    }
    :host(.dark) .entry.trace {
      background: rgba(30, 33, 48, 0.78);
      border-color: rgba(255, 255, 255, 0.06);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
    }
    .entry.trace.compact {
      opacity: 0.76;
    }

    .traceTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .traceMeta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .traceStage {
      font-size: 10px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      font-weight: 700;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      padding: 2px 7px;
      flex: 0 0 auto;
    }

    .traceTitle {
      font-size: 13px;
      line-height: 1.35;
      font-weight: 600;
      color: var(--rv-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }

    .traceTs {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      flex: 0 0 auto;
    }

    .traceDetail {
      font-size: 12px;
      line-height: 1.45;
      color: var(--rv-text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      margin-top: 4px;
    }

    .feed[data-thought-style="minimal"] .entry.trace {
      padding: 10px 12px;
    }

    .feed[data-thought-style="minimal"] .traceTop {
      gap: 8px;
    }

    .feed[data-thought-style="minimal"] .traceStage {
      font-size: 9px;
      padding: 2px 6px;
      letter-spacing: 0.06em;
    }

    .feed[data-thought-style="minimal"] .traceTitle {
      font-size: 12px;
      font-weight: 700;
    }

    .feed[data-thought-style="minimal"] .traceDetail {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      margin-top: 3px;
    }

    .entry.trace.compact .traceDetail {
      display: none;
    }

    /* Feed Hierarchy: hide detail-level trace entries */
    .entry.trace[data-visibility="detail"] { display: none; }
    .rover[data-show-details="true"] .entry.trace[data-visibility="detail"] { display: block; }

    /* Thought Card Styling */
    .entry.trace[data-kind="thought"] {
      border-left: 3px solid var(--rv-accent);
      background: var(--rv-accent-soft);
    }
    .entry.trace[data-kind="thought"] .traceStage {
      background: var(--rv-accent-soft);
      color: var(--rv-accent);
      border-color: var(--rv-accent-border);
    }

    /* ── Task Stage ── */
    .taskStage {
      padding: 0 18px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .taskStageTop {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .taskStageEyebrow {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--rv-text-tertiary);
      font-weight: 800;
    }
    .taskStageStatusPill {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid rgba(5,150,105,0.18);
      background: rgba(5,150,105,0.08);
      color: #047857;
      font-size: 11px;
      font-weight: 800;
    }
    .taskStageStatusPill.idle {
      border-color: rgba(15, 23, 42, 0.08);
      background: rgba(15, 23, 42, 0.04);
      color: var(--rv-text-secondary);
    }
    .taskStageTitle {
      font-size: 24px;
      line-height: 1.05;
      letter-spacing: -0.04em;
      font-weight: 800;
      color: var(--rv-text);
    }
    .taskStageMeta {
      font-size: 12.5px;
      color: var(--rv-text-secondary);
      line-height: 1.4;
    }

    /* ── Artifact Stage ── */
    .artifactStage {
      display: none;
      margin: 0 18px 12px;
      border-radius: 24px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(255,255,255,0.78);
      overflow: hidden;
    }
    .artifactStage.visible {
      display: flex;
      flex-direction: column;
    }
    .artifactStageHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid rgba(15, 23, 42, 0.06);
    }
    .artifactStageLabel {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--rv-text-tertiary);
    }
    .artifactStageToggle {
      border: 1px solid var(--rv-border);
      background: rgba(255,255,255,0.84);
      color: var(--rv-text);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
    }
    .artifactStageBody {
      display: none;
      padding: 14px;
      max-height: 320px;
      overflow: auto;
    }
    .artifactStage.expanded .artifactStageBody {
      display: block;
    }
    .artifactStageEmpty {
      font-size: 12.5px;
      color: var(--rv-text-secondary);
      line-height: 1.5;
    }

    /* ── Composer ── */
    .composer {
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-top: 1px solid var(--rv-border);
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    /* V3: Composer */
    .composer {
      gap: 10px;
      border-top: 1px solid rgba(15, 23, 42, 0.06);
      padding: 14px 18px 18px;
      background: rgba(255,255,255,0.76);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
    }
    :host(.dark) .composer {
      background: rgba(15, 17, 23, 0.76);
      border-top-color: rgba(255, 255, 255, 0.06);
    }

    .composerRow {
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }
    /* V3 */
    .composerRow {
      align-items: center;
      gap: 10px;
      position: relative;
    }

    .composer textarea {
      flex: 1;
      resize: none;
      min-height: 44px;
      max-height: 96px;
      border: 1.5px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-md);
      padding: 10px 12px;
      font-size: 13.5px;
      line-height: 1.4;
      font-family: inherit;
      color: var(--rv-text);
      background: var(--rv-surface);
      outline: none;
      transition: border-color 150ms ease, box-shadow 150ms ease;
    }

    /* V3: textarea */
    .composer textarea {
      min-height: 56px;
      border-radius: 22px;
      padding: 14px 16px;
      background: rgba(255,255,255,0.9);
    }
    :host(.dark) .composer textarea {
      background: rgba(30, 33, 48, 0.9);
    }

    .composer textarea::placeholder {
      color: var(--rv-text-tertiary);
      font-weight: 400;
    }

    .composerPlaceholder {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      display: flex;
      align-items: center;
      padding: 0 16px;
      pointer-events: none;
      color: var(--rv-text-tertiary);
      font-size: 15px;
      white-space: nowrap;
      overflow: hidden;
    }
    .composerPlaceholderText {
      transition: opacity 220ms ease;
    }
    .composerPlaceholderText.fading {
      opacity: 0;
    }
    .inputBarComposerSlot .composerPlaceholder {
      font-size: 14px;
      padding: 0 10px;
    }

    .composer textarea:focus {
      border-color: var(--rv-accent);
      box-shadow: 0 0 0 3px var(--rv-accent-glow), 0 0 0 6px rgba(255, 76, 0, 0.04);
    }

    .composer textarea:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .composerActions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    /* V3 */
    .composerActions {
      gap: 10px;
    }

    .sendBtn {
      border: none;
      background: linear-gradient(145deg, var(--rv-accent), #FF7A39);
      color: #fff;
      border-radius: var(--rv-radius-md);
      height: 44px;
      width: 44px;
      min-width: 44px;
      padding: 0;
      cursor: pointer;
      display: grid;
      place-items: center;
      transition: transform 200ms var(--rv-ease-spring), box-shadow 200ms ease;
      box-shadow: 0 4px 12px rgba(255, 76, 0, 0.20);
      position: relative;
      overflow: hidden;
    }

    /* V3: Send button 48px circle with specular highlight */
    .sendBtn {
      height: 48px;
      width: 48px;
      min-width: 48px;
      border-radius: 50%;
      background: linear-gradient(145deg, var(--rv-accent), #FF7A39);
    }
    .sendBtn::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 6px;
      right: 6px;
      height: 40%;
      border-radius: 50%;
      background: linear-gradient(180deg, rgba(255,255,255,0.32), transparent);
      pointer-events: none;
    }

    .sendBtn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(255, 76, 0, 0.28);
    }
    .sendBtn:active {
      transform: scale(0.96);
      box-shadow: 0 2px 8px rgba(255, 76, 0, 0.16);
    }

    .sendBtn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* ── Send → Stop mode ── */
    .sendBtn.stopMode {
      background: rgba(60, 60, 67, 0.9);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      transition: background 200ms ease, transform 150ms ease, box-shadow 150ms ease;
    }
    .sendBtn.stopMode::after {
      display: none;
    }
    .sendBtn.stopMode:hover {
      background: rgba(60, 60, 67, 1);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .sendBtn.stopMode:active {
      transform: scale(0.96);
    }
    .sendBtn.stopMode svg {
      width: 16px;
      height: 16px;
      fill: #fff;
      stroke: none;
    }
    :host(.dark) .sendBtn.stopMode {
      background: rgba(180, 180, 190, 0.9);
    }
    :host(.dark) .sendBtn.stopMode:hover {
      background: rgba(180, 180, 190, 1);
    }
    :host(.dark) .sendBtn.stopMode svg {
      fill: #1a1d28;
    }

    .voiceBtn {
      border: 1.5px solid var(--rv-border-strong);
      background: rgba(255, 255, 255, 0.9);
      color: var(--rv-accent);
      border-radius: var(--rv-radius-md);
      height: 44px;
      width: 44px;
      min-width: 44px;
      padding: 0;
      cursor: pointer;
      display: none;
      place-items: center;
      transition: transform 200ms var(--rv-ease-spring), box-shadow 200ms ease, border-color 150ms ease, background 150ms ease;
      box-shadow: 0 3px 10px rgba(19, 30, 43, 0.08);
    }

    .voiceBtn.visible {
      display: grid;
    }

    .voiceBtn:hover {
      transform: translateY(-1px);
      box-shadow: 0 5px 14px rgba(19, 30, 43, 0.12);
      border-color: var(--rv-accent-border);
    }

    .voiceBtn:active {
      transform: scale(0.96);
    }

    .voiceBtn.active {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      box-shadow: 0 0 0 3px var(--rv-accent-glow);
    }

    .voiceBtn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .voiceBtn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* V3: button sizes */
    .attachmentBtn,
    .voiceBtn,
    .sendBtn {
      height: 48px;
      width: 48px;
      min-width: 48px;
      border-radius: 16px;
    }

    .attachmentBtn {
      border: 1.5px solid var(--rv-border-strong);
      background: rgba(255,255,255,0.9);
      color: var(--rv-text-secondary);
      display: grid;
      place-items: center;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(19, 30, 43, 0.08);
    }
    .attachmentBtn:hover {
      border-color: var(--rv-accent-border);
      color: var(--rv-accent);
    }
    .attachmentBtn svg {
      width: 18px;
      height: 18px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .attachmentStrip {
      display: none;
      gap: 8px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .attachmentStrip.visible {
      display: flex;
    }
    .attachmentStrip::-webkit-scrollbar {
      display: none;
    }
    .attachmentPill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.08);
      background: rgba(255,255,255,0.82);
      color: var(--rv-text);
      font-size: 11.5px;
      white-space: nowrap;
    }
    .attachmentPillRemove {
      width: 18px;
      height: 18px;
      border: none;
      background: rgba(15,23,42,0.06);
      color: var(--rv-text-secondary);
      border-radius: 50%;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
    }

    .composerStatus {
      display: none;
      min-height: 16px;
      font-size: 11.5px;
      line-height: 1.35;
      color: var(--rv-text-secondary);
      padding: 0 2px;
    }

    .composerStatus.visible {
      display: block;
    }

    .composerStatus.error {
      color: #c2410c;
    }

    /* ── Panel Grabber ── */
    .panelGrabber {
      display: none;
      align-items: center;
      justify-content: center;
      height: 26px;
      border: none;
      padding: 0;
      margin: 0;
      background: transparent;
      cursor: ns-resize;
      touch-action: none;
    }

    .panel[data-resizable="true"][data-layout="phone"] .panelGrabber,
    .panel[data-resizable="true"][data-layout="tablet"] .panelGrabber {
      display: flex;
    }

    .panelGrabberHandle {
      width: 56px;
      height: 5px;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.14);
      transition: background 150ms ease, transform 150ms ease;
      pointer-events: none;
    }

    .panelGrabber:hover .panelGrabberHandle,
    .panelGrabber:focus-visible .panelGrabberHandle {
      background: rgba(255, 76, 0, 0.38);
      transform: scaleX(1.04);
    }

    .panelGrabber:focus-visible {
      outline: none;
    }

    /* ── Resize Handle ── */
    .resizeHandle {
      position: absolute;
      left: 8px;
      bottom: 8px;
      width: 20px;
      height: 20px;
      border-left: 2.5px solid var(--rv-border-strong);
      border-bottom: 2.5px solid var(--rv-border-strong);
      border-radius: 2px;
      cursor: nwse-resize;
      opacity: 0.72;
      transition: opacity 200ms ease, border-color 200ms ease;
      display: none;
      touch-action: none;
    }

    .panel[data-resizable="true"][data-layout="desktop"] .resizeHandle {
      display: block;
    }

    .resizeHandle:hover {
      opacity: 1 !important;
      border-color: var(--rv-accent);
    }

    /* ── Smart Scroll Button ── */
    .scrollBtn {
      position: absolute;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: var(--rv-surface);
      border: 1px solid var(--rv-border-strong);
      box-shadow: var(--rv-shadow-md);
      cursor: pointer;
      display: none;
      place-items: center;
      z-index: 10;
      color: var(--rv-accent);
      animation: scrollBtnIn 300ms var(--rv-ease-spring) forwards;
      transition: background 120ms ease, box-shadow 120ms ease;
    }

    .scrollBtn:hover {
      background: var(--rv-bg-alt);
      box-shadow: var(--rv-shadow-lg);
    }

    .scrollBtn.visible {
      display: grid;
    }

    .scrollBtn svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* ── Typing Indicator ── */
    .typingIndicator {
      display: none;
      align-self: flex-start;
      align-items: center;
      gap: 4px;
      padding: 10px 16px;
      border-radius: var(--rv-radius-md) var(--rv-radius-md) var(--rv-radius-md) 4px;
      background: var(--rv-accent-soft);
      border: 1px solid var(--rv-accent-border);
      max-width: 70px;
    }

    .typingIndicator.visible {
      display: flex;
    }

    .typingDot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--rv-accent);
      opacity: 0.5;
      animation: typingBounce 1.2s ease-in-out infinite;
    }
    .typingDot:nth-child(2) { animation-delay: 0.15s; }
    .typingDot:nth-child(3) { animation-delay: 0.30s; }

    /* ── Shortcuts: Empty State Cards ── */
    .shortcutsEmptyState {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 20px 8px 12px;
      animation: msgIn 400ms var(--rv-ease-spring) forwards;
    }

    .shortcutsEmptyState.visible {
      display: flex;
    }

    .shortcutsHeading {
      font-size: 14px;
      font-weight: 600;
      color: var(--rv-text-secondary);
      text-align: center;
    }

    .shortcutsGrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      width: 100%;
    }

    .shortcutCard {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-md);
      background: var(--rv-surface);
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
      text-align: left;
    }

    .shortcutCard:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      box-shadow: var(--rv-shadow-sm);
      border-left: 2px solid var(--rv-accent);
    }

    .shortcutCard:active {
      transform: scale(0.98);
    }

    .shortcutCardIcon {
      font-size: 18px;
      line-height: 1;
    }

    .shortcutCardLabel {
      font-size: 13px;
      font-weight: 600;
      color: var(--rv-text);
      line-height: 1.3;
    }

    .shortcutCardDesc {
      font-size: 11.5px;
      color: var(--rv-text-secondary);
      line-height: 1.35;
    }

    /* ── Shortcuts: Compact Chips Bar ── */
    .shortcutsBar {
      display: none;
      gap: 6px;
      padding: 8px 14px;
      overflow-x: auto;
      overflow-y: hidden;
      border-top: 1px solid var(--rv-border);
      scrollbar-width: none;
      -ms-overflow-style: none;
      animation: msgIn 300ms var(--rv-ease-spring) forwards;
    }

    .shortcutsBar::-webkit-scrollbar {
      display: none;
    }

    .shortcutsBar.visible {
      display: flex;
    }

    .shortcutChip {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      border: 1px solid var(--rv-border-strong);
      border-radius: 999px;
      background: var(--rv-surface);
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      color: var(--rv-text);
      cursor: pointer;
      white-space: nowrap;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .shortcutChip:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
    }

    .shortcutChip:active {
      transform: scale(0.97);
    }

    .shortcutChipIcon {
      font-size: 13px;
      line-height: 1;
    }

    /* ── Task Suggestion Bar ── */
    .taskSuggestion {
      display: none;
      border-top: 1px solid var(--rv-border);
      padding: 10px 14px;
      background: rgba(255, 76, 0, 0.03);
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .taskSuggestion.visible {
      display: flex;
    }

    .taskSuggestionText {
      font-size: 12.5px;
      line-height: 1.4;
      color: var(--rv-text-secondary);
      flex: 1;
      min-width: 0;
    }

    .taskSuggestionActions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }

    .taskSuggestionBtn {
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      color: var(--rv-text);
      border-radius: var(--rv-radius-sm);
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      letter-spacing: 0.01em;
      padding: 5px 10px;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .taskSuggestionBtn:hover {
      background: var(--rv-bg-alt);
    }

    .taskSuggestionBtn.primary {
      border-color: var(--rv-accent-border);
      color: var(--rv-accent);
      background: var(--rv-accent-soft);
    }
    .taskSuggestionBtn.primary:hover {
      background: rgba(255, 76, 0, 0.10);
    }

    /* ── Question Prompt ── */
    .questionPrompt {
      display: none;
      border-top: 1px solid var(--rv-border);
      border-bottom: 1px solid var(--rv-border);
      padding: 8px 14px;
      background: rgba(255, 76, 0, 0.035);
      gap: 8px;
      flex-direction: column;
    }

    .questionPrompt.visible {
      display: flex;
    }

    .questionPromptTitle {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--rv-text-secondary);
    }

    .questionPromptForm {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: min(32vh, 230px);
    }

    .questionPromptList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow-y: auto;
      max-height: min(24vh, 170px);
      padding-right: 2px;
    }

    .questionPromptItem {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .questionPromptLabel {
      font-size: 12px;
      line-height: 1.35;
      color: var(--rv-text);
      font-weight: 600;
    }

    .questionPromptInput {
      width: 100%;
      border: 1px solid var(--rv-border-strong);
      border-radius: var(--rv-radius-sm);
      padding: 8px 10px;
      font-size: 12.5px;
      line-height: 1.35;
      font-family: inherit;
      color: var(--rv-text);
      background: var(--rv-surface);
      outline: none;
    }

    .questionPromptInput:focus {
      border-color: var(--rv-accent);
      box-shadow: 0 0 0 3px var(--rv-accent-glow);
    }

    .questionPromptInput.invalid {
      border-color: #d63a1e;
      box-shadow: 0 0 0 2px rgba(214, 58, 30, 0.15);
    }

    .questionPromptActions {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      position: sticky;
      bottom: 0;
      padding-top: 2px;
      background: linear-gradient(to bottom, rgba(255, 247, 242, 0), rgba(255, 247, 242, 0.94) 40%);
    }

    .questionPromptCancel {
      border: 1px solid var(--rv-border-strong);
      background: rgba(255, 255, 255, 0.88);
      color: var(--rv-text-secondary);
      border-radius: var(--rv-radius-sm);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      padding: 6px 10px;
      cursor: pointer;
    }

    .questionPromptCancel:hover {
      background: rgba(242, 246, 250, 0.95);
    }

    .questionPromptSubmit {
      border: 1px solid var(--rv-accent-border);
      background: var(--rv-accent-soft);
      color: var(--rv-accent);
      border-radius: var(--rv-radius-sm);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.01em;
      padding: 6px 10px;
      cursor: pointer;
    }

    .questionPromptSubmit:hover {
      background: rgba(255, 76, 0, 0.1);
    }

    /* ── Conversation Pill (hidden) ── */
    .roverConversationPill {
      display: none !important;
    }
    .roverConversationPill:hover {
      background: rgba(0,0,0,0.03);
      border-color: var(--rv-border-strong);
    }
    .roverConversationPillLabel {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 200px;
    }
    .roverConversationPillArrow {
      font-size: 10px;
      opacity: .6;
    }

    /* ── Tab Bar (hidden, backward compat) ── */
    .roverTabBar {
      display: none !important;
    }

    /* ── Conversation Drawer ── */
    .conversationDrawer {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--rv-bg);
      border-right: 1px solid var(--rv-border);
      z-index: 100;
      display: flex;
      flex-direction: column;
      transform: translateX(-100%);
      transition: transform .25s var(--rv-ease-spring);
    }
    .conversationDrawer.open {
      transform: translateX(0);
    }
    .conversationDrawerHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--rv-border);
    }
    .conversationDrawerTitle {
      font-size: 14px;
      font-weight: 700;
      color: var(--rv-text);
    }
    .conversationDrawerClose {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      cursor: pointer;
      font-size: 18px;
      display: grid;
      place-items: center;
      padding: 0;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .conversationDrawerClose:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }
    .conversationList {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    .conversationItem {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background .15s, border-color .15s;
    }
    .conversationItem:hover {
      background: rgba(0,0,0,0.03);
    }
    .conversationItem.active {
      background: var(--rv-accent-soft);
      border: 1px solid var(--rv-accent-border);
    }
    .conversationDot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--rv-text-tertiary);
    }
    .conversationItem.running .conversationDot { background: var(--rv-success); }
    .conversationItem.paused .conversationDot { background: #D97706; }
    .conversationItem.completed .conversationDot { background: var(--rv-text-tertiary); }
    .conversationItem.failed .conversationDot { background: var(--rv-error); }
    .conversationItem.awaiting_user .conversationDot { background: var(--rv-info); }
    .conversationContent {
      flex: 1;
      min-width: 0;
    }
    .conversationSummary {
      font-size: 13px;
      color: var(--rv-text);
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .conversationMeta {
      font-size: 11px;
      color: var(--rv-text-tertiary);
      margin-top: 2px;
    }
    .conversationActions {
      opacity: 0;
      transition: opacity .15s;
    }
    .conversationItem:hover .conversationActions {
      opacity: 1;
    }
    .conversationDeleteBtn {
      background: var(--rv-surface);
      border: 1px solid var(--rv-border);
      color: var(--rv-text-tertiary);
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .conversationDeleteBtn:hover {
      color: var(--rv-error);
      background: rgba(220,38,38,0.06);
      border-color: rgba(220,38,38,0.25);
    }
    .conversationNewBtn {
      display: block;
      width: calc(100% - 16px);
      margin: 8px;
      padding: 10px;
      background: var(--rv-surface);
      border: 1px dashed var(--rv-border-strong);
      border-radius: 8px;
      color: var(--rv-text-secondary);
      font-size: 13px;
      cursor: pointer;
      text-align: center;
      transition: background .15s, border-color .15s, color .15s;
    }
    .conversationNewBtn:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      color: var(--rv-accent);
    }

    /* ── Paused Task Banner ── */
    .pausedTaskBanner {
      display: none;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      background: rgba(251,191,36,.08);
      border-bottom: 1px solid rgba(251,191,36,.15);
      gap: 8px;
    }
    .pausedTaskBanner.visible {
      display: flex;
    }
    .pausedTaskText {
      font-size: 12px;
      color: #fbbf24;
      flex: 1;
    }
    .pausedTaskActions {
      display: flex;
      gap: 6px;
    }
    .pausedTaskActions button {
      padding: 4px 10px;
      border-radius: 6px;
      border: none;
      font-size: 11px;
      cursor: pointer;
      font-weight: 500;
    }
    .pausedTaskResumeBtn {
      background: #fbbf24;
      color: #1a1a2e;
    }
    .pausedTaskResumeBtn:hover {
      background: #f59e0b;
    }
    .pausedTaskCancelBtn {
      background: rgba(0,0,0,0.04);
      color: var(--rv-text-secondary);
    }
    .pausedTaskCancelBtn:hover {
      background: rgba(0,0,0,0.08);
    }

    /* ── Conversation List Button ── */
    .conversationListBtn {
      width: 32px;
      height: 32px;
      border-radius: var(--rv-radius-sm);
      border: 1px solid var(--rv-border);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
      flex: 0 0 auto;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .conversationListBtn:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-border-strong);
      color: var(--rv-text);
    }

    /* ── Intent Pills ── */
    .intentPills {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 6px;
    }
    .intentPill {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 8px;
      border-radius: 999px;
      line-height: 1.4;
      background: rgba(107, 114, 128, 0.10);
      color: rgba(107, 114, 128, 0.85);
    }
    .intentPill.navigate {
      background: rgba(59, 130, 246, 0.10);
      color: rgba(59, 130, 246, 0.85);
    }
    .intentPill.read {
      background: rgba(139, 92, 246, 0.10);
      color: rgba(139, 92, 246, 0.85);
    }
    .intentPill.act {
      background: rgba(249, 115, 22, 0.10);
      color: rgba(249, 115, 22, 0.85);
    }
    .intentPill.analyze {
      background: rgba(16, 185, 129, 0.10);
      color: rgba(16, 185, 129, 0.85);
    }
    .intentPill.watch {
      background: rgba(99, 102, 241, 0.10);
      color: rgba(99, 102, 241, 0.85);
    }

    /* Dark mode intent pill overrides */
    :host(.dark) .intentPill {
      background: rgba(107, 114, 128, 0.20);
      color: rgba(156, 163, 175, 0.9);
    }
    :host(.dark) .intentPill.navigate {
      background: rgba(59, 130, 246, 0.20);
      color: rgba(96, 165, 250, 0.9);
    }
    :host(.dark) .intentPill.read {
      background: rgba(139, 92, 246, 0.20);
      color: rgba(167, 139, 250, 0.9);
    }
    :host(.dark) .intentPill.act {
      background: rgba(249, 115, 22, 0.20);
      color: rgba(251, 146, 60, 0.9);
    }
    :host(.dark) .intentPill.analyze {
      background: rgba(16, 185, 129, 0.20);
      color: rgba(52, 211, 153, 0.9);
    }
    :host(.dark) .intentPill.watch {
      background: rgba(99, 102, 241, 0.20);
      color: rgba(129, 140, 248, 0.9);
    }

    /* Leave room for floating bar when panel is coexisting with it */
    .rover[data-shell="stage"] .panel,
    .rover[data-shell="focus_stream"] .panel {
      max-height: calc(100vh - 100px);
    }

    /* ── Live Trace Mode ── */

    /* Container for trace entries (enables column-reverse in live mode) */
    .traceContainer {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .feed.liveMode .traceContainer {
      flex-direction: column-reverse; /* latest entry appears visually first */
    }

    /* Hide messages and toggle bar during live mode */
    .feed.liveMode .entry.message { display: none !important; }
    .feed.liveMode .traceToggleBar { display: none !important; }

    /* Live Stream Header */
    .liveStreamHeader {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 2px 10px;
    }

    .liveDot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--rv-accent);
      flex-shrink: 0;
      animation: livePulse 1.6s ease-in-out infinite;
    }

    .liveLabel {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--rv-accent);
    }

    .liveViewAllBtn {
      margin-left: auto;
      font-size: 11px;
      font-weight: 600;
      color: var(--rv-text-secondary);
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      font-family: inherit;
      transition: color 120ms ease;
    }
    .liveViewAllBtn:hover { color: var(--rv-accent); }

    /* Overflow Pill */
    .liveOverflowPill {
      display: none;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--rv-bg-alt);
      border: 1px solid var(--rv-border);
      font-size: 12px;
      font-weight: 600;
      color: var(--rv-text-secondary);
      cursor: pointer;
      transition: all 120ms ease;
      font-family: inherit;
      order: 99;
    }
    .liveOverflowPill:hover {
      background: var(--rv-accent-soft);
      border-color: var(--rv-accent-border);
      color: var(--rv-accent);
    }

    /* Active step card — glowing, prominent */
    .feed.liveMode .entry.trace.liveActive {
      border-color: var(--rv-accent-border);
      background: rgba(255, 255, 255, 0.94);
      box-shadow:
        0 0 0 3px rgba(255, 76, 0, 0.08),
        0 6px 24px rgba(255, 76, 0, 0.07);
      animation: liveGlow 2.4s ease-in-out infinite;
      cursor: default;
    }
    :host(.dark) .feed.liveMode .entry.trace.liveActive {
      background: rgba(30, 33, 48, 0.92);
    }

    /* Spinner on active card timestamp */
    .feed.liveMode .entry.trace.liveActive .traceTs::after {
      content: '';
      display: inline-block;
      width: 11px;
      height: 11px;
      border: 1.5px solid rgba(255, 76, 0, 0.2);
      border-top-color: var(--rv-accent);
      border-radius: 50%;
      animation: spin 0.85s linear infinite;
      vertical-align: middle;
      margin-left: 6px;
    }

    /* History steps — dimmed, slightly scaled down */
    .feed.liveMode .entry.trace.livePrev {
      opacity: 0.5;
      transform: scale(0.985);
      cursor: pointer;
    }
    .feed.liveMode .entry.trace.livePrev:hover {
      opacity: 0.72;
    }

    /* Clickable cards in live mode */
    .feed.liveMode .entry.trace { cursor: pointer; }

    /* ── Keyframes ── */
    @keyframes liveGlow {
      0%, 100% {
        box-shadow:
          0 0 0 2px rgba(255, 76, 0, 0.06),
          0 4px 16px rgba(255, 76, 0, 0.04);
      }
      50% {
        box-shadow:
          0 0 0 5px rgba(255, 76, 0, 0.11),
          0 8px 28px rgba(255, 76, 0, 0.09);
      }
    }

    @keyframes livePulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.82); }
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ── Step Hover Tooltip ── */
    .stepTooltip {
      position: fixed;
      z-index: 2147483647;
      max-width: 300px;
      padding: 10px 14px;
      background: var(--rv-surface);
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-lg);
      box-shadow: 0 8px 32px rgba(10, 14, 24, 0.14);
      font-size: 12px;
      line-height: 1.5;
      color: var(--rv-text);
      pointer-events: none;
      white-space: pre-wrap;
      word-break: break-word;
      animation: msgIn 150ms var(--rv-ease-spring) forwards;
    }
    :host(.dark) .stepTooltip {
      background: rgba(30, 33, 48, 0.95);
      border-color: rgba(255, 255, 255, 0.08);
    }
`;
