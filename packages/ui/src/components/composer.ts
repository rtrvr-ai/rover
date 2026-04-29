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

function formatFileSize(bytes: number): string {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function normalizeFileExtension(name: string): string {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : '';
}

function isFileAcceptedByGroup(file: File, groups?: Array<'images' | 'pdfs' | 'office' | 'text'>): boolean {
  const allowedGroups = Array.isArray(groups) && groups.length > 0
    ? groups
    : ['images', 'pdfs', 'office', 'text'];
  const type = String(file.type || '').toLowerCase();
  const extension = normalizeFileExtension(file.name);
  for (const group of allowedGroups) {
    if (group === 'images' && type.startsWith('image/')) return true;
    if (group === 'pdfs' && (type === 'application/pdf' || extension === '.pdf')) return true;
    if (group === 'text' && (
      type.startsWith('text/')
      || type === 'application/json'
      || extension === '.md'
      || extension === '.txt'
      || extension === '.json'
    )) return true;
    if (group === 'office' && (
      [
        '.doc',
        '.docx',
        '.ppt',
        '.pptx',
        '.xls',
        '.xlsx',
        '.csv',
        '.rtf',
      ].includes(extension)
      || [
        'application/msword',
        'application/rtf',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
      ].includes(type)
    )) return true;
  }
  return false;
}

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
  const attachmentBadge = document.createElement('span');
  attachmentBadge.className = 'attachmentCountBadge';
  attachmentBadge.setAttribute('aria-hidden', 'true');
  attachmentButton.appendChild(attachmentBadge);
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

  const attachmentInput = document.createElement('input');
  attachmentInput.type = 'file';
  attachmentInput.className = 'attachmentInput';
  attachmentInput.hidden = true;
  composer.appendChild(attachmentInput);

  const attachmentStrip = document.createElement('div');
  attachmentStrip.className = 'attachmentStrip';
  attachmentStrip.setAttribute('aria-live', 'polite');
  composer.appendChild(attachmentStrip);

  composerRow.appendChild(composerActions);
  composer.appendChild(composerRow);

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

  function setStatusMessage(message: string, tone: 'info' | 'error' = 'info'): void {
    const clean = sanitizeText(message);
    composerStatus.textContent = clean;
    composerStatus.classList.toggle('visible', !!clean);
    composerStatus.classList.toggle('error', tone === 'error' && !!clean);
  }

  function syncAttachmentUi(): void {
    attachmentStrip.innerHTML = '';
    const maxAttachments = experience.inputs?.attachmentLimit ?? DEFAULT_ATTACHMENT_LIMIT;
    pendingAttachments = pendingAttachments.slice(0, maxAttachments);
    attachmentStrip.classList.toggle('visible', pendingAttachments.length > 0);
    attachmentButton.disabled = textarea.disabled || pendingAttachments.length >= maxAttachments;
    attachmentButton.classList.toggle('hasAttachments', pendingAttachments.length > 0);
    attachmentBadge.textContent = pendingAttachments.length > 0 ? String(pendingAttachments.length) : '';
    attachmentButton.setAttribute(
      'aria-label',
      pendingAttachments.length > 0 ? `Attach files (${pendingAttachments.length} pending)` : 'Attach files',
    );
    for (let index = 0; index < pendingAttachments.length; index += 1) {
      const file = pendingAttachments[index];
      const pill = document.createElement('span');
      pill.className = 'attachmentPill';
      const icon = document.createElement('span');
      icon.className = 'attachmentPillIcon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '\u25F1';
      const body = document.createElement('span');
      body.className = 'attachmentPillBody';
      const label = document.createElement('span');
      label.className = 'attachmentPillLabel';
      label.textContent = file.name;
      const meta = document.createElement('span');
      meta.className = 'attachmentPillMeta';
      meta.textContent = formatFileSize(file.size);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'attachmentPillRemove';
      removeBtn.setAttribute('aria-label', `Remove ${file.name}`);
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', () => {
        pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
        syncAttachmentUi();
        setStatusMessage(pendingAttachments.length ? `${pendingAttachments.length} file${pendingAttachments.length === 1 ? '' : 's'} attached` : '', 'info');
      });
      body.appendChild(label);
      body.appendChild(meta);
      pill.appendChild(icon);
      pill.appendChild(body);
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
    const unsupported = nextFiles.filter(f => !isFileAcceptedByGroup(f, experience.inputs?.acceptedMimeGroups));
    const supported = nextFiles.filter(f => isFileAcceptedByGroup(f, experience.inputs?.acceptedMimeGroups));
    const tooLarge = supported.filter(f => f.size > maxBytes);
    const eligible = supported.filter(f => f.size <= maxBytes);
    const accepted = eligible.slice(0, remainingSlots);
    const overLimit = Math.max(0, eligible.length - accepted.length);
    pendingAttachments = [...pendingAttachments, ...accepted];
    syncAttachmentUi();
    if (unsupported.length || tooLarge.length || overLimit) {
      const parts: string[] = [];
      if (unsupported.length) parts.push(`${unsupported.length} unsupported`);
      if (tooLarge.length) parts.push(`${tooLarge.length} too large`);
      if (overLimit) parts.push(`${overLimit} over the file limit`);
      setStatusMessage(`Some files were not attached (${parts.join(', ')}).`, 'error');
    } else if (accepted.length) {
      setStatusMessage(`${pendingAttachments.length} file${pendingAttachments.length === 1 ? '' : 's'} attached`, 'info');
    }
  });

  voiceButton.addEventListener('click', () => {
    if (textarea.disabled) return;
    opts.onVoiceStart();
  });

  function syncTextareaHeight(): void {
    textarea.style.height = 'auto';
    const h = Math.min(96, Math.max(44, textarea.scrollHeight));
    textarea.style.height = `${h}px`;
    const bar = textarea.closest('.inputBarComposerSlot')?.closest('.inputBar') as HTMLElement | null;
    if (bar) bar.classList.toggle('expanded-text', h > 44);
  }

  textarea.addEventListener('input', () => {
    syncTextareaHeight();
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
    setStatusMessage,
    setText(value: string) {
      textarea.value = value;
      syncTextareaHeight();
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
