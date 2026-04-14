import type { RoverPresenceState, RoverMood } from './types.js';

export type StateTransition = {
  from: RoverPresenceState;
  to: RoverPresenceState;
};

export type StateChangeHandler = (transition: StateTransition) => void;

export type StateMachine = {
  getState: () => RoverPresenceState;
  setState: (next: RoverPresenceState) => void;
  getMood: () => RoverMood;
  setMood: (mood: RoverMood, holdMs?: number) => void;
  onStateChange: (handler: StateChangeHandler) => () => void;
  destroy: () => void;
};

export function createStateMachine(initial: RoverPresenceState = 'seed'): StateMachine {
  let current: RoverPresenceState = initial;
  let mood: RoverMood = 'idle';
  let moodTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Set<StateChangeHandler>();

  function setState(next: RoverPresenceState): void {
    if (next === current) return;
    const transition: StateTransition = { from: current, to: next };
    current = next;
    for (const handler of handlers) {
      handler(transition);
    }
  }

  function setMood(nextMood: RoverMood, holdMs = 0): void {
    mood = nextMood;
    if (moodTimer != null) {
      clearTimeout(moodTimer);
      moodTimer = null;
    }
    if (holdMs > 0 && nextMood !== 'idle') {
      moodTimer = setTimeout(() => {
        mood = 'idle';
        moodTimer = null;
      }, holdMs);
    }
  }

  function onStateChange(handler: StateChangeHandler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  function destroy(): void {
    if (moodTimer != null) {
      clearTimeout(moodTimer);
      moodTimer = null;
    }
    handlers.clear();
  }

  return {
    getState: () => current,
    setState,
    getMood: () => mood,
    setMood,
    onStateChange,
    destroy,
  };
}
