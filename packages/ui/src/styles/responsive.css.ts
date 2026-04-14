export const responsiveStyles = `
    /* ── Mobile Responsive ── */
    @media (max-width: 640px) {
      .launcher {
        right: calc(14px + env(safe-area-inset-right));
        bottom: calc(14px + env(safe-area-inset-bottom));
        width: 52px;
        height: 52px;
        border-radius: var(--rv-radius-lg);
      }

      .panel {
        min-width: 0;
        min-height: 0;
        border-radius: var(--rv-radius-xl);
      }

      .header {
        padding: 10px 12px;
        gap: 8px;
        min-height: 48px;
      }

      .avatar {
        width: 32px;
        height: 32px;
      }

      .title {
        font-size: 13px;
      }

      .status {
        font-size: 11px;
      }

      .sizeBtn,
      .overflowBtn,
      .closeBtn {
        width: 36px;
        height: 36px;
      }

      .modeLabel {
        font-size: 9px;
        padding: 1px 4px;
      }

      .bubble {
        font-size: 13px;
        padding: 9px 12px;
      }

      .composer {
        padding: 10px 12px;
      }

      .composer textarea {
        min-height: 40px;
        font-size: 13px;
        padding: 9px 11px;
      }

      .sendBtn {
        height: 40px;
        width: 40px;
        min-width: 40px;
      }

      .feed {
        padding: 12px 12px 8px;
        gap: 8px;
      }

      .shortcutsGrid {
        grid-template-columns: 1fr;
      }

      .shortcutsBar {
        padding: 6px 12px;
      }

      .questionPrompt {
        padding: 8px 12px;
      }

      .questionPromptForm {
        max-height: min(34vh, 210px);
      }

      .questionPromptList {
        max-height: min(26vh, 150px);
      }

      .questionPromptLabel {
        font-size: 11.5px;
      }

      .questionPromptInput {
        font-size: 12px;
      }

      .greetingBubble {
        right: calc(14px + env(safe-area-inset-right));
        bottom: calc(76px + env(safe-area-inset-bottom));
        max-width: 190px;
        padding: 8px 22px 8px 10px;
      }

      .roverTabBar {
        padding: 4px 8px;
      }

      .conversationDrawer {
        width: 100%;
      }

      /* V3 mobile overrides */
      .launcher {
        max-width: calc(100vw - 20px);
        min-width: 188px;
        height: 64px;
        padding: 7px 12px 7px 8px;
      }
      .launcherMedia {
        width: 48px;
        height: 48px;
      }
      .launcherLabel {
        max-width: 180px;
      }
      .taskStage {
        padding: 8px 14px 12px;
      }
      .taskStageTitle {
        font-size: 20px;
      }
      .artifactStage,
      .feed {
        margin: 0;
        padding-left: 14px;
        padding-right: 14px;
      }
      .artifactStage {
        margin: 0 14px 10px;
      }
      .composer {
        padding: 12px 14px 16px;
      }
      .attachmentBtn,
      .voiceBtn,
      .sendBtn {
        height: 44px;
        width: 44px;
        min-width: 44px;
      }
      .composer textarea {
        min-height: 52px;
      }
      /* Input bar mobile */
      .inputBar {
        max-width: calc(100vw - 16px);
        min-height: 56px;
        bottom: 16px;
      }
    }
`;
