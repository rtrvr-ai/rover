import { allowedMimeTypes, maxFileSizeInBytes } from './constants.js';
import type { ExcludeValuesFromBaseArrayType } from './types.js';

export const excludeValuesFromBaseArray = <B extends string[], E extends (string | number)[]>(
  baseArray: B,
  excludeArray: E,
) => baseArray.filter(value => !excludeArray.includes(value)) as ExcludeValuesFromBaseArrayType<B, E>;

export const sleep = async (time: number) => new Promise(r => setTimeout(r, time));

export const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function withTimeout<T>(p: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(label)), ms) as any as number;
    p.then(v => {
      clearTimeout(id);
      resolve(v);
    }).catch(e => {
      clearTimeout(id);
      reject(e);
    });
  });
}

export async function delayUntil(endTime: number) {
  const delayMs = endTime - Date.now();
  if (delayMs > 0) await delay(delayMs);
}

export function normalizeAndValidate(input: string): { url?: string; error?: string } {
  const trimmedInput = input?.trim(); // case where input can be empty
  if (!trimmedInput) return { error: 'URL cannot be empty' };

  let normalizedUrl: string;

  // Check if already has a valid protocol
  if (/^(https?|file):\/\//i.test(trimmedInput)) {
    normalizedUrl = trimmedInput;
  } else if (/^(?:\/|~|\.|([A-Za-z]:[\\/])|([^./\\]+\/))/i.test(trimmedInput)) {
    // Local file path (Unix, Windows, or directory-like patterns)
    normalizedUrl = handleLocalFileInput(trimmedInput);
  } else {
    // Assume web URL and prepend https://
    normalizedUrl = `https://${trimmedInput}`;
  }

  // Validate the URL
  try {
    const parsedUrl = new URL(normalizedUrl);
    // Additional check for http/https to ensure a valid hostname
    if (parsedUrl.protocol.startsWith('http') && !parsedUrl.hostname.includes('.')) {
      return { error: 'Invalid domain name' };
    }
    return { url: parsedUrl.toString() };
  } catch (e) {
    return { error: 'Invalid URL' };
  }
}

function handleLocalFileInput(input: string): string {
  if (!input?.trim()) {
    return '';
  }
  // Handle Windows paths like C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(input)) {
    return `file:///${input.replace(/\\/g, '/')}`;
  }
  // Handle absolute paths starting with /
  if (input.startsWith('/')) {
    return `file://${input}`;
  }
  // Treat other cases as absolute paths missing the leading slash
  return `file:///${input}`;
}

// Helper function to fetch from a URL and convert it to base64
export const fetchUrlToBase64 = async (
  url: string,
  forGemini: boolean = true,
): Promise<{ data: string; mimeType: string }> => {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  if (blob.size > maxFileSizeInBytes) {
    throw new Error(`File size ${blob.size} is larger than allowed 20MB`);
  }
  if (!allowedMimeTypes.includes(blob.type)) {
    throw new Error(`File type ${blob.type} is not supported by Gemini`);
  }
  const result = await new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = () => {
      const base64String = forGemini
        ? (reader.result as string).substring(`data:${blob.type};base64,`.length)
        : (reader.result as string);
      resolve({ data: base64String, mimeType: blob.type });
    };
    reader.onerror = reject;
  });

  return result;
};

// Helper function to convert file to base64 (no changes needed here)
export const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });

// Check if element is a JavaScript-powered link
export function isJavaScriptLinkElement(element: HTMLElement, document: Document): boolean {
  // Bhavani TO_DO: determine later if this order is ok or you need strong type check of instanceof
  // Similar to label-tree package
  const elementUrl = (element as any).href || (element as any).src || (element as any).data || (element as any).action;
  if (!elementUrl) {
    return false;
  }

  try {
    const url = new URL(elementUrl, document.baseURI);
    // Check for 'javascript:' *and* ensure it's not followed by other valid protocols
    if (
      url.protocol === 'javascript:' &&
      (url.pathname.trim() !== '' || url.search.trim() !== '' || url.hash.trim() !== '')
    ) {
      return true;
    }
  } catch (error) {
    // It's *not* a valid URL that can be parsed, so it's definitely not a "javascript:" URL.
    return false;
  }

  return false;
}

// Helper to detect Google Sheets
export function isGoogleSheet(tabUrl?: string): boolean {
  try {
    const url = tabUrl ?? window.location.href;
    return /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[a-zA-Z0-9_-]+/.test(url);
  } catch {
    return false;
  }
}
