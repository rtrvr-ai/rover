import type { MainWorldToolRequest, MainWorldToolResponse } from '@rover/shared';
import './main-world-actions.js';

export function ensureMainWorldActions(): void {
  const win = window as any;
  const key = win.__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
  if (!win[key]?.actions?.execute) {
    // side-effect import already ran; if still missing, no-op
    return;
  }
}

export async function executeMainWorldTool(request: MainWorldToolRequest): Promise<MainWorldToolResponse> {
  const win = window as any;
  const key = win.__RTRVR_INTERNAL_KEY__ || '__RTRVR_INTERNAL__';
  const internal = win[key];
  const exec = internal?.actions?.execute;
  if (typeof exec !== 'function') {
    throw new Error('Rover main-world action executor not initialized');
  }
  return exec(request) as Promise<MainWorldToolResponse>;
}
