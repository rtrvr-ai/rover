import type { RoverExperienceConfig, RoverVoiceConfig } from '../types.js';
import { sanitizeText, DEFAULT_ATTACHMENT_LIMIT, DEFAULT_ATTACHMENT_MAX_FILE_SIZE_MB, buildAttachmentAccept } from '../config.js';

export type ComposerOptions = {
  agentName: string;
  experience: RoverExperienceConfig;
  onSubmit: (text: string, attachments: File[]) => void;
  onVoiceStart: () => void;
  onVoiceStop: () => void;
};

export type ComposerComponent = {
  root: HTMLFormElement;
  textarea: HTMLTextAreaElement;
  attachmentButton: HTMLButtonElement;
  attachmentInput: HTMLInputElement;
  attachmentStrip: HTMLDivElement;
  voiceButton: HTMLButtonElement;
  sendButton: HTMLButtonElement;
  statusEl: HTMLDivElement;
  getPendingAttachments: () => File[];
  clearAttachments: () => void;
  setDisabled: (disabled: boolean) => void;
  setSendAsStop: (running: boolean, onStop: () => void) => void;
  setVoiceActive: (active: boolean) => void;
  setVoiceVisible: (visible: boolean) => void;
  setStatusMessage: (message: string, tone?: 'info' | 'error') => void;
  setText: (value: string) => void;
  setStaticPlaceholder: (text: string) => void;
  setPlaceholders: (phrases: string[]) => void;
  update: (experience: RoverExperienceConfig) => void;
  syncAttachmentUi: () => void;
};

let activePhrases: string[] = [
  'Fill this form for me...',
  'Find the best option here...',
  'Help me get started...',
  'What can you do for me?',
];

