import type { NarrationVoicePreference, NarrationVisitorPreference } from '../audio.js';
import type { RoverSpeechVoiceOption } from '../narrator.js';

export type VoiceSettingsState = {
  available: boolean;
  enabled: boolean;
  siteLanguage: string;
  effectiveLanguage: string;
  language?: string;
  voiceURI?: string;
  voicePreference?: NarrationVoicePreference;
  voices: RoverSpeechVoiceOption[];
};

export type VoiceSettingsComponent = {
  root: HTMLDivElement;
  setOpen: (open: boolean) => void;
  update: (state: VoiceSettingsState) => void;
};

const LANGUAGE_LABELS: Record<string, string> = {
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'en-AU': 'English (Australia)',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
  'de-DE': 'German',
  'it-IT': 'Italian',
  'pt-BR': 'Portuguese (Brazil)',
  'ja-JP': 'Japanese',
  'ko-KR': 'Korean',
  'zh-CN': 'Chinese (Simplified)',
  'hi-IN': 'Hindi',
};

function normalizeLang(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .split('-')
    .map((part, index) => index === 0 ? part.toLowerCase() : part.toUpperCase())
    .join('-');
}

function languageLabel(lang: string): string {
  const normalized = normalizeLang(lang);
  return LANGUAGE_LABELS[normalized] ? `${LANGUAGE_LABELS[normalized]} (${normalized})` : normalized;
}

