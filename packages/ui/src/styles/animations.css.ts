export const animationStyles = `
    /* ── Keyframe Animations ── */
    @keyframes panelOpen {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes panelClose {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(12px) scale(0.96); }
    }
    @keyframes msgIn {
      from { opacity: 0; transform: translateY(8px) scale(0.98); filter: blur(2px); }
      to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
    }
    @keyframes launcherPulse {
      0%, 100% { box-shadow: 0 18px 44px rgba(255, 76, 0, 0.25), 0 0 0 0 rgba(255, 76, 0, 0.12); }
      50%      { box-shadow: 0 18px 44px rgba(255, 76, 0, 0.30), 0 0 0 8px rgba(255, 76, 0, 0.04); }
    }
    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30%           { transform: translateY(-4px); }
    }
    @keyframes livePulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.5; transform: scale(0.85); }
    }
    @keyframes scrollBtnIn {
      from { opacity: 0; transform: translateY(8px) scale(0.9); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes executionSlide {
      0% { left: -40%; }
      100% { left: 100%; }
    }
    @keyframes greetingIn {
      0%   { opacity: 0; transform: translateY(8px) scale(0.97); }
      70%  { opacity: 1; transform: translateY(-1px) scale(1.005); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes greetingOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(4px) scale(0.98); }
    }
    @keyframes dotPulse {
      0%, 100% { opacity: 0.3; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.15); }
    }
    @keyframes textReveal {
      from { opacity: 0; transform: translateY(3px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Phase 3/4 Morph Transition Keyframes ── */
    @keyframes seedBreathe {
      0%, 100% { transform: scale(1); box-shadow: 0 18px 44px rgba(10, 14, 24, 0.14), 0 0 0 1px rgba(255,255,255,0.34); }
      50%      { transform: scale(1.015); box-shadow: 0 22px 50px rgba(10, 14, 24, 0.18), 0 0 0 1px rgba(255,255,255,0.44); }
    }
    @keyframes seedOrbit {
      0%   { transform: rotate(0deg) translateX(6px) rotate(0deg); }
      100% { transform: rotate(360deg) translateX(6px) rotate(-360deg); }
    }
    @keyframes panelMorphIn {
      0%   { opacity: 0; transform: scale(0.3); filter: blur(6px); border-radius: 999px; }
      60%  { opacity: 1; filter: blur(1px); }
      100% { opacity: 1; transform: scale(1); filter: blur(0); border-radius: 28px; }
    }
    @keyframes panelMorphOut {
      0%   { opacity: 1; transform: scale(1); filter: blur(0); border-radius: 28px; }
      100% { opacity: 0; transform: scale(0.3); filter: blur(6px); border-radius: 999px; }
    }
    @keyframes seedShrink {
      0%   { opacity: 1; transform: scale(1); filter: blur(0); }
      100% { opacity: 0; transform: scale(0.9); filter: blur(4px); }
    }
    @keyframes seedExpand {
      0%   { opacity: 0; transform: scale(0.9); filter: blur(4px); }
      100% { opacity: 1; transform: scale(1); filter: blur(0); }
    }
    @keyframes shimmerSweep {
      0%   { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes moodGlow {
      0%, 100% { opacity: 0.6; }
      50%      { opacity: 1; }
    }
    @keyframes barOpen {
      0%   { opacity: 0; transform: translateX(-50%) translateY(12px) scaleX(0.85); }
      60%  { opacity: 1; transform: translateX(-50%) translateY(-2px) scaleX(1.01); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0) scaleX(1); }
    }
    @keyframes barClose {
      from { opacity: 1; transform: translateX(-50%) translateY(0) scaleX(1); }
      to   { opacity: 0; transform: translateX(-50%) translateY(8px) scaleX(0.9); }
    }

    /* ── Reduced Motion ── */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
`;