export function createComposer(opts: ComposerOptions): ComposerComponent {
  const { agentName } = opts;
  let experience = opts.experience;
  let pendingAttachments: File[] = [];

  const composer = document.createElement('form');
  composer.className = 'composer';

  const composerRow = document.createElement('div');
  composerRow.className = 'composerRow';

  const textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.placeholder = '';
  composerRow.appendChild(textarea);

  const placeholderOverlay = document.createElement('div');
  placeholderOverlay.className = 'composerPlaceholder';
  const placeholderText = document.createElement('span');
  placeholderText.className = 'composerPlaceholderText';
  placeholderText.textContent = activePhrases[0];
  placeholderOverlay.appendChild(placeholderText);
  composerRow.appendChild(placeholderOverlay);

  const composerActions = document.createElement('div');
  composerActions.className = 'composerActions';

  const attachmentButton = document.createElement('button');
  attachmentButton.type = 'button';
  attachmentButton.className = 'attachmentBtn';
  attachmentButton.setAttribute('aria-label', 'Attach files');
  attachmentButton.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>';
  composerActions.appendChild(attachmentButton);

  const voiceButton = document.createElement('button');
  voiceButton.type = 'button';
  voiceButton.className = 'voiceBtn';
  voiceButton.setAttribute('aria-label', 'Start voice dictation');
  voiceButton.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v3"></path><path d="M8 21h8"></path></svg>';
  composerActions.appendChild(voiceButton);

  const sendButton = document.createElement('button');
  sendButton.type = 'submit';
  sendButton.className = 'sendBtn';
  const sendArrowSvg = '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  const stopSquareSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  sendButton.innerHTML = sendArrowSvg;
  composerActions.appendChild(sendButton);

  let inStopMode = false;
  let stopHandler: (() => void) | null = null;

  composerRow.appendChild(composerActions);
  composer.appendChild(composerRow);

  const attachmentInput = document.createElement('input');
  attachmentInput.type = 'file';
  attachmentInput.className = 'attachmentInput';
  attachmentInput.hidden = true;
  composer.appendChild(attachmentInput);

  const attachmentStrip = document.createElement('div');
  attachmentStrip.className = 'attachmentStrip';
  composer.appendChild(attachmentStrip);

  const composerStatus = document.createElement('div');
  composerStatus.className = 'composerStatus';
  composerStatus.setAttribute('aria-live', 'polite');
  composer.appendChild(composerStatus);

  function syncAttachmentInputConfig(): void {
    const allowFiles = experience.inputs?.files !== false;
    attachmentButton.style.display = allowFiles ? '' : 'none';
    attachmentInput.multiple = experience.inputs?.allowMultipleFiles !== false;
    attachmentInput.accept = buildAttachmentAccept(experience.inputs?.acceptedMimeGroups);
  }

  function syncAttachmentUi(): void {
    attachmentStrip.innerHTML = '';
    const maxAttachments = experience.inputs?.attachmentLimit ?? DEFAULT_ATTACHMENT_LIMIT;
    pendingAttachments = pendingAttachments.slice(0, maxAttachments);
    attachmentStrip.classList.toggle('visible', pendingAttachments.length > 0);
    attachmentButton.disabled = textarea.disabled || pendingAttachments.length >= maxAttachments;
    for (let index = 0; index < pendingAttachments.length; index += 1) {
      const file = pendingAttachments[index];
      const pill = document.createElement('span');
      pill.className = 'attachmentPill';
      const label = document.createElement('span');
      label.className = 'attachmentPillLabel';
      label.textContent = file.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'attachmentPillRemove';
      removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', () => {
        pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
        syncAttachmentUi();
      });
      pill.appendChild(label);
      pill.appendChild(removeBtn);
      attachmentStrip.appendChild(pill);
    }
  }

  attachmentButton.addEventListener('click', () => {
    if (attachmentButton.disabled) return;
    attachmentInput.click();
  });

  attachmentInput.addEventListener('change', () => {
    const nextFiles = Array.from(attachmentInput.files || []);
    attachmentInput.value = '';
    if (nextFiles.length === 0) return;
    const maxCount = experience.inputs?.attachmentLimit ?? DEFAULT_ATTACHMENT_LIMIT;
    const maxBytes = (experience.inputs?.maxFileSizeMb ?? DEFAULT_ATTACHMENT_MAX_FILE_SIZE_MB) * 1024 * 1024;
    const remainingSlots = Math.max(0, maxCount - pendingAttachments.length);
    const accepted = nextFiles.filter(f => f.size <= maxBytes).slice(0, remainingSlots);
    pendingAttachments = [...pendingAttachments, ...accepted];
    syncAttachmentUi();
  });

  voiceButton.addEventListener('click', () => {
    if (textarea.disabled) return;
    opts.onVoiceStart();
  });

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(96, Math.max(44, textarea.scrollHeight))}px`;
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  let phraseIndex = 0;
  let placeholderTimer: ReturnType<typeof setInterval> | null = null;

  function updatePlaceholderVisibility(): void {
    placeholderOverlay.style.display = !textarea.value.trim() ? '' : 'none';
  }

  function cyclePlaceholder(): void {
    placeholderText.classList.add('fading');
    setTimeout(() => {
      phraseIndex = (phraseIndex + 1) % activePhrases.length;
      placeholderText.textContent = activePhrases[phraseIndex];
      placeholderText.classList.remove('fading');
    }, 220);
  }

  textarea.addEventListener('blur', () => updatePlaceholderVisibility());
  textarea.addEventListener('input', () => updatePlaceholderVisibility());

  placeholderTimer = setInterval(cyclePlaceholder, 4000);

  // Stop-mode click handler (bypasses form submit)
  sendButton.addEventListener('click', (e) => {
    if (inStopMode && stopHandler) {
      e.preventDefault();
      e.stopPropagation();
      stopHandler();
    }
  });

  composer.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (inStopMode) return;
    if (textarea.disabled) return;
    const text = sanitizeText(textarea.value);
    opts.onSubmit(text, pendingAttachments.slice());
  });

  syncAttachmentInputConfig();
  syncAttachmentUi();

  return {
    root: composer,
    textarea,
    attachmentButton,
    attachmentInput,
    attachmentStrip,
    voiceButton,
    sendButton,
    statusEl: composerStatus,
    getPendingAttachments: () => pendingAttachments.slice(),
    clearAttachments() {
      pendingAttachments = [];
      syncAttachmentUi();
    },
    setDisabled(disabled: boolean) {
      textarea.disabled = disabled;
      attachmentButton.disabled = disabled;
      attachmentInput.disabled = disabled;
      voiceButton.disabled = disabled;
      // Keep send button enabled in stop mode so user can cancel
      if (!inStopMode) {
        sendButton.disabled = disabled;
      }
      syncAttachmentUi();
    },
    setSendAsStop(running: boolean, onStop: () => void) {
      inStopMode = running;
      stopHandler = running ? onStop : null;
      if (running) {
        sendButton.innerHTML = stopSquareSvg;
        sendButton.classList.add('stopMode');
        sendButton.disabled = false;
        sendButton.type = 'button';
      } else {
        sendButton.innerHTML = sendArrowSvg;
        sendButton.classList.remove('stopMode');
        sendButton.type = 'submit';
      }
    },
    setVoiceActive(active: boolean) {
      voiceButton.classList.toggle('active', active);
      voiceButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      voiceButton.setAttribute('aria-label', active ? 'Stop voice dictation' : 'Start voice dictation');
    },
    setVoiceVisible(visible: boolean) {
      voiceButton.classList.toggle('visible', visible);
    },
    setStatusMessage(message: string, tone: 'info' | 'error' = 'info') {
      const clean = sanitizeText(message);
      composerStatus.textContent = clean;
      composerStatus.classList.toggle('visible', !!clean);
      composerStatus.classList.toggle('error', tone === 'error' && !!clean);
    },
    setText(value: string) {
      textarea.value = value;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(96, Math.max(44, textarea.scrollHeight))}px`;
    },
    setStaticPlaceholder(text: string) {
      textarea.placeholder = text;
      if (text) {
        placeholderOverlay.style.display = 'none';
      } else {
        updatePlaceholderVisibility();
      }
    },
    setPlaceholders(phrases: string[]) {
      if (!phrases.length) return;
      activePhrases = phrases;
      phraseIndex = 0;
      placeholderText.textContent = activePhrases[0];
      updatePlaceholderVisibility();
    },
    update(nextExperience: RoverExperienceConfig) {
      experience = nextExperience;
      syncAttachmentInputConfig();
      syncAttachmentUi();
    },
    syncAttachmentUi,
  };
}
