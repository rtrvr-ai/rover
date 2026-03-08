export function resolveActLoopUserInput(
  currentUserInput: string,
  rootUserInput?: string,
): string {
  const canonicalRoot = String(rootUserInput || '').trim();
  if (canonicalRoot) return canonicalRoot;
  return String(currentUserInput || '').trim();
}
