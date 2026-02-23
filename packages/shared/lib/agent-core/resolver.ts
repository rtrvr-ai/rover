import { ExistingSheetParams, NewSheetParams } from '../types/workflow-types.js';
import { SheetInfo } from '../types/index.js';
import type {
  ParsedHistoryPlaceholder,
  ResolveCreateSheetOutputParamsArgs,
  ResolveExtractOutputDestinationArgs,
  ResolvePlannerHistoryArgs,
  ResolveSheetInfoArgs,
  ResolverIO,
} from './types.js';

type HistorySource = ParsedHistoryPlaceholder['source'];

type ResolveContext = {
  cache: Map<string, unknown>;
  seen: WeakSet<object>;
};

const HISTORY_ROOT_ALIASES: Record<string, string> = {
  text_output: 'text_output',
  sheet: 'sheet_outputs',
  sheets: 'sheet_outputs',

  doc: 'doc_outputs',
  docs: 'doc_outputs',

  slides: 'slides_outputs',
  presentations: 'slides_outputs',
  presentation: 'slides_outputs',

  pdf: 'pdf_outputs',
  pdfs: 'pdf_outputs',

  webpage: 'webpage_outputs',
  webpages: 'webpage_outputs',
};

const CANON_SOURCE_BY_ALIAS: Record<string, HistorySource> = {
  sheet: 'sheet',
  sheets: 'sheet',

  doc: 'doc',
  docs: 'doc',

  slides: 'slides',
  presentations: 'slides',
  presentation: 'slides',

  pdf: 'pdf',
  pdfs: 'pdf',

  webpage: 'webpage',
  webpages: 'webpage',

  output: 'output',
  text_output: 'text_output',
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function defaultFormatUnavailable(kind: string, details: Record<string, unknown>): unknown {
  return {
    unavailable: true,
    kind,
    details,
  };
}

function stripOuterBraces(raw: string): string {
  let value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith('{{') && value.endsWith('}}')) {
    value = value.slice(2, -2).trim();
  } else if (value.startsWith('{') && value.endsWith('}')) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function normalizeHistoryRootAlias(raw: string): string {
  return raw.replace(/^history\.steps\[/i, 'history.step[');
}

function parseBracketIndex(input: string, position: number): { value: number; next: number } | null {
  let cursor = position + 1;
  while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;

  let sign = 1;
  if (input[cursor] === '-') {
    sign = -1;
    cursor += 1;
  }

  let digits = '';
  while (cursor < input.length && /\d/.test(input[cursor])) {
    digits += input[cursor];
    cursor += 1;
  }

  while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
  if (input[cursor] !== ']') return null;
  if (!digits) return null;

  return {
    value: sign * parseInt(digits, 10),
    next: cursor + 1,
  };
}

function parseBracketStringOrBare(input: string, position: number): { value: string; next: number } | null {
  let cursor = position + 1;
  while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;

  const quote = input[cursor];
  if (quote === '"' || quote === "'" || quote === '`') {
    cursor += 1;
    let output = '';
    while (cursor < input.length && input[cursor] !== quote) {
      if (input[cursor] === '\\' && cursor + 1 < input.length) {
        output += input[cursor + 1];
        cursor += 2;
      } else {
        output += input[cursor];
        cursor += 1;
      }
    }
    if (input[cursor] !== quote) return null;
    cursor += 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    if (input[cursor] !== ']') return null;
    return { value: output, next: cursor + 1 };
  }

  let inner = '';
  while (cursor < input.length && input[cursor] !== ']') {
    inner += input[cursor];
    cursor += 1;
  }
  if (input[cursor] !== ']') return null;
  inner = inner.trim();
  return inner ? { value: inner, next: cursor + 1 } : null;
}

export function parseHistoryPlaceholder(placeholder: string): ParsedHistoryPlaceholder | null {
  const original = placeholder;
  const normalized = normalizeHistoryRootAlias(stripOuterBraces(placeholder));
  const lower = normalized.toLowerCase();

  if (!lower.startsWith('history.step[')) return null;

  const stepParsed = parseBracketIndex(normalized, 'history.step['.length - 1);
  if (!stepParsed) return null;

  const stepNumber = stepParsed.value;
  if (stepNumber <= 0) return null;

  let cursor = stepParsed.next;
  while (cursor < normalized.length && /\s/.test(normalized[cursor])) cursor += 1;
  if (normalized[cursor] !== '.') return null;
  cursor += 1;

  while (cursor < normalized.length && /\s/.test(normalized[cursor])) cursor += 1;
  let root = '';
  while (cursor < normalized.length && /[A-Za-z_]/.test(normalized[cursor])) {
    root += normalized[cursor];
    cursor += 1;
  }
  if (!root) return null;

  const source = CANON_SOURCE_BY_ALIAS[root.toLowerCase()];
  if (!source) return null;

  while (cursor < normalized.length && /\s/.test(normalized[cursor])) cursor += 1;

  let bracketIndex: number | undefined;
  if (normalized[cursor] === '[') {
    const indexParsed = parseBracketIndex(normalized, cursor);
    if (!indexParsed) return null;
    bracketIndex = indexParsed.value;
    cursor = indexParsed.next;
  }

  let remainder = normalized.slice(cursor).trim();
  let sheetIndex: number | undefined;
  let tabIndex: number | undefined;
  let tabTitle: string | undefined;
  let assetIndex: number | undefined;
  let explicitTopIndex = false;

  const withDefaultIndex = (value: number | undefined): number => value ?? 0;

  if (source === 'sheet') {
    sheetIndex = withDefaultIndex(bracketIndex);

    const trimmed = remainder.trimStart();
    if (trimmed.toLowerCase().startsWith('.tab[')) {
      const tabStart = trimmed.indexOf('[');
      const tabParsed = parseBracketStringOrBare(trimmed, tabStart);
      if (tabParsed) {
        const rawTab = tabParsed.value;
        if (/^-?\d+$/.test(rawTab)) {
          tabIndex = parseInt(rawTab, 10);
        } else {
          tabTitle = rawTab;
        }
        remainder = trimmed.slice(tabParsed.next).trim();
      }
    }

    tabIndex ??= 0;
  } else if (source === 'output' || source === 'text_output') {
    explicitTopIndex = bracketIndex !== undefined;
    remainder = explicitTopIndex ? `[${bracketIndex}]${remainder}` : remainder;
  } else {
    assetIndex = withDefaultIndex(bracketIndex);
  }

  return {
    stepNumber,
    source,
    sheetIndex,
    tabIndex,
    tabTitle,
    assetIndex,
    fullPathAndOps: remainder,
    original,
    explicitTopIndex,
  };
}

type PathToken = { kind: 'prop'; key: string } | { kind: 'index'; index: number };

function tokenizePath(path: string): PathToken[] {
  const source = (path ?? '').trim();
  if (!source) return [];

  const output: PathToken[] = [];
  let buffer = '';
  let cursor = 0;

  const pushProp = () => {
    const key = buffer.trim();
    if (key) output.push({ kind: 'prop', key });
    buffer = '';
  };

  while (cursor < source.length) {
    const char = source[cursor];

    if (char === '.') {
      pushProp();
      cursor += 1;
      continue;
    }

    if (char === '[') {
      pushProp();

      const parsedIndex = parseBracketIndex(source, cursor);
      if (parsedIndex) {
        output.push({ kind: 'index', index: parsedIndex.value });
        cursor = parsedIndex.next;
        continue;
      }

      const parsedString = parseBracketStringOrBare(source, cursor);
      if (parsedString) {
        output.push({ kind: 'prop', key: parsedString.value });
        cursor = parsedString.next;
        continue;
      }

      return [];
    }

    buffer += char;
    cursor += 1;
  }

  pushProp();
  return output;
}

function getPathValueRobust(base: unknown, path: string): unknown {
  const tokens = tokenizePath(path);
  if (tokens.length === 0) return base;

  let current = base;
  for (const token of tokens) {
    if (current == null) return undefined;

    if (token.kind === 'index') {
      if (!Array.isArray(current)) return undefined;
      const idx = token.index < 0 ? current.length + token.index : token.index;
      if (idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
      continue;
    }

    if (typeof current !== 'object') return undefined;
    const key = token.key;
    if (FORBIDDEN_KEYS.has(key)) return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
    current = record[key];
  }

  return current;
}

function parseQuotedStringArguments(raw: string): string[] {
  const args: string[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    while (cursor < raw.length && /[\s,]/.test(raw[cursor])) cursor += 1;
    if (cursor >= raw.length) break;

    const quote = raw[cursor];
    if (quote !== '"' && quote !== "'" && quote !== '`') {
      const start = cursor;
      while (cursor < raw.length && raw[cursor] !== ',') cursor += 1;
      args.push(raw.slice(start, cursor).trim());
      continue;
    }

    cursor += 1;
    let value = '';
    while (cursor < raw.length && raw[cursor] !== quote) {
      if (raw[cursor] === '\\' && cursor + 1 < raw.length) {
        value += raw[cursor + 1];
        cursor += 2;
      } else {
        value += raw[cursor];
        cursor += 1;
      }
    }
    if (raw[cursor] === quote) cursor += 1;
    args.push(value);
  }

  return args;
}

export function applyManipulationChain(value: unknown, opsChain: string): unknown {
  const chain = (opsChain || '').trim();
  if (!chain) return value;

  let current = value;

  let cursor = 0;
  while (cursor < chain.length) {
    while (cursor < chain.length && /\s/.test(chain[cursor])) cursor += 1;
    if (cursor >= chain.length) break;

    if (chain.startsWith('.trim()', cursor)) {
      current = typeof (current as any)?.trim === 'function' ? (current as any).trim() : undefined;
      cursor += '.trim()'.length;
      continue;
    }

    if (chain.startsWith('.split(', cursor)) {
      const close = chain.indexOf(')', cursor + '.split('.length);
      if (close < 0) return undefined;
      const args = parseQuotedStringArguments(chain.slice(cursor + '.split('.length, close));
      const separator = args[0] ?? '';
      current = typeof (current as any)?.split === 'function' ? (current as any).split(separator) : undefined;
      cursor = close + 1;
      continue;
    }

    if (chain.startsWith('.slice(', cursor)) {
      const close = chain.indexOf(')', cursor + '.slice('.length);
      if (close < 0) return undefined;
      const rawArgs = chain.slice(cursor + '.slice('.length, close);
      const parts = rawArgs
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => Number.parseInt(part, 10));
      const start = Number.isFinite(parts[0]) ? parts[0] : 0;
      const end = Number.isFinite(parts[1]) ? parts[1] : undefined;
      current = typeof (current as any)?.slice === 'function' ? (current as any).slice(start, end) : undefined;
      cursor = close + 1;
      continue;
    }

    if (chain.startsWith('.default(', cursor)) {
      const close = chain.indexOf(')', cursor + '.default('.length);
      if (close < 0) return undefined;
      const args = parseQuotedStringArguments(chain.slice(cursor + '.default('.length, close));
      const fallback = args[0] ?? '';
      if (
        current === undefined ||
        current === null ||
        (typeof current === 'string' && current.trim() === '')
      ) {
        current = fallback;
      }
      cursor = close + 1;
      continue;
    }

    if (chain.startsWith('.at(', cursor)) {
      const close = chain.indexOf(')', cursor + '.at('.length);
      if (close < 0) return undefined;
      const rawIndex = chain.slice(cursor + '.at('.length, close).trim();
      const index = Number.parseInt(rawIndex, 10);
      if (typeof (current as any)?.at === 'function') {
        current = (current as any).at(index);
      } else if (Array.isArray(current)) {
        const idx = index < 0 ? current.length + index : index;
        current = current[idx];
      } else if (typeof current === 'string') {
        const chars = [...current];
        const idx = index < 0 ? chars.length + index : index;
        current = chars[idx];
      } else {
        current = undefined;
      }
      cursor = close + 1;
      continue;
    }

    if (chain.startsWith('.join(', cursor)) {
      const close = chain.indexOf(')', cursor + '.join('.length);
      if (close < 0) return undefined;
      const args = parseQuotedStringArguments(chain.slice(cursor + '.join('.length, close));
      const separator = args[0] ?? '';
      current = Array.isArray(current) ? current.join(separator) : undefined;
      cursor = close + 1;
      continue;
    }

    if (chain[cursor] === '[') {
      const parsed = parseBracketIndex(chain, cursor);
      if (!parsed || !Array.isArray(current)) return undefined;
      const idx = parsed.value < 0 ? current.length + parsed.value : parsed.value;
      current = current[idx];
      cursor = parsed.next;
      continue;
    }

    return undefined;
  }

  return current;
}

function normalizeDocInfo(info: any) {
  const docId = info?.docId ?? info?.doc_id;
  return {
    doc_id: docId,
    docId,
    url: info?.url,
    title: info?.title,
    created_at_ms: info?.createdAtMs ?? info?.created_at_ms,
    createdAtMs: info?.createdAtMs ?? info?.created_at_ms,
  };
}

function normalizeSlidesInfo(info: any) {
  const presentationId = info?.presentationId ?? info?.presentation_id;
  return {
    presentation_id: presentationId,
    presentationId,
    url: info?.url,
    title: info?.title,
    created_at_ms: info?.createdAtMs ?? info?.created_at_ms,
    createdAtMs: info?.createdAtMs ?? info?.created_at_ms,
  };
}

function normalizeCloudFile(info: any) {
  return {
    id: info?.id,
    display_name: info?.displayName ?? info?.display_name,
    displayName: info?.displayName ?? info?.display_name,
    mime_type: info?.mimeType ?? info?.mime_type,
    mimeType: info?.mimeType ?? info?.mime_type,
    storage_url: info?.storageUrl ?? info?.storage_url,
    storageUrl: info?.storageUrl ?? info?.storage_url,
    download_url: info?.downloadUrl ?? info?.download_url,
    downloadUrl: info?.downloadUrl ?? info?.download_url,
    gcs_uri: info?.gcsUri ?? info?.gcs_uri,
    gcsUri: info?.gcsUri ?? info?.gcs_uri,
    size_bytes: info?.sizeBytes ?? info?.size_bytes,
    sizeBytes: info?.sizeBytes ?? info?.size_bytes,
    kind: info?.kind,
    source_step_id: info?.sourceStepId ?? info?.source_step_id,
    sourceStepId: info?.sourceStepId ?? info?.source_step_id,
  };
}

function pickIndex<T>(values: T[], index: number): T | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const effective = index < 0 ? values.length + index : index;
  return values[effective] ?? values[0];
}

function getStepAssetInfo(step: any, source: HistorySource, index: number): any | undefined {
  const idx = Number.isInteger(index) ? index : 0;

  const outputKey = HISTORY_ROOT_ALIASES[source];
  const functionOutput = step?.functionResponse?.output;
  if (outputKey && functionOutput && Array.isArray(functionOutput[outputKey])) {
    const picked = pickIndex(functionOutput[outputKey], idx);
    if (picked) {
      if (source === 'doc') return normalizeDocInfo(picked);
      if (source === 'slides') return normalizeSlidesInfo(picked);
      if (source === 'pdf' || source === 'webpage') return normalizeCloudFile(picked);
      return picked;
    }
  }

  const generatedRef = step?.generatedContentRef;
  if (generatedRef) {
    if (source === 'doc' && Array.isArray(generatedRef.docs)) return normalizeDocInfo(pickIndex(generatedRef.docs, idx));
    if (source === 'slides' && Array.isArray(generatedRef.slides)) return normalizeSlidesInfo(pickIndex(generatedRef.slides, idx));
    if (source === 'pdf' && Array.isArray(generatedRef.pdfs)) return normalizeCloudFile(pickIndex(generatedRef.pdfs, idx));
    if (source === 'webpage' && Array.isArray(generatedRef.webpages)) return normalizeCloudFile(pickIndex(generatedRef.webpages, idx));
  }

  const fallbackArrays = [
    step?.schemaHeaderDocInfo,
    step?.schemaHeaderSlidesInfo,
    step?.schemaHeaderPdfInfo,
    step?.schemaHeaderWebPageInfo,
    step?.schemaHeaderFileInfo,
    step?.schemaHeaderDriveFileInfo,
    step?.schemaHeaderFiles,
  ].filter(Boolean);

  const unwrap = (entry: any) =>
    entry?.docInfo ?? entry?.slidesInfo ?? entry?.pdfInfo ?? entry?.webPageInfo ?? entry?.fileInfo ?? entry;

  for (const array of fallbackArrays) {
    if (!Array.isArray(array) || array.length === 0) continue;
    const picked = unwrap(pickIndex(array, idx));
    if (picked) return picked;
  }

  if (source === 'webpage') {
    const maybe = step?.combinedData ?? step?.webPageData ?? step?.pageData;
    if (maybe) return { combinedData: maybe };
  }

  return undefined;
}

function readStepOutput(step: any, source: 'output' | 'text_output'): unknown {
  const functionOutput = step?.functionResponse?.output;
  if (source === 'text_output') {
    return functionOutput?.text_output ?? step?.textOutput ?? step?.text_output ?? step?.output;
  }
  return step?.output ?? functionOutput?.output ?? step?.textOutput ?? step?.text_output;
}

function splitPropertyPathAndOps(pathAndOps: string): { propertyPath: string; ops: string } {
  const value = (pathAndOps ?? '').trim();
  if (!value) return { propertyPath: '', ops: '' };

  const opMatch = value.match(/(\.split\(|\.slice\(|\.trim\(|\.default\(|\.at\(|\.join\()/);
  if (!opMatch || opMatch.index === undefined) {
    return { propertyPath: value, ops: '' };
  }

  return {
    propertyPath: value.slice(0, opMatch.index),
    ops: value.slice(opMatch.index),
  };
}

async function resolveSinglePlaceholder(args: {
  parsed: ParsedHistoryPlaceholder;
  plannerPrevSteps?: any[];
  authToken?: string;
  tabularStore?: unknown;
  returnSourceInfo?: boolean;
  io: ResolverIO;
}): Promise<unknown> {
  const { parsed, plannerPrevSteps, authToken, tabularStore, returnSourceInfo, io } = args;
  const { stepNumber, source, sheetIndex, tabIndex, tabTitle, assetIndex, fullPathAndOps, original, explicitTopIndex } = parsed;

  if (!plannerPrevSteps || stepNumber <= 0 || stepNumber > plannerPrevSteps.length) {
    return `[Invalid history ref - Step ${stepNumber} out of bounds: ${original}]`;
  }

  const step = plannerPrevSteps[stepNumber - 1];
  let baseObject: unknown;
  const formatUnavailable = io.formatUnavailable ?? defaultFormatUnavailable;

  if (source === 'sheet') {
    const targetSheetIndex = sheetIndex ?? 0;
    const baseSheetInfo =
      step?.functionResponse?.output?.sheet_outputs?.[targetSheetIndex]?.sheetInfo ??
      step?.schemaHeaderSheetInfo?.[targetSheetIndex]?.sheetInfo ??
      step?.schemaHeaderSheetInfo?.[0]?.sheetInfo;

    if (!baseSheetInfo) {
      return `[Invalid ref - No sheetInfo at sheet index ${targetSheetIndex} for ${original}]`;
    }

    const specific: SheetInfo = { ...baseSheetInfo };
    const tabs = baseSheetInfo.sheetTabs;

    if (tabs && Array.isArray(tabs) && tabs.length > 0) {
      if (tabTitle) {
        const match = tabs.find((tab: any) => String(tab?.title ?? '').toLowerCase() === tabTitle.toLowerCase());
        if (match) {
          specific.sheetTab = match.title;
          specific.sheetTabId = match.id;
        }
      } else {
        const selected = pickIndex(tabs, tabIndex ?? 0);
        if (selected) {
          specific.sheetTab = selected.title;
          specific.sheetTabId = selected.id;
        }
      }
    }

    if (returnSourceInfo) {
      baseObject = specific;
    } else {
      baseObject = await io.getGoogleSheetContent({
        sheetInfo: specific,
        authToken,
        tabularStore,
      });
      if (baseObject === undefined) {
        return `[Error fetching sheet content for ${original}]`;
      }
    }
  } else if (source === 'output' || source === 'text_output') {
    const raw = readStepOutput(step, source);
    if (raw === undefined || raw === null) {
      return step?.error
        ? `[Error in step ${stepNumber}: ${step.error}]`
        : `[No ${source} from step ${stepNumber} for ${original}]`;
    }

    if (Array.isArray(raw) && raw.length === 1 && !explicitTopIndex) {
      baseObject = raw[0];
    } else {
      baseObject = raw;
    }
  } else {
    const targetAssetIndex = assetIndex ?? 0;
    const info = getStepAssetInfo(step, source, targetAssetIndex);
    if (!info) {
      return `[Invalid ref - No ${source} info at index ${targetAssetIndex} for ${original}]`;
    }

    if (returnSourceInfo) {
      baseObject = info;
    } else {
      switch (source) {
        case 'doc': {
          const docId = info?.doc_id ?? info?.docId;
          if (!authToken || !docId || !io.getGoogleDocContentForLLM) {
            baseObject = formatUnavailable('DOC', { authToken: !!authToken, id: docId, info });
            break;
          }
          baseObject = await io.getGoogleDocContentForLLM({ authToken, docId });
          break;
        }
        case 'slides': {
          const presentationId = info?.presentation_id ?? info?.presentationId;
          if (!authToken || !presentationId || !io.getGoogleSlidesContentForLLM) {
            baseObject = formatUnavailable('SLIDES', { authToken: !!authToken, id: presentationId, info });
            break;
          }
          baseObject = await io.getGoogleSlidesContentForLLM({ authToken, presentationId });
          break;
        }
        case 'pdf': {
          if (!io.getPdfContentForLLM) {
            baseObject = formatUnavailable('PDF', { authToken: !!authToken, info });
            break;
          }
          baseObject = await io.getPdfContentForLLM({ authToken, info });
          break;
        }
        case 'webpage': {
          if (!io.getWebpageContentForLLM) {
            baseObject = formatUnavailable('WEBPAGE', { info });
            break;
          }
          baseObject = await io.getWebpageContentForLLM({ info });
          break;
        }
      }
    }
  }

  const { propertyPath: rawPath, ops } = splitPropertyPathAndOps(fullPathAndOps);
  let propertyPath = (rawPath ?? '').trim();
  if (propertyPath.endsWith('.')) propertyPath = propertyPath.slice(0, -1);
  if (propertyPath.startsWith('.')) propertyPath = propertyPath.slice(1);

  const intermediate = propertyPath ? getPathValueRobust(baseObject, propertyPath) : baseObject;
  return ops ? applyManipulationChain(intermediate, ops) : intermediate;
}

async function resolveInternal(args: ResolvePlannerHistoryArgs & { ctx: ResolveContext }): Promise<unknown> {
  const { data, plannerPrevSteps, authToken, tabularStore, returnSourceInfo, io, ctx } = args;

  if (typeof data === 'string') {
    const placeholderRegex = /\{{1,2}\s*history\.steps?\[\s*\d+\s*\]\.[^{}]*\}{1,2}/gi;
    const matches = [...data.matchAll(placeholderRegex)];

    if (matches.length === 0) return data;

    if (matches.length === 1 && matches[0].index === 0 && matches[0][0].trim() === data.trim()) {
      const token = matches[0][0];
      if (ctx.cache.has(token)) return ctx.cache.get(token);
      const parsed = parseHistoryPlaceholder(token);
      if (!parsed) return data;
      const resolved = await resolveSinglePlaceholder({
        parsed,
        plannerPrevSteps,
        authToken,
        tabularStore,
        returnSourceInfo,
        io,
      });
      ctx.cache.set(token, resolved);
      return resolved;
    }

    let output = '';
    let last = 0;

    for (const match of matches) {
      const token = match[0];
      const start = match.index ?? 0;
      output += data.slice(last, start);

      let resolved: unknown;
      if (ctx.cache.has(token)) {
        resolved = ctx.cache.get(token);
      } else {
        const parsed = parseHistoryPlaceholder(token);
        resolved = parsed
          ? await resolveSinglePlaceholder({
            parsed,
            plannerPrevSteps,
            authToken,
            tabularStore,
            returnSourceInfo,
            io,
          })
          : token;
        ctx.cache.set(token, resolved);
      }

      output += io.toolOutputToString(resolved);
      last = start + token.length;
    }

    output += data.slice(last);
    return output;
  }

  if (Array.isArray(data)) {
    return Promise.all(
      data.map(entry =>
        resolveInternal({
          data: entry,
          plannerPrevSteps,
          authToken,
          tabularStore,
          returnSourceInfo,
          io,
          ctx,
        }),
      ),
    );
  }

  if (typeof data === 'object' && data !== null) {
    if (ctx.seen.has(data)) return data;
    ctx.seen.add(data);

    const output: Record<string, unknown> = {};
    for (const key of Object.keys(data as Record<string, unknown>)) {
      output[key] = await resolveInternal({
        data: (data as Record<string, unknown>)[key],
        plannerPrevSteps,
        authToken,
        tabularStore,
        returnSourceInfo,
        io,
        ctx,
      });
    }
    return output;
  }

  return data;
}

export async function resolvePlannerHistoryPlaceholders(args: ResolvePlannerHistoryArgs): Promise<unknown> {
  const context: ResolveContext = {
    cache: new Map(),
    seen: new WeakSet(),
  };

  return resolveInternal({
    ...args,
    ctx: context,
  });
}

export function resolvePlannerHistorySheetInfo(args: ResolveSheetInfoArgs): SheetInfo | unknown {
  const { placeholder, plannerPrevSteps } = args;
  if (typeof placeholder !== 'string') return placeholder;

  const parsed = parseHistoryPlaceholder(placeholder);
  if (!parsed || parsed.source !== 'sheet') return placeholder;

  const { stepNumber, sheetIndex = 0, tabIndex = 0, tabTitle, original } = parsed;

  if (!plannerPrevSteps || stepNumber <= 0 || stepNumber > plannerPrevSteps.length) {
    return `[Invalid history ref - Step ${stepNumber} out of bounds: ${original}]`;
  }

  const step = plannerPrevSteps[stepNumber - 1];
  const base =
    step?.functionResponse?.output?.sheet_outputs?.[sheetIndex]?.sheetInfo ??
    step?.schemaHeaderSheetInfo?.[sheetIndex]?.sheetInfo ??
    step?.schemaHeaderSheetInfo?.[0]?.sheetInfo;

  if (!base) return `[Invalid ref - No sheetInfo at sheet index ${sheetIndex} for ${original}]`;

  const specific: SheetInfo = { ...base };
  const tabs = base.sheetTabs;

  if (tabs && Array.isArray(tabs) && tabs.length > 0) {
    if (tabTitle) {
      const match = tabs.find((tab: any) => String(tab?.title ?? '').toLowerCase() === tabTitle.toLowerCase());
      if (match) {
        specific.sheetTab = match.title;
        specific.sheetTabId = match.id;
      }
    } else {
      const selected = pickIndex(tabs, tabIndex);
      if (selected) {
        specific.sheetTab = selected.title;
        specific.sheetTabId = selected.id;
      }
    }
  }

  return specific;
}

export async function resolveExtractCrawlOutputDestinationToSheetInfo(
  args: ResolveExtractOutputDestinationArgs,
): Promise<SheetInfo | undefined> {
  const { outputDestination, plannerPrevSteps, authToken, tabularStore, io } = args;
  if (!outputDestination) return undefined;

  const newSheetTitle = outputDestination.newSheetTitle
    ? (await resolvePlannerHistoryPlaceholders({
      data: outputDestination.newSheetTitle,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: false,
      io,
    })) as string
    : undefined;

  const newTabTitle = outputDestination.newTabTitle
    ? (await resolvePlannerHistoryPlaceholders({
      data: outputDestination.newTabTitle,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: false,
      io,
    })) as string
    : undefined;

  const existingTabTitle = outputDestination.existingTabTitle
    ? (await resolvePlannerHistoryPlaceholders({
      data: outputDestination.existingTabTitle,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: false,
      io,
    })) as string
    : undefined;

  const existingRefRaw = outputDestination.existingSheetFromHistory ?? outputDestination.existingSheetId;
  const existingResolved = existingRefRaw
    ? await resolvePlannerHistoryPlaceholders({
      data: existingRefRaw,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: true,
      io,
    })
    : undefined;

  if (newSheetTitle?.trim()) {
    const sheetInfo: SheetInfo = {
      sheetTitle: newSheetTitle.trim(),
    } as SheetInfo;
    if (newTabTitle?.trim()) sheetInfo.newTabTitle = newTabTitle.trim();
    delete (sheetInfo as any).sheetTab;
    delete (sheetInfo as any).sheetTabId;
    return sheetInfo;
  }

  const sheetInfo: SheetInfo = {} as SheetInfo;

  if (existingResolved && typeof existingResolved === 'object') {
    sheetInfo.sheetId = (existingResolved as any).sheetId;
    sheetInfo.sheetTab = (existingResolved as any).sheetTab;
    sheetInfo.sheetTabId = (existingResolved as any).sheetTabId;
  } else if (typeof existingResolved === 'string' && existingResolved.trim()) {
    sheetInfo.sheetId = existingResolved.trim();
  }

  if (existingTabTitle?.trim()) {
    sheetInfo.sheetTab = existingTabTitle.trim();
  } else if (!sheetInfo.sheetTab && newTabTitle?.trim()) {
    sheetInfo.newTabTitle = newTabTitle.trim();
  } else if (newTabTitle?.trim()) {
    sheetInfo.newTabTitle = newTabTitle.trim();
  }

  if (!sheetInfo.sheetId && !sheetInfo.sheetTitle) return undefined;
  return sheetInfo;
}

export async function resolveCreateSheetOutputSheetParameters(
  args: ResolveCreateSheetOutputParamsArgs,
): Promise<NewSheetParams & ExistingSheetParams> {
  const { outputSheetParameters, plannerPrevSteps, authToken, tabularStore, io } = args;
  if (!outputSheetParameters) return {} as NewSheetParams & ExistingSheetParams;

  const newSheetTitle = outputSheetParameters.newSheetTitle
    ? (await resolvePlannerHistoryPlaceholders({
      data: outputSheetParameters.newSheetTitle,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: false,
      io,
    })) as string
    : undefined;

  const newTabTitle = outputSheetParameters.newTabTitle
    ? (await resolvePlannerHistoryPlaceholders({
      data: outputSheetParameters.newTabTitle,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: false,
      io,
    })) as string
    : undefined;

  const existingTabTitle = outputSheetParameters.existingTabTitle
    ? (await resolvePlannerHistoryPlaceholders({
      data: outputSheetParameters.existingTabTitle,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: false,
      io,
    })) as string
    : undefined;

  const existingRefRaw = outputSheetParameters.existingSheetFromHistory ?? outputSheetParameters.existingSheetId;
  const existingResolved = existingRefRaw
    ? await resolvePlannerHistoryPlaceholders({
      data: existingRefRaw,
      plannerPrevSteps,
      authToken,
      tabularStore,
      returnSourceInfo: true,
      io,
    })
    : undefined;

  let existingSheetId: string | undefined = outputSheetParameters.existingSheetId;
  let tabFromHistory: string | undefined;

  if (existingResolved && typeof existingResolved === 'object') {
    existingSheetId = (existingResolved as any).sheetId ?? existingSheetId;
    tabFromHistory = (existingResolved as any).sheetTab ?? (existingResolved as any).sheetTabTitle;
  } else if (typeof existingResolved === 'string' && existingResolved.trim()) {
    existingSheetId = existingResolved.trim();
  }

  const newTabTrimmed = newTabTitle?.trim();
  const existingTabFinal = existingTabTitle?.trim() || (!newTabTrimmed ? tabFromHistory?.trim() : undefined);

  return {
    newSheetTitle: newSheetTitle?.trim(),
    newTabTitle: newTabTitle?.trim(),
    existingSheetId: existingSheetId?.trim(),
    existingTabTitle: existingTabFinal,
    existingSheetFromHistory: outputSheetParameters.existingSheetFromHistory,
  } as NewSheetParams & ExistingSheetParams;
}

export function normalizeExistingSheetParamsFromHistory(
  params: ExistingSheetParams | undefined,
  plannerPrevSteps: any[] | undefined,
): ExistingSheetParams | undefined {
  if (!params) return params;
  if (!params.existingSheetFromHistory) return params;

  const sheetInfo = resolvePlannerHistorySheetInfo({
    placeholder: params.existingSheetFromHistory,
    plannerPrevSteps: plannerPrevSteps ?? [],
  }) as SheetInfo;

  if (sheetInfo?.sheetId) {
    params.existingSheetId ??= sheetInfo.sheetId;
    params.existingTabTitle ??= sheetInfo.sheetTab;
  }

  return params;
}

export function normalizeExistingDocParamsFromHistory(destination: any): any {
  if (!destination || !destination.existingDocFromHistory) return destination;
  const doc = destination.existingDocFromHistory;
  const docId = doc?.doc_id ?? doc?.docId;
  if (docId) destination.existingDocId ??= docId;
  return destination;
}

export function normalizeExistingSlidesParamsFromHistory(destination: any): any {
  if (!destination || !destination.existingPresentationFromHistory) return destination;
  const presentation = destination.existingPresentationFromHistory;
  const presentationId = presentation?.presentation_id ?? presentation?.presentationId;
  if (presentationId) destination.existingPresentationId ??= presentationId;
  return destination;
}
