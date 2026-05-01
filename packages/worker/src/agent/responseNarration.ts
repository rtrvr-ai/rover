import type { RuntimeToolOutput } from './types.js';

export type AssistantResponseKind = 'checkpoint' | 'final' | 'question' | 'error';

export type ResponseNarrationContext = {
  responseKind?: AssistantResponseKind;
  toolName?: string;
  fallbackText?: string;
};

const TEXT_KEYS = ['response', 'message', 'summary', 'text', 'content', 'result', 'description'];
const MAX_CHECKPOINT_CHARS = 180;
const MAX_FINAL_CHARS = 320;

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').replace(/\s+([.,!?;:])/g, '$1').trim();
}

function stripUnsafeSpeechText(input: string): string {
  let text = String(input || '');
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^\|.*\|$/.test(trimmed)) return false;
      if (/^[-:| ]{3,}$/.test(trimmed)) return false;
      return true;
    })
    .join(' ');
  text = text.replace(/`[^`]+`/g, ' ');
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  text = text.replace(/\bhttps?:\/\/[^\s)]+/gi, ' link ');
  text = text.replace(/\bwww\.[^\s)]+/gi, ' link ');
  text = text.replace(/[A-Z]:\\[^\s]+/gi, ' file ');
  text = text.replace(/\/(?:Users|home|var|tmp|private|Volumes)\/[^\s]+/gi, ' file ');
  text = text.replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' email address ');
  text = text.replace(/\b(?:api[_ -]?key|token|password|passcode|secret)\s*[:=]\s*\S+/gi, 'credential');
  text = text.replace(/\[(?:id|element|selector|xpath|css)=[^\]]+\]/gi, ' ');
  text = text.replace(/\b(?:id|element_id|selector|xpath|css)\s*[:=]\s*["']?[\w#.[\]=:-]+["']?/gi, ' ');
  return collapseWhitespace(text);
}

function firstSentences(input: string, maxSentences: number): string {
  const parts = input.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [input];
  return collapseWhitespace(parts.slice(0, maxSentences).join(' '));
}

export function sanitizeResponseNarration(
  input: unknown,
  context: ResponseNarrationContext = {},
): string | undefined {
  const clean = stripUnsafeSpeechText(String(input || ''));
  if (!clean) return undefined;
  if (/^\s*thought\s*:/i.test(clean) || /\b(selector|xpath|element id|raw json|debug trace)\b/i.test(clean)) return undefined;

  const isFinal = context.responseKind === 'final';
  const maxChars = isFinal ? MAX_FINAL_CHARS : MAX_CHECKPOINT_CHARS;
  const maxSentences = isFinal ? 2 : 1;
  let text = firstSentences(clean, maxSentences);
  const wasLong = text.length > maxChars || clean.length > maxChars + 80;
  if (text.length > maxChars) {
    text = collapseWhitespace(`${text.slice(0, maxChars - 1).replace(/[,;:\s]+$/, '')}.`);
  }
  if (wasLong && isFinal && !/full (answer|result|details?) (is|are) in the chat/i.test(text)) {
    text = collapseWhitespace(`${text} The full result is in the chat.`);
  }
  return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function artifactCount(input: unknown): { count: number; kind?: string } {
  if (!isRecord(input)) return { count: 0 };
  const containers = [
    input,
    isRecord(input.generatedContentRef) ? input.generatedContentRef : undefined,
  ].filter(Boolean) as Record<string, unknown>[];
  for (const container of containers) {
    const checks: Array<[string, string]> = [
      ['docs', 'document'],
      ['slides', 'presentation'],
      ['pdfs', 'PDF'],
      ['webpages', 'webpage'],
    ];
    for (const [key, kind] of checks) {
      const value = container[key];
      if (Array.isArray(value) && value.length) return { count: value.length, kind };
    }
  }
  if (Array.isArray(input.schemaHeaderSheetInfo) && input.schemaHeaderSheetInfo.length) {
    return { count: input.schemaHeaderSheetInfo.length, kind: 'sheet' };
  }
  return { count: 0 };
}

function countBasedNarration(count: number, context: ResponseNarrationContext): string {
  const tool = String(context.toolName || '').toLowerCase();
  if (tool.includes('extract') || tool.includes('crawl') || tool.includes('search')) {
    return `I found ${count} results and posted them in the chat.`;
  }
  return `I finished ${count} items and posted the result in the chat.`;
}

function artifactNarration(count: number, kind: string): string {
  const plural = count === 1 ? kind : `${kind}s`;
  return `I created ${count === 1 ? 'a' : count} ${plural} and posted the link in the chat.`;
}

function extractQuestionTexts(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!isRecord(item)) continue;
    const text = String(item.query || item.question || '').trim();
    if (!text) continue;
    const clean = sanitizeResponseNarration(text, { responseKind: 'question' });
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 3) break;
  }
  return out;
}

function questionNarrationFromTexts(texts: string[]): string | undefined {
  if (!texts.length) return undefined;
  if (texts.length === 1) return texts[0];
  return sanitizeResponseNarration(`I need ${texts.length} details: ${texts.slice(0, 2).join(' ')}`, {
    responseKind: 'question',
  });
}

export function deriveResponseNarrationFromOutput(
  output: RuntimeToolOutput | undefined,
  context: ResponseNarrationContext = {},
): string | undefined {
  if (output == null) return sanitizeResponseNarration(context.fallbackText, context);

  if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') {
    return sanitizeResponseNarration(String(output), context);
  }

  if (Array.isArray(output)) {
    const meaningful = output.filter(item => item !== undefined && item !== null);
    if (!meaningful.length) return sanitizeResponseNarration(context.fallbackText, context);
    if (meaningful.length === 1) {
      return deriveResponseNarrationFromOutput(meaningful[0] as RuntimeToolOutput, context);
    }
    return countBasedNarration(meaningful.length, context);
  }

  if (isRecord(output)) {
    const artifacts = artifactCount(output);
    if (artifacts.count > 0 && artifacts.kind) return artifactNarration(artifacts.count, artifacts.kind);

    if (output.success === false || output.error) {
      const err = isRecord(output.error)
        ? output.error.message
        : output.error;
      return sanitizeResponseNarration(err ? `I hit an issue: ${String(err)}` : 'I hit an issue and posted details in the chat.', {
        ...context,
        responseKind: 'error',
      });
    }

    const questionNarration = questionNarrationFromTexts(extractQuestionTexts(output.questions));
    if (questionNarration) return questionNarration;

    for (const key of TEXT_KEYS) {
      const value = output[key];
      if (typeof value === 'string' && value.trim()) {
        return sanitizeResponseNarration(value, context);
      }
      if (isRecord(value) || Array.isArray(value)) {
        const nested = deriveResponseNarrationFromOutput(value as RuntimeToolOutput, context);
        if (nested) return nested;
      }
    }

    return sanitizeResponseNarration(context.fallbackText, context);
  }

  return sanitizeResponseNarration(context.fallbackText, context);
}

export function responseNarrationDedupeKey(input: unknown): string {
  return stripUnsafeSpeechText(String(input || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
