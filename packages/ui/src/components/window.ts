import type {
  RoverExperienceConfig,
  RoverMessageBlock,
  RoverTimelineEvent,
  RoverTaskSuggestion,
  RoverAskUserQuestion,
  ConversationListItem,
  RoverTabInfo,
  RoverSheetPreset,
  RoverViewportMetrics,
  RoverDesktopPanelState,
  RoverPanelLayoutKey,
  RoverSheetPanelState,
} from '../types.js';
import {
  sanitizeText,
  PANEL_DESKTOP_DEFAULT_WIDTH,
  PANEL_DESKTOP_DEFAULT_HEIGHT,
  PANEL_DESKTOP_MIN_WIDTH,
  PANEL_DESKTOP_MIN_HEIGHT,
  PANEL_DESKTOP_MAX_WIDTH,
  PANEL_DESKTOP_MARGIN,
  PANEL_PHONE_BOTTOM_OFFSET,
} from '../config.js';
import {
  clampNumber,
  getViewportMetrics,
  clampDesktopPanelState,
  getDefaultDesktopPanelState,
  normalizeStoredDesktopPanelState,
  normalizeSheetPreset,
  getSheetPresetHeights,
  findNearestSheetPreset,
} from '../layout.js';
import { formatTime } from '../dom-helpers.js';
import {
  readPanelStorageState,
  writePanelStorageState,
  buildPanelStorageKey,
} from '../storage.js';

export type WindowOptions = {
  panelResizable: boolean;
  experience: RoverExperienceConfig;
  agentName: string;
  onClose: () => void;
};

export type WindowComponent = {
  panel: HTMLDivElement;
  backdrop: HTMLButtonElement;
  panelGrabber: HTMLDivElement;
  resizeHandle: HTMLDivElement;
  // Task stage elements
  taskStage: HTMLElement;
  taskStageTitle: HTMLDivElement;
  taskStageStatusPill: HTMLSpanElement;
  taskStageMeta: HTMLDivElement;
  taskStageEyebrow: HTMLSpanElement;
  // Artifact stage
  artifactStage: HTMLElement;
  artifactStageBody: HTMLDivElement;
  artifactStageToggle: HTMLButtonElement;
  artifactStageEmpty: HTMLDivElement;
  // Task suggestion
  taskSuggestion: HTMLDivElement;
  taskSuggestionTextEl: HTMLDivElement;
  taskSuggestionPrimaryBtn: HTMLButtonElement;
  taskSuggestionSecondaryBtn: HTMLButtonElement;
  // Question prompt
  questionPrompt: HTMLDivElement;
  questionPromptForm: HTMLFormElement;
  questionPromptList: HTMLDivElement;
  questionPromptCancel: HTMLButtonElement;
  questionPromptSubmit: HTMLButtonElement;
  // Conversation
  conversationPill: HTMLDivElement;
  conversationDrawer: HTMLDivElement;
  conversationList: HTMLDivElement;
  conversationPillLabel: HTMLSpanElement;
  conversationDrawerCloseBtn: HTMLButtonElement;
  conversationNewBtn: HTMLButtonElement;
  // Paused task
  pausedTaskBanner: HTMLDivElement;
  // Layout
  applyLayout: () => void;
  cyclePanelSize: () => void;
  syncChrome: () => void;
  getViewportMetrics: () => RoverViewportMetrics;
  destroy: () => void;
};