function uniqueLanguages(voices: RoverSpeechVoiceOption[], siteLanguage: string, browserLanguage: string): string[] {
  const values = new Set<string>();
  values.add(normalizeLang(siteLanguage) || 'en-US');
  values.add(normalizeLang(browserLanguage) || 'en-US');
  for (const voice of voices) {
    const lang = normalizeLang(voice.lang);
    if (lang) values.add(lang);
  }
  return Array.from(values).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function filterVoicesByLanguage(voices: RoverSpeechVoiceOption[], lang: string): RoverSpeechVoiceOption[] {
  const normalized = normalizeLang(lang).toLowerCase();
  const base = normalized.split('-')[0];
  const matches = voices.filter(voice => {
    const voiceLang = normalizeLang(voice.lang).toLowerCase();
    return voiceLang === normalized || (!!base && voiceLang.startsWith(`${base}-`));
  });
  return matches.length ? matches : voices;
}

export function createVoiceSettingsPanel(input: {
  agentName: string;
  onChange: (patch: NarrationVisitorPreference) => void;
  onReset: () => void;
  onClose: () => void;
}): VoiceSettingsComponent {
  let state: VoiceSettingsState = {
    available: false,
    enabled: false,
    siteLanguage: 'en-US',
    effectiveLanguage: 'en-US',
    voices: [],
  };

  const root = document.createElement('div');
  root.className = 'voiceSettingsPanel';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Voice and language');

  const header = document.createElement('div');
  header.className = 'voiceSettingsHeader';
  const title = document.createElement('div');
  title.className = 'voiceSettingsTitle';
  title.textContent = 'Voice & language';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'voiceSettingsClose';
  close.setAttribute('aria-label', 'Close voice settings');
  close.textContent = '\u00d7';
  header.appendChild(title);
  header.appendChild(close);

  const body = document.createElement('div');
  body.className = 'voiceSettingsBody';

  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'voiceSettingsToggle';
  const enabledInput = document.createElement('input');
  enabledInput.type = 'checkbox';
  const enabledText = document.createElement('span');
  enabledText.textContent = 'Read guided steps aloud';
  enabledLabel.appendChild(enabledInput);
  enabledLabel.appendChild(enabledText);

  const languageLabelEl = document.createElement('label');
  languageLabelEl.className = 'voiceSettingsField';
  const languageText = document.createElement('span');
  languageText.textContent = 'Language';
  const languageSelect = document.createElement('select');
  languageLabelEl.appendChild(languageText);
  languageLabelEl.appendChild(languageSelect);

  const voiceLabelEl = document.createElement('label');
  voiceLabelEl.className = 'voiceSettingsField';
  const voiceText = document.createElement('span');
  voiceText.textContent = 'Voice';
  const voiceSelect = document.createElement('select');
  voiceLabelEl.appendChild(voiceText);
  voiceLabelEl.appendChild(voiceSelect);

  const preferenceLabel = document.createElement('label');
  preferenceLabel.className = 'voiceSettingsField';
  const preferenceText = document.createElement('span');
  preferenceText.textContent = 'Voice style';
  const preferenceSelect = document.createElement('select');
  [
    ['auto', 'Best available'],
    ['natural', 'Prefer natural voices'],
    ['system', 'Prefer system voices'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    preferenceSelect.appendChild(option);
  });
  preferenceLabel.appendChild(preferenceText);
  preferenceLabel.appendChild(preferenceSelect);

  const hint = document.createElement('p');
  hint.className = 'voiceSettingsHint';

  const actions = document.createElement('div');
  actions.className = 'voiceSettingsActions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'voiceSettingsReset';
  reset.textContent = 'Use site default';
  actions.appendChild(reset);

  body.appendChild(enabledLabel);
  body.appendChild(languageLabelEl);
  body.appendChild(voiceLabelEl);
  body.appendChild(preferenceLabel);
  body.appendChild(hint);
  body.appendChild(actions);
  root.appendChild(header);
  root.appendChild(body);

  function render(): void {
    enabledInput.checked = state.enabled;
    enabledInput.disabled = !state.available;

    const browserLanguage = typeof navigator !== 'undefined' ? (navigator.language || 'en-US') : 'en-US';
    const languages = uniqueLanguages(state.voices, state.siteLanguage, browserLanguage);
    const effectiveLanguage = normalizeLang(state.language || state.effectiveLanguage || state.siteLanguage || browserLanguage || 'en-US') || 'en-US';
    languageSelect.innerHTML = '';
    const siteOption = document.createElement('option');
    siteOption.value = '';
    siteOption.textContent = `Site default (${languageLabel(state.siteLanguage || 'en-US')})`;
    languageSelect.appendChild(siteOption);
    for (const lang of languages) {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = languageLabel(lang);
      languageSelect.appendChild(option);
    }
    languageSelect.value = state.language ? effectiveLanguage : '';
    languageSelect.disabled = !state.available;

    const matchingVoices = filterVoicesByLanguage(state.voices, effectiveLanguage);
    voiceSelect.innerHTML = '';
    const defaultVoice = document.createElement('option');
    defaultVoice.value = '';
    defaultVoice.textContent = 'Browser default';
    voiceSelect.appendChild(defaultVoice);
    for (const voice of matchingVoices) {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name}${voice.lang ? ` (${voice.lang})` : ''}`;
      voiceSelect.appendChild(option);
    }
    voiceSelect.value = state.voiceURI || '';
    voiceSelect.disabled = !state.available || matchingVoices.length === 0;

    preferenceSelect.value = state.voicePreference || 'auto';
    preferenceSelect.disabled = !state.available;

    hint.textContent = state.available
      ? `${input.agentName} uses this language for spoken step narration and microphone dictation on this site.`
      : 'Voice narration is unavailable in this browser or disabled by this site.';
  }

  enabledInput.addEventListener('change', () => input.onChange({ enabled: enabledInput.checked }));
  languageSelect.addEventListener('change', () => input.onChange({ language: languageSelect.value || undefined, voiceURI: undefined }));
  voiceSelect.addEventListener('change', () => input.onChange({ voiceURI: voiceSelect.value || undefined }));
  preferenceSelect.addEventListener('change', () => input.onChange({ voicePreference: preferenceSelect.value as NarrationVoicePreference }));
  reset.addEventListener('click', () => input.onReset());
  close.addEventListener('click', () => input.onClose());

  return {
    root,
    setOpen(open: boolean) {
      root.classList.toggle('visible', open);
      root.setAttribute('aria-hidden', open ? 'false' : 'true');
    },
    update(nextState: VoiceSettingsState) {
      state = { ...state, ...nextState, voices: nextState.voices || [] };
      render();
    },
  };
}
