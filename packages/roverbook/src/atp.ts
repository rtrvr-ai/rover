import type { RoverBookConfig, RoverInstanceLike } from './types.js';

export function initializeATP(_instance: RoverInstanceLike, config: RoverBookConfig): () => void {
  if (config.debug) {
    console.info('[RoverBook] Custom ATP shim disabled. Use Rover public tasks and delegated handoffs instead.');
  }
  return () => undefined;
}

