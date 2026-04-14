import type { RoverShortcut } from '../types.js';

export type CommandBarComponent = {
  root: HTMLDivElement;
  input: HTMLInputElement;
  setItems: (shortcuts: RoverShortcut[]) => void;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  destroy: () => void;
};

export function createCommandBar(opts: {
  onSelect: (s: RoverShortcut) => void;
  onClose: () => void;
}): CommandBarComponent {
  let items: RoverShortcut[] = [];
  let filtered: RoverShortcut[] = [];
  let highlightIndex = 0;
  let isOpenState = false;

  // ── DOM Structure ──
  const overlay = document.createElement('div');
  overlay.className = 'commandBarOverlay';

  const bar = document.createElement('div');
  bar.className = 'commandBar';

  // Header
  const header = document.createElement('div');
  header.className = 'commandBarHeader';

  const searchIcon = document.createElement('span');
  searchIcon.className = 'commandBarSearchIcon';
  searchIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

  const input = document.createElement('input');
  input.className = 'commandBarInput';
  input.type = 'text';
  input.placeholder = 'Search actions...';
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');

  const kbd = document.createElement('kbd');
  kbd.className = 'commandBarKbd';
  kbd.textContent = 'Esc';

  header.appendChild(searchIcon);
  header.appendChild(input);
  header.appendChild(kbd);

  // List
  const list = document.createElement('div');
  list.className = 'commandBarList';
  list.setAttribute('role', 'listbox');

  // Empty state
  const empty = document.createElement('div');
  empty.className = 'commandBarEmpty';
  empty.textContent = 'No matching actions';

  bar.appendChild(header);
  bar.appendChild(list);
  bar.appendChild(empty);
  overlay.appendChild(bar);

  // ── Rendering ──
  function renderList(): void {
    list.innerHTML = '';
    if (filtered.length === 0) {
      empty.classList.add('visible');
      return;
    }
    empty.classList.remove('visible');
    highlightIndex = Math.min(highlightIndex, filtered.length - 1);

    for (let i = 0; i < filtered.length; i++) {
      const shortcut = filtered[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `commandBarItem${i === highlightIndex ? ' highlighted' : ''}`;
      btn.setAttribute('role', 'option');

      const labelEl = document.createElement('span');
      labelEl.className = 'commandBarItemLabel';
      if (shortcut.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'commandBarItemIcon';
        iconSpan.textContent = shortcut.icon;
        labelEl.appendChild(iconSpan);
      }
      labelEl.appendChild(document.createTextNode(shortcut.label));
      btn.appendChild(labelEl);

      if (shortcut.description) {
        const descEl = document.createElement('span');
        descEl.className = 'commandBarItemDesc';
        descEl.textContent = shortcut.description;
        btn.appendChild(descEl);
      }

      btn.addEventListener('click', () => {
        selectItem(shortcut);
      });
      btn.addEventListener('mouseenter', () => {
        highlightIndex = i;
        updateHighlight();
      });
      list.appendChild(btn);
    }
  }

  function updateHighlight(): void {
    const children = list.querySelectorAll('.commandBarItem');
    children.forEach((el, i) => {
      el.classList.toggle('highlighted', i === highlightIndex);
    });
    // Scroll highlighted into view
    const highlighted = list.querySelector('.commandBarItem.highlighted') as HTMLElement | null;
    if (highlighted) highlighted.scrollIntoView({ block: 'nearest' });
  }

  function filterItems(): void {
    const query = input.value.toLowerCase().trim();
    if (!query) {
      filtered = items.slice();
    } else {
      filtered = items.filter(s =>
        s.label.toLowerCase().includes(query) ||
        (s.description && s.description.toLowerCase().includes(query))
      );
    }
    highlightIndex = 0;
    renderList();
  }

  function selectItem(shortcut: RoverShortcut): void {
    close();
    opts.onSelect(shortcut);
  }

  // ── Event Handlers ──
  input.addEventListener('input', filterItems);

  overlay.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') {
      ke.preventDefault();
      ke.stopPropagation();
      close();
      return;
    }
    if (ke.key === 'ArrowDown') {
      ke.preventDefault();
      if (filtered.length > 0) {
        highlightIndex = (highlightIndex + 1) % filtered.length;
        updateHighlight();
      }
      return;
    }
    if (ke.key === 'ArrowUp') {
      ke.preventDefault();
      if (filtered.length > 0) {
        highlightIndex = (highlightIndex - 1 + filtered.length) % filtered.length;
        updateHighlight();
      }
      return;
    }
    if (ke.key === 'Enter') {
      ke.preventDefault();
      if (filtered.length > 0 && highlightIndex < filtered.length) {
        selectItem(filtered[highlightIndex]);
      }
      return;
    }
  });

  // Close on overlay backdrop click
  overlay.addEventListener('mousedown', (e: Event) => {
    if (e.target === overlay) {
      close();
    }
  });

  // ── Public API ──
  function open(): void {
    if (isOpenState) return;
    isOpenState = true;
    input.value = '';
    filtered = items.slice();
    highlightIndex = 0;
    overlay.classList.add('open');
    renderList();
    requestAnimationFrame(() => input.focus());
  }

  function close(): void {
    if (!isOpenState) return;
    isOpenState = false;
    overlay.classList.remove('open');
    opts.onClose();
  }

  function setItems(shortcuts: RoverShortcut[]): void {
    items = shortcuts.slice();
    if (isOpenState) filterItems();
  }

  function destroy(): void {
    isOpenState = false;
    overlay.remove();
  }

  return {
    root: overlay,
    input,
    setItems,
    open,
    close,
    isOpen: () => isOpenState,
    destroy,
  };
}
