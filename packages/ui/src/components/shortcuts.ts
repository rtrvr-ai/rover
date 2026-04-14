import type { RoverShortcut } from '../types.js';
import { SHORTCUTS_RENDER_LIMIT } from '../config.js';

export type ShortcutsComponent = {
  emptyState: HTMLDivElement;
  grid: HTMLDivElement;
  bar: HTMLDivElement;
  heading: HTMLDivElement;
  render: (shortcuts: RoverShortcut[], onShortcutClick?: (sc: RoverShortcut) => void) => void;
  syncVisibility: (hasMessages: boolean, isRunning: boolean, hasQuestionPrompt: boolean) => void;
  setVisitorName: (name: string | undefined, agentName: string) => void;
};

export function createShortcuts(agentName: string, visitorName?: string): ShortcutsComponent {
  const shortcutsEmptyState = document.createElement('div');
  shortcutsEmptyState.className = 'shortcutsEmptyState';

  const shortcutsHeading = document.createElement('div');
  shortcutsHeading.className = 'shortcutsHeading';
  shortcutsHeading.textContent = visitorName
    ? `Hey ${visitorName}! What do you need done?`
    : `What should ${agentName} take care of?`;

  const shortcutsGrid = document.createElement('div');
  shortcutsGrid.className = 'shortcutsGrid';

  shortcutsEmptyState.appendChild(shortcutsHeading);
  shortcutsEmptyState.appendChild(shortcutsGrid);

  const shortcutsBar = document.createElement('div');
  shortcutsBar.className = 'shortcutsBar';

  let currentShortcuts: RoverShortcut[] = [];
  let lastShortcutsKey = '';

  function render(shortcuts: RoverShortcut[], onShortcutClick?: (sc: RoverShortcut) => void): void {
    const filtered = shortcuts
      .filter(sc => sc && sc.enabled !== false)
      .slice(0, SHORTCUTS_RENDER_LIMIT);
    const key = filtered.map(sc => `${sc.id || sc.label}|${sc.label}|${sc.description || ''}|${sc.icon || ''}`).join(';;');
    if (key === lastShortcutsKey) return;
    lastShortcutsKey = key;
    currentShortcuts = filtered;

    shortcutsGrid.innerHTML = '';
    for (const sc of currentShortcuts) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'shortcutCard';
      if (sc.icon) {
        const iconEl = document.createElement('span');
        iconEl.className = 'shortcutCardIcon';
        iconEl.textContent = sc.icon;
        card.appendChild(iconEl);
      }
      const labelEl = document.createElement('span');
      labelEl.className = 'shortcutCardLabel';
      labelEl.textContent = sc.label;
      card.appendChild(labelEl);
      if (sc.description) {
        const descEl = document.createElement('span');
        descEl.className = 'shortcutCardDesc';
        descEl.textContent = sc.description;
        card.appendChild(descEl);
      }
      card.addEventListener('click', () => onShortcutClick?.(sc));
      shortcutsGrid.appendChild(card);
    }

    shortcutsBar.innerHTML = '';
    for (const sc of currentShortcuts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'shortcutChip';
      if (sc.icon) {
        const chipIcon = document.createElement('span');
        chipIcon.className = 'shortcutChipIcon';
        chipIcon.textContent = sc.icon;
        chip.appendChild(chipIcon);
      }
      chip.appendChild(document.createTextNode(sc.label));
      chip.addEventListener('click', () => onShortcutClick?.(sc));
      shortcutsBar.appendChild(chip);
    }
  }

  function syncVisibility(hasMessages: boolean, isRunning: boolean, hasQuestionPrompt: boolean): void {
    const hasShortcuts = currentShortcuts.length > 0;
    const showEmpty = hasShortcuts && !hasMessages && !isRunning;
    const showChips = hasShortcuts && hasMessages && !isRunning && !hasQuestionPrompt;
    shortcutsEmptyState.classList.toggle('visible', showEmpty);
    shortcutsBar.classList.toggle('visible', showChips);
  }

  function setVisitorName(name: string | undefined, agName: string): void {
    shortcutsHeading.textContent = name
      ? `Hey ${name}! What do you need done?`
      : `What should ${agName} take care of?`;
  }

  return {
    emptyState: shortcutsEmptyState,
    grid: shortcutsGrid,
    bar: shortcutsBar,
    heading: shortcutsHeading,
    render,
    syncVisibility,
    setVisitorName,
  };
}
