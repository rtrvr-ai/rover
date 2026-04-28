export const baseStyles = `
    /* ── Self-hosted font ── */
    @font-face {
      font-family: 'Manrope';
      font-style: normal;
      font-weight: 400 800;
      font-display: swap;
      src: url('https://rover.rtrvr.ai/rover/fonts/manrope-latin.woff2') format('woff2');
    }

    /* ── Design Token Overhaul ── */
    :host {
      all: initial;
      --rv-accent: #FF4C00;
      --rv-accent-hover: #E64400;
      --rv-accent-soft: rgba(255, 76, 0, 0.06);
      --rv-accent-border: rgba(255, 76, 0, 0.14);
      --rv-accent-glow: rgba(255, 76, 0, 0.10);
      --rv-action-spotlight: #FF4C00;
      --rv-action-spotlight-rgb: 255, 76, 0;
      --rv-action-spotlight-fill: rgba(255, 76, 0, 0.045);
      --rv-action-spotlight-halo: rgba(255, 76, 0, 0.12);
      --rv-action-spotlight-glow: rgba(255, 76, 0, 0.18);
      --rv-action-spotlight-pulse: rgba(255, 76, 0, 0.22);
      --rv-action-spotlight-pulse-soft: rgba(255, 76, 0, 0.06);
      --rv-action-spotlight-dark-fill: rgba(255, 76, 0, 0.07);
      --rv-action-spotlight-dark-halo: rgba(255, 76, 0, 0.16);
      --rv-action-spotlight-dark-glow: rgba(255, 76, 0, 0.22);
      --rv-bg: #FAFAF7;
      --rv-bg-alt: #F3F1EC;
      --rv-surface: #FFFFFF;
      --rv-text: #1A1A19;
      --rv-text-secondary: #6B6B6B;
      --rv-text-tertiary: #9A9A9A;
      --rv-border: rgba(0, 0, 0, 0.06);
      --rv-border-strong: rgba(0, 0, 0, 0.10);
      --rv-success: #059669;
      --rv-success-soft: rgba(5, 150, 105, 0.08);
      --rv-error: #DC2626;
      --rv-info: #3B82F6;
      --rv-radius-sm: 8px;
      --rv-radius-md: 12px;
      --rv-radius-lg: 16px;
      --rv-radius-xl: 20px;
      --rv-radius-2xl: 28px;
      --rv-ease-spring: cubic-bezier(0.16, 1, 0.3, 1);
      --rv-ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
      --rv-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.03);
      --rv-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.03);
      --rv-shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04);
      --rv-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.10), 0 8px 20px rgba(0, 0, 0, 0.05);

      /* Motion tokens */
      --rv-dur-micro: 120ms;
      --rv-dur-fast: 200ms;
      --rv-dur-normal: 320ms;
      --rv-dur-slow: 480ms;
      --rv-dur-dramatic: 640ms;
      --rv-dur-ambient: 3600ms;
      --rv-ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
      --rv-ease-decel: cubic-bezier(0, 0, 0.2, 1);

      /* Surface tokens */
      --rv-surface-blur: 24px;
      --rv-surface-bg: rgba(255, 255, 255, 0.78);

      /* Dimensional tokens */
      --rv-blur-backdrop: 12px;
      --rv-perspective: 1200px;

      /* Sizing tokens */
      --rv-seed-width: 212px;
      --rv-seed-height: 72px;
      --rv-window-width: 640px;
      --rv-window-height: 760px;
      --rv-window-radius: 28px;
    }

    /* ── Dark Mode ── */
    :host(.dark) {
      --rv-bg: #0F1117;
      --rv-bg-alt: #1A1D27;
      --rv-surface: #1E2130;
      --rv-text: #E8E9ED;
      --rv-text-secondary: #9BA1B0;
      --rv-text-tertiary: #6B7280;
      --rv-border: rgba(255, 255, 255, 0.06);
      --rv-border-strong: rgba(255, 255, 255, 0.10);
      --rv-shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08);
      --rv-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.16), 0 2px 4px rgba(0, 0, 0, 0.10);
      --rv-shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.24), 0 4px 12px rgba(0, 0, 0, 0.14);
      --rv-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.32), 0 8px 20px rgba(0, 0, 0, 0.18);
    }

    /* ── Reset ── */
    .rover {
      all: initial;
      font-family: 'Manrope', system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    .rover * { box-sizing: border-box; }

    /* ── Expandable Content ── */
    .expandableWrap { white-space: pre-wrap; word-break: break-word; }
    .expandToggle {
      display: inline;
      border: none;
      background: transparent;
      color: var(--rv-accent);
      font-size: inherit;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      padding: 0 2px;
    }
    .expandToggle:hover { text-decoration: underline; }

    /* ── Rich Content Elements ── */
    .rvKv {
      display: flex;
      gap: 6px;
      padding: 1px 0;
      line-height: 1.5;
    }
    .rvKvLabel {
      color: var(--rv-text-tertiary);
      font-weight: 600;
      font-size: 12px;
      flex: 0 0 auto;
      white-space: nowrap;
    }
    .rvKvLabel::after { content: ':'; }
    .rvKvValue {
      color: var(--rv-text);
      font-size: 13px;
      word-break: break-word;
      min-width: 0;
    }

    .rvList {
      margin: 4px 0;
      padding-left: 16px;
      list-style: disc;
    }
    .rvList li {
      padding: 1px 0;
      line-height: 1.45;
      font-size: 13px;
      color: var(--rv-text);
    }

    .rvSep {
      border: none;
      border-top: 1px solid var(--rv-border);
      margin: 6px 0;
    }

    .rvStepHeader {
      font-weight: 700;
      font-size: 12px;
      color: var(--rv-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 4px 0 2px;
    }

    .rvError {
      color: #dc2626;
      font-weight: 600;
      font-size: 13px;
      padding: 2px 0;
    }

    .rvNext {
      color: var(--rv-text-secondary);
      font-size: 12.5px;
      font-style: italic;
      padding: 1px 0;
    }

    .rvLink {
      color: var(--rv-accent);
      text-decoration: none;
      font-weight: 500;
      word-break: break-all;
    }
    .rvLink:hover {
      text-decoration: underline;
    }

    .rvLine {
      padding: 1px 0;
      line-height: 1.5;
    }

    .rvStructuredCard {
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      border-radius: var(--rv-radius-sm);
      padding: 8px 10px;
      margin: 6px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rvStructuredHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .rvStructuredLabel {
      font-size: 12px;
      font-weight: 700;
      color: var(--rv-text);
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rvStructuredType {
      font-size: 11px;
      color: var(--rv-text-secondary);
      border: 1px solid var(--rv-border);
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
      flex: 0 0 auto;
      background: var(--rv-bg-alt);
    }

    .rvStructuredBody {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredPrimitive {
      font-size: 12.5px;
      color: var(--rv-text);
      line-height: 1.45;
      word-break: break-word;
    }

    .rvStructuredPrimitive.isNull {
      color: var(--rv-text-tertiary);
      font-style: italic;
    }

    .rvStructuredArray,
    .rvStructuredObject {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredObjectRows {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredRow {
      display: grid;
      grid-template-columns: minmax(88px, 130px) 1fr;
      gap: 8px;
      align-items: start;
    }

    .rvStructuredKey {
      font-size: 11px;
      font-weight: 700;
      color: var(--rv-text-secondary);
      word-break: break-word;
      padding-top: 2px;
    }

    .rvStructuredValue {
      min-width: 0;
    }

    .rvStructuredList {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvStructuredItem {
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-sm);
      background: rgba(0, 0, 0, 0.01);
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .rvStructuredItemLabel {
      font-size: 11px;
      font-weight: 700;
      color: var(--rv-text-secondary);
    }

    .rvStructuredItemBody {
      min-width: 0;
    }

    .rvStructuredEmpty,
    .rvStructuredCapped {
      color: var(--rv-text-tertiary);
      font-size: 12px;
      font-style: italic;
    }

    .rvStructuredControls {
      display: flex;
      justify-content: flex-start;
    }

    .rvStructuredMore {
      border: 1px solid var(--rv-border-strong);
      background: var(--rv-surface);
      color: var(--rv-text-secondary);
      font-size: 11.5px;
      font-weight: 600;
      border-radius: var(--rv-radius-sm);
      padding: 4px 8px;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .rvStructuredMore:hover {
      background: var(--rv-bg-alt);
      border-color: var(--rv-accent-border);
      color: var(--rv-text);
    }

    .rvRawToggleWrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .rvRawToggle {
      align-self: flex-start;
      border: none;
      background: transparent;
      color: var(--rv-accent);
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
    }

    .rvRawToggle:hover {
      text-decoration: underline;
    }

    .rvRawJson {
      margin: 0;
      border: 1px solid var(--rv-border);
      border-radius: var(--rv-radius-sm);
      background: #fff;
      padding: 8px;
      font-size: 11px;
      line-height: 1.45;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--rv-text-secondary);
    }

    .rvTable {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }

    .rvTable th,
    .rvTable td {
      border: 1px solid var(--rv-border);
      padding: 4px 6px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }

    .rvTable th {
      background: var(--rv-bg-alt);
      color: var(--rv-text-secondary);
      font-weight: 700;
    }

    /* Override inherited pre-wrap inside bubbles and trace details */
    .rvKv,
    .rvList,
    .rvLine,
    .rvStepHeader,
    .rvError,
    .rvNext {
      white-space: normal;
    }
`;
