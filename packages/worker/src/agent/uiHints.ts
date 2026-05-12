export type ToolUiHints = {
  narration?: string;
  highlight?: boolean;
};

export function stripToolUiHintsFromArgs<T extends Record<string, any> | undefined>(args: T): T {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  if (!Object.prototype.hasOwnProperty.call(args, 'ui')) return args;
  const next = { ...args };
  delete next.ui;
  return next as T;
}