export function createWindow(opts: WindowOptions): WindowComponent {
  const { panelResizable, agentName } = opts;
  let experience = opts.experience;
  const panelStorageKey = buildPanelStorageKey();

  // Panel backdrop
  const panelBackdrop = document.createElement('button');
  panelBackdrop.type = 'button';
  panelBackdrop.className = 'panelBackdrop';
  panelBackdrop.setAttribute('aria-label', 'Close Rover');
  panelBackdrop.tabIndex = -1;
  panelBackdrop.addEventListener('click', () => opts.onClose());

  // Panel
  const panel = document.createElement('div');
  panel.className = 'panel';

  // Panel grabber (mobile sheet handle)
  const panelGrabber = document.createElement('div');
  panelGrabber.className = 'panelGrabber';
  panelGrabber.setAttribute('aria-hidden', 'true');
  const panelGrabberHandle = document.createElement('span');
  panelGrabberHandle.className = 'panelGrabberHandle';
  panelGrabber.appendChild(panelGrabberHandle);

  // Resize handle (desktop)
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resizeHandle';
  resizeHandle.setAttribute('aria-hidden', 'true');

  // Task stage
  const taskStage = document.createElement('section');
  taskStage.className = 'taskStage';
  const taskStageTop = document.createElement('div');
  taskStageTop.className = 'taskStageTop';
  const taskStageEyebrow = document.createElement('span');
  taskStageEyebrow.className = 'taskStageEyebrow';
  taskStageEyebrow.textContent = 'Rover on this page';
  const taskStageStatusPill = document.createElement('span');
  taskStageStatusPill.className = 'taskStageStatusPill';
  taskStageStatusPill.textContent = 'Ready';
  taskStageTop.appendChild(taskStageEyebrow);
  taskStageTop.appendChild(taskStageStatusPill);
  const taskStageTitle = document.createElement('div');
  taskStageTitle.className = 'taskStageTitle';
  taskStageTitle.textContent = `Open ${agentName} and work live on this site`;
  const taskStageMeta = document.createElement('div');
  taskStageMeta.className = 'taskStageMeta';
  taskStageMeta.textContent = 'One surface for people and visiting AI agents.';
  taskStage.appendChild(taskStageTop);
  taskStage.appendChild(taskStageTitle);
  taskStage.appendChild(taskStageMeta);

  // Artifact stage
  const artifactStage = document.createElement('section');
  artifactStage.className = 'artifactStage';
  const artifactStageHeader = document.createElement('div');
  artifactStageHeader.className = 'artifactStageHeader';
  const artifactStageLabel = document.createElement('span');
  artifactStageLabel.className = 'artifactStageLabel';
  artifactStageLabel.textContent = 'Live artifact';
  const artifactStageToggle = document.createElement('button');
  artifactStageToggle.type = 'button';
  artifactStageToggle.className = 'artifactStageToggle';
  artifactStageToggle.textContent = 'Expand';
  artifactStageHeader.appendChild(artifactStageLabel);
  artifactStageHeader.appendChild(artifactStageToggle);
  const artifactStageBody = document.createElement('div');
  artifactStageBody.className = 'artifactStageBody';
  const artifactStageEmpty = document.createElement('div');
  artifactStageEmpty.className = 'artifactStageEmpty';
  artifactStageEmpty.textContent = 'Artifacts surface here when Rover produces something meaningful.';
  artifactStageBody.appendChild(artifactStageEmpty);
  artifactStage.appendChild(artifactStageHeader);
  artifactStage.appendChild(artifactStageBody);

  // Task suggestion
  const taskSuggestion = document.createElement('div');
  taskSuggestion.className = 'taskSuggestion';
  taskSuggestion.innerHTML = `
    <div class="taskSuggestionText"></div>
    <div class="taskSuggestionActions">
      <button type="button" class="taskSuggestionBtn primary">Start new</button>
      <button type="button" class="taskSuggestionBtn secondary">Continue</button>
    </div>
  `;
  const taskSuggestionTextEl = taskSuggestion.querySelector('.taskSuggestionText') as HTMLDivElement;
  const taskSuggestionPrimaryBtn = taskSuggestion.querySelector('.taskSuggestionBtn.primary') as HTMLButtonElement;
  const taskSuggestionSecondaryBtn = taskSuggestion.querySelector('.taskSuggestionBtn.secondary') as HTMLButtonElement;

  // Question prompt
  const questionPrompt = document.createElement('div');
  questionPrompt.className = 'questionPrompt';
  const questionPromptTitle = document.createElement('div');
  questionPromptTitle.className = 'questionPromptTitle';
  questionPromptTitle.textContent = 'Need a bit more info';
  const questionPromptForm = document.createElement('form');
  questionPromptForm.className = 'questionPromptForm';
  const questionPromptList = document.createElement('div');
  questionPromptList.className = 'questionPromptList';
  questionPromptForm.appendChild(questionPromptList);
  const questionPromptActions = document.createElement('div');
  questionPromptActions.className = 'questionPromptActions';
  const questionPromptCancel = document.createElement('button');
  questionPromptCancel.type = 'button';
  questionPromptCancel.className = 'questionPromptCancel';
  questionPromptCancel.textContent = 'Cancel';
  questionPromptActions.appendChild(questionPromptCancel);
  const questionPromptSubmit = document.createElement('button');
  questionPromptSubmit.type = 'submit';
  questionPromptSubmit.className = 'questionPromptSubmit';
  questionPromptSubmit.textContent = 'Continue';
  questionPromptActions.appendChild(questionPromptSubmit);
  questionPromptForm.appendChild(questionPromptActions);
  questionPrompt.appendChild(questionPromptTitle);
  questionPrompt.appendChild(questionPromptForm);

  // Conversation pill
  const conversationPill = document.createElement('div');
  conversationPill.className = 'roverConversationPill';
  conversationPill.setAttribute('role', 'button');
  conversationPill.setAttribute('tabindex', '0');
  const conversationPillLabel = document.createElement('span');
  conversationPillLabel.className = 'roverConversationPillLabel';
  conversationPillLabel.textContent = 'Current task';
  const conversationPillArrow = document.createElement('span');
  conversationPillArrow.className = 'roverConversationPillArrow';
  conversationPillArrow.textContent = '\u25BE';
  conversationPill.appendChild(conversationPillLabel);
  conversationPill.appendChild(conversationPillArrow);

  // Paused task banner
  const pausedTaskBanner = document.createElement('div');
  pausedTaskBanner.className = 'pausedTaskBanner';

  // Conversation drawer
  const conversationDrawer = document.createElement('div');
  conversationDrawer.className = 'conversationDrawer';
  const conversationDrawerHeader = document.createElement('div');
  conversationDrawerHeader.className = 'conversationDrawerHeader';
  const conversationDrawerTitle = document.createElement('span');
  conversationDrawerTitle.className = 'conversationDrawerTitle';
  conversationDrawerTitle.textContent = 'Conversations';
  const conversationDrawerCloseBtn = document.createElement('button');
  conversationDrawerCloseBtn.type = 'button';
  conversationDrawerCloseBtn.className = 'conversationDrawerClose';
  conversationDrawerCloseBtn.textContent = '\u00D7';
  conversationDrawerHeader.appendChild(conversationDrawerTitle);
  conversationDrawerHeader.appendChild(conversationDrawerCloseBtn);
  const conversationList = document.createElement('div');
  conversationList.className = 'conversationList';
  const conversationNewBtn = document.createElement('button');
  conversationNewBtn.type = 'button';
  conversationNewBtn.className = 'conversationNewBtn';
  conversationNewBtn.textContent = 'New conversation';
  conversationDrawer.appendChild(conversationDrawerHeader);
  conversationDrawer.appendChild(conversationList);
  conversationDrawer.appendChild(conversationNewBtn);

  conversationPill.addEventListener('click', () => {
    conversationDrawer.classList.toggle('open');
  });

  // Layout state
  let panelStorageState = panelResizable ? readPanelStorageState(panelStorageKey) : {};
  let viewportMetrics = getViewportMetrics();
  let activeLayoutKey: RoverPanelLayoutKey = viewportMetrics.storageKey;
  let currentDesktopPanelState = panelResizable
    ? normalizeStoredDesktopPanelState(panelStorageState.desktop, viewportMetrics) || getDefaultDesktopPanelState(viewportMetrics)
    : getDefaultDesktopPanelState(viewportMetrics);
  let currentSheetPreset: RoverSheetPreset = panelResizable
    ? normalizeSheetPreset((panelStorageState[viewportMetrics.storageKey] as RoverSheetPanelState | undefined)?.preset) ?? 1
    : 1;
  let liveSheetHeight: number | null = null;

  // ── Desktop Resize Handle (drag-to-resize) ──
  if (panelResizable) {
    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let startLeft = 0;

    resizeHandle.addEventListener('pointerdown', (e: PointerEvent) => {
      if (viewportMetrics.layout !== 'desktop') return;
      e.preventDefault();
      e.stopPropagation();
      isResizing = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startW = rect.width;
      startH = rect.height;
      startLeft = rect.left;
      resizeHandle.setPointerCapture(e.pointerId);
      panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'nwse-resize';
    });

    resizeHandle.addEventListener('pointermove', (e: PointerEvent) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      // Bottom-left handle: left movement = wider, down movement = taller
      const clamped = clampDesktopPanelState(
        { width: startW - dx, height: startH + dy },
        viewportMetrics,
      );
      // Keep centered both horizontally and vertically
      const safeInset = experience.shell?.safeAreaInsetPx ?? PANEL_DESKTOP_MARGIN;
      panel.style.width = `${clamped.width}px`;
      panel.style.height = `${clamped.height}px`;
      panel.style.left = `${Math.max(safeInset, Math.round((viewportMetrics.width - clamped.width) / 2))}px`;
      panel.style.top = `${Math.max(safeInset, Math.round((viewportMetrics.height - clamped.height) / 2))}px`;
    });

    const endResize = (e: PointerEvent): void => {
      if (!isResizing) return;
      isResizing = false;
      resizeHandle.releasePointerCapture(e.pointerId);
      panel.style.transition = '';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // Persist final dimensions and re-center
      const rect = panel.getBoundingClientRect();
      currentDesktopPanelState = clampDesktopPanelState(
        { width: rect.width, height: rect.height },
        viewportMetrics,
      );
      panelStorageState = { ...panelStorageState, desktop: currentDesktopPanelState };
      writePanelStorageState(panelStorageKey, panelStorageState);
      // Re-center both horizontally and vertically
      const safeInset = experience.shell?.safeAreaInsetPx ?? PANEL_DESKTOP_MARGIN;
      panel.style.left = `${Math.max(safeInset, Math.round((viewportMetrics.width - currentDesktopPanelState.width) / 2))}px`;
      panel.style.top = `${Math.max(safeInset, Math.round((viewportMetrics.height - currentDesktopPanelState.height) / 2))}px`;
    };
    resizeHandle.addEventListener('pointerup', endResize);
    resizeHandle.addEventListener('pointercancel', endResize);
  }

  function applyLayout(): void {
    const nextMetrics = getViewportMetrics();
    const layoutChanged = nextMetrics.storageKey !== activeLayoutKey;
    viewportMetrics = nextMetrics;
    activeLayoutKey = nextMetrics.storageKey;

    const safeInset = experience.shell?.safeAreaInsetPx ?? 16;

    if (nextMetrics.layout === 'desktop') {
      if (!panelResizable) {
        currentDesktopPanelState = getDefaultDesktopPanelState(nextMetrics);
      } else if (layoutChanged) {
        currentDesktopPanelState = normalizeStoredDesktopPanelState(panelStorageState.desktop, nextMetrics)
          || getDefaultDesktopPanelState(nextMetrics);
      } else {
        currentDesktopPanelState = clampDesktopPanelState(currentDesktopPanelState, nextMetrics);
      }

      const desktopSize = experience.shell?.desktopSize || 'stage';
      const desktopHeight = experience.shell?.desktopHeight || 'tall';
      const targetWidth = clampNumber(
        desktopSize === 'compact' ? PANEL_DESKTOP_MIN_WIDTH : desktopSize === 'cinema' ? PANEL_DESKTOP_MAX_WIDTH : PANEL_DESKTOP_DEFAULT_WIDTH,
        PANEL_DESKTOP_MIN_WIDTH,
        Math.max(PANEL_DESKTOP_MIN_WIDTH, Math.min(PANEL_DESKTOP_MAX_WIDTH, nextMetrics.width - (safeInset * 2))),
      );
      const targetHeight = clampNumber(
        desktopHeight === 'full' ? nextMetrics.height - (safeInset * 2) : Math.min(PANEL_DESKTOP_DEFAULT_HEIGHT, nextMetrics.height - (safeInset * 2)),
        PANEL_DESKTOP_MIN_HEIGHT,
        Math.max(PANEL_DESKTOP_MIN_HEIGHT, nextMetrics.height - (safeInset * 2)),
      );
      if (!panelResizable) {
        currentDesktopPanelState = clampDesktopPanelState({ width: targetWidth, height: targetHeight }, nextMetrics);
      }
      const width = panelResizable ? currentDesktopPanelState.width : targetWidth;
      const height = panelResizable ? currentDesktopPanelState.height : targetHeight;
      panel.style.left = `${Math.max(safeInset, Math.round((nextMetrics.width - width) / 2))}px`;
      panel.style.top = `${Math.max(safeInset, Math.round((nextMetrics.height - height) / 2))}px`;
      panel.style.right = '';
      panel.style.bottom = '';
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.minWidth = `${PANEL_DESKTOP_MIN_WIDTH}px`;
      panel.style.minHeight = `${PANEL_DESKTOP_MIN_HEIGHT}px`;
      panel.style.maxWidth = `${Math.max(PANEL_DESKTOP_MIN_WIDTH, Math.min(PANEL_DESKTOP_MAX_WIDTH, nextMetrics.width - (safeInset * 2)))}px`;
      panel.style.maxHeight = `${Math.max(PANEL_DESKTOP_MIN_HEIGHT, nextMetrics.height - (safeInset * 2))}px`;
      liveSheetHeight = null;
    } else {
      const keyboardInset = nextMetrics.keyboardInset;
      if (nextMetrics.layout === 'tablet') {
        panel.style.left = `${safeInset}px`;
        panel.style.right = `${safeInset}px`;
        panel.style.top = `${safeInset}px`;
        panel.style.bottom = `${Math.max(safeInset, keyboardInset)}px`;
        panel.style.width = 'auto';
        panel.style.height = 'auto';
        panel.style.minWidth = '320px';
      } else {
        // Phone layout — use sheet preset height, anchored at bottom
        const presetHeights = getSheetPresetHeights(nextMetrics);
        const sheetHeight = liveSheetHeight ?? presetHeights[currentSheetPreset];
        const bottomOffset = Math.max(PANEL_PHONE_BOTTOM_OFFSET, keyboardInset);
        const topOffset = Math.max(0, nextMetrics.height - bottomOffset - sheetHeight);
        panel.style.left = '0px';
        panel.style.right = '0px';
        panel.style.top = `${topOffset}px`;
        panel.style.bottom = `${bottomOffset}px`;
        panel.style.width = '100vw';
        panel.style.height = 'auto';
        panel.style.minWidth = '0px';
      }
      panel.style.minHeight = '0px';
      panel.style.maxWidth = '100vw';
      panel.style.maxHeight = '100dvh';
      liveSheetHeight = null;
    }

    syncChrome();
  }

  function cyclePanelSize(): void {
    if (!panelResizable) return;
    if (viewportMetrics.layout === 'desktop') {
      const maxState = clampDesktopPanelState({
        width: PANEL_DESKTOP_MAX_WIDTH,
        height: viewportMetrics.height - PANEL_DESKTOP_MARGIN,
      }, viewportMetrics);
      const isExpanded = Math.abs(currentDesktopPanelState.width - maxState.width) <= 6 && Math.abs(currentDesktopPanelState.height - maxState.height) <= 6;
      currentDesktopPanelState = isExpanded ? getDefaultDesktopPanelState(viewportMetrics) : maxState;
      panelStorageState = { ...panelStorageState, desktop: currentDesktopPanelState };
      writePanelStorageState(panelStorageKey, panelStorageState);
      applyLayout();
      return;
    }
    currentSheetPreset = ((currentSheetPreset + 1) % 3) as RoverSheetPreset;
    liveSheetHeight = null;
    panelStorageState = { ...panelStorageState, [viewportMetrics.storageKey]: { preset: currentSheetPreset } };
    writePanelStorageState(panelStorageKey, panelStorageState);
    applyLayout();
  }

  function syncChrome(): void {
    panel.dataset.layout = viewportMetrics.layout;
    panel.dataset.orientation = viewportMetrics.orientation;
    panel.dataset.resizable = panelResizable ? 'true' : 'false';
  }

  return {
    panel,
    backdrop: panelBackdrop,
    panelGrabber,
    resizeHandle,
    taskStage,
    taskStageTitle,
    taskStageStatusPill,
    taskStageMeta,
    taskStageEyebrow,
    artifactStage,
    artifactStageBody,
    artifactStageToggle,
    artifactStageEmpty,
    taskSuggestion,
    taskSuggestionTextEl,
    taskSuggestionPrimaryBtn,
    taskSuggestionSecondaryBtn,
    questionPrompt,
    questionPromptForm,
    questionPromptList,
    questionPromptCancel,
    questionPromptSubmit,
    conversationPill,
    conversationDrawer,
    conversationList,
    conversationPillLabel,
    conversationDrawerCloseBtn,
    conversationNewBtn,
    pausedTaskBanner,
    applyLayout,
    cyclePanelSize,
    syncChrome,
    getViewportMetrics: () => viewportMetrics,
    destroy() {},
  };
}
