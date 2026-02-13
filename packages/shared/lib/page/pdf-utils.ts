// Accept only internal-ish origins for PDF viewer replies.
// This prevents a normal https:// page from spoofing getSelectedTextReply via window.postMessage.
export function isAllowedPdfReplyOrigin(origin: string): boolean {
  const o = String(origin || '');
  // Many builds use 'null' or '' for internal/extension contexts.
  if (!o || o === 'null') return true;

  // Chrome internal / extension origins
  if (o.startsWith('chrome-extension://')) return true;
  if (o.startsWith('chrome://')) return true;
  if (o.startsWith('chrome-untrusted://')) return true;

  return false;
}

export function isPdfViewerReplyMessage(data: any, requestId: string): boolean {
  if (!data || typeof data !== 'object') return false;
  if (data.type !== 'getSelectedTextReply') return false;
  if (typeof data.selectedText !== 'string') return false;

  // If viewer echoes requestId, enforce it. If not present, allow (legacy),
  // but requestId SHOULD be present once you apply runtime patch below.
  if (data.requestId && data.requestId !== requestId) return false;

  return true;
}
