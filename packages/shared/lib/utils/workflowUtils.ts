// packages/shared/lib/utils/workflowUtils.ts
import { plannerFunctionCallValueToFunctionCallValueMap, PLANNER_FUNCTION_CALLS, PLANNER } from '../utils/constants.js';
import type { SheetInfo, ToolOutput, ToolOutputElement } from '../types/index.js';
import type {
  StoredFunctionCall,
  ActWorkflow,
  SchemaHeaderSheetInfo,
  CreateSheetWorkflow,
  ProcessTextWorkflow,
} from '../types/workflow-types.js';
import type { FUNCTION_CALLS } from '../utils/constants.js';

// Add a helper function to format step output
export const formatStepOutput = (stepResult: {
  toolName: string;
  thought?: string;
  output?: any;
  error?: string;
  creditsUsed?: number;
}): string => {
  let content = '';

  // Add tool name and thought
  if (stepResult.thought) {
    content += `💭 ${stepResult.thought}\n\n`;
  }

  content += `**${stepResult.toolName}**\n`;

  // Add error if present
  if (stepResult.error) {
    content += `❌ Error: ${stepResult.error}\n`;
    return content;
  }

  // Format the output based on type
  if (stepResult.output) {
    if (Array.isArray(stepResult.output)) {
      stepResult.output.forEach(item => {
        if (typeof item === 'string') {
          content += item + '\n';
        } else if (typeof item === 'object') {
          // For structured data, format it nicely
          content += '```json\n' + JSON.stringify(item, null, 2) + '\n```\n';
        }
      });
    } else if (typeof stepResult.output === 'object') {
      // Handle object output
      if (stepResult.output.data) {
        content += '```json\n' + JSON.stringify(stepResult.output.data, null, 2) + '\n```\n';
      } else {
        content += '```json\n' + JSON.stringify(stepResult.output, null, 2) + '\n```\n';
      }
    } else {
      content += stepResult.output + '\n';
    }
  }

  return content;
};

/**
 * Parses Google Sheet URL to extract IDs.
 * @param urlString The URL string.
 * @returns SheetInfo object with parsed IDs or null if not a valid sheet URL.
 */
export function parseGoogleSheetUrl(urlString: string): Omit<SheetInfo, 'sheetTab'> | null {
  // Renamed return type slightly as name isn't parsed here
  if (!urlString) return null;

  try {
    const url = new URL(urlString);
    if (url.hostname !== 'docs.google.com') return null;

    const pathParts = url.pathname.split('/');
    const spreadsheetIndex = pathParts.indexOf('spreadsheets');
    const dIndex = pathParts.indexOf('d');

    if (spreadsheetIndex === -1 || dIndex === -1 || dIndex !== spreadsheetIndex + 1 || pathParts.length <= dIndex + 1) {
      return null;
    }

    const sheetId = pathParts[dIndex + 1];
    if (!sheetId || !/^[a-zA-Z0-9_-]+$/.test(sheetId)) {
      return null;
    }

    let sheetTabIdStr: string | undefined = undefined;
    if (url.hash && url.hash.includes('gid=')) {
      const hashParams = new URLSearchParams(url.hash.substring(1));
      sheetTabIdStr = hashParams.get('gid') ?? undefined;
    }
    if (!sheetTabIdStr && url.searchParams.has('gid')) {
      sheetTabIdStr = url.searchParams.get('gid') ?? undefined;
    }

    if (sheetTabIdStr && !/^\d+$/.test(sheetTabIdStr)) {
      sheetTabIdStr = undefined;
    }

    // Return only the IDs parsed from the URL
    return {
      sheetId: sheetId,
      sheetTabId: sheetTabIdStr ? parseInt(sheetTabIdStr, 10) : 0, //deafult to 0
    };
  } catch (e) {
    return null;
  }
}

// Helper to parse Google Doc ID from URL
export const parseGoogleDocId = (url: string): string | null => {
  if (!url) return null;
  // This regex captures the ID from URLs like:
  // https://docs.google.com/document/d/1AbC...XyZ/edit
  // https://docs.google.com/document/d/1AbC...XyZ/
  const match = url.match(/document\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

/**
 * Helper to parse Google Slides presentation ID from its URL.
 * @param url The full URL of the Google Slides presentation.
 * @returns The presentation ID string, or null if not found.
 */
export const parseGoogleSlidesId = (url: string): string | null => {
  if (!url) return null;
  // This regex captures the ID from URLs like:
  // https://docs.google.com/presentation/d/1AbC...XyZ/edit
  const match = url.match(/presentation\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

export function getStoredFunctionCallToolName(call: StoredFunctionCall): FUNCTION_CALLS | string {
  return plannerFunctionCallValueToFunctionCallValueMap[call.toolName as PLANNER_FUNCTION_CALLS] ?? call.toolName;
}

export function getStoredFunctionCallUserInput(call: StoredFunctionCall): string {
  // This order is imp and casting to one of the workflows with userInput
  return (
    (call.systemWorkflow as ActWorkflow)?.userInput ||
    call.toolArgs?.user_input ||
    (call.systemWorkflow as CreateSheetWorkflow | ProcessTextWorkflow)?.taskInstruction ||
    call.toolArgs?.task_instruction ||
    call.userInput ||
    ''
  );
}

export function combineAndCleanToolOutputs(functionOutputs: ToolOutput[]): ToolOutput {
  // Returns a clean ToolOutput (array of defined elements)

  const combinedAndCleaned = functionOutputs?.flatMap(singleToolOutput => {
    // Check if singleToolOutput is a non-empty array
    if (Array.isArray(singleToolOutput) && singleToolOutput.length > 0) {
      // If it is, filter out any 'undefined' elements from within it
      return singleToolOutput.filter((item): item is ToolOutputElement => item !== undefined);
    }
    // If singleToolOutput is null, undefined, or an empty array,
    // return an empty array so flatMap contributes nothing from it.
    return [];
  });

  return combinedAndCleaned; // This is now ToolOutput (a clean array of defined elements)
}

// Add this helper function within your HistoryPanel.tsx file, or import from a utils file
export const getFormattedOutputDisplay = (outputString: string | undefined): string => {
  if (!outputString?.trim()) return ''; // Return empty string or some placeholder like "No output"
  try {
    // Check if it's a string that looks like a JSON array or object
    const trimmed = outputString.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      const parsed = JSON.parse(outputString);
      // Pretty-print if it's an object or array
      if (typeof parsed === 'object' && parsed !== null) {
        return JSON.stringify(parsed, null, 2);
      }
    }
  } catch (e) {
    // Not valid JSON, or some other issue, return original string
  }
  return outputString; // Return original if not complex JSON or if parsing failed
};

/**
 * Safely converts any value (object, array, string, primitive) into a displayable string.
 * This is a robust utility designed to never throw an error, making it ideal for
 * converting unpredictable tool or placeholder outputs into strings.
 * @param value The value to convert. Can be any type.
 * @returns A string representation of the value. Returns an empty string for null/undefined.
 */
export function toolOutputToString(value: any): string {
  if (value === undefined || value === null) {
    return '';
  }

  // If the value is already a string, just return it.
  if (typeof value === 'string') {
    return value;
  }

  // For other primitives (number, boolean), convert them.
  if (typeof value !== 'object') {
    return String(value);
  }

  // If it's a non-array object, stringify it directly.
  // This handles the { "articles": [...] } case perfectly.
  if (!Array.isArray(value)) {
    return JSON.stringify(value);
  }

  // --- From here on, we know 'value' is an array ---
  if (value.length === 0) {
    return '';
  }

  // If all elements in the array are strings, join them with a newline.
  const allElementsAreStrings = value.every(element => typeof element === 'string');
  if (allElementsAreStrings) {
    return (value as string[]).join('\n');
  }

  // If it's a single-element array, stringify just that element for a cleaner look.
  if (value.length === 1) {
    const firstElement = value[0];
    // The single element could be anything, just stringify it.
    return typeof firstElement === 'string' ? firstElement : JSON.stringify(firstElement);
  }

  // It's an array of multiple, non-string items. Stringify the whole array.
  return JSON.stringify(value);
}

export const extractOutputSheetLinks = (schema?: SchemaHeaderSheetInfo[] | null): Set<string> => {
  // --- Extract RAW links ---
  const schemaLinks =
    schema
      ?.map(s => {
        if (s.sheetInfo) {
          const gid = `${s.sheetInfo.sheetTabId ? s.sheetInfo.sheetTabId : '0'}`;
          const sheetUrl = `https://docs.google.com/spreadsheets/d/${s.sheetInfo.sheetId}/edit?gid=${gid}`;
          return sheetUrl;
        } else {
          return null;
        }
      })
      .filter((link): link is string => link !== null) ?? [];

  const allUniqueLinks = new Set([...schemaLinks]);
  return allUniqueLinks;
};

export const getAggregatedStepOutput = (
  step: StoredFunctionCall,
  structuredOutput?: boolean,
): {
  rawOutput: string | ToolOutput; // Can be a string or the raw ToolOutput
  sheetInfo: SchemaHeaderSheetInfo[];
  generatedHtml?: string;
  generatedDocUrl?: string;
  generatedSlidesUrl?: string;
  error?: string;
  displayableOutput: string; // Always a display-friendly string
  sheetLinks: string[];
} => {
  // Initialize outputs with the current step's direct output
  let aggregatedRawOutput: string | ToolOutput = structuredOutput
    ? step.output || []
    : (step.output && toolOutputToString(step.output)) || '';

  let aggregatedSheetInfo: SchemaHeaderSheetInfo[] = step.schemaHeaderSheetInfo || [];
  let aggregatedGeneratedHtml: string | undefined = step.generatedHtml;
  let aggregatedGeneratedDocUrl: string | undefined = step.generatedDocUrl;
  let aggregatedGeneratedSlidesUrl: string | undefined = step.generatedSlidesUrl;
  let aggregatedError: string | undefined = step.error || undefined;

  // Determine if we should aggregate from multi-steps.
  // This is true for planners that have sub-steps.
  const shouldAggregate =
    (step.toolName === PLANNER || step.toolName === PLANNER_FUNCTION_CALLS.EXECUTE_MULTIPLE_TOOLS) &&
    step.multiSteps &&
    step.multiSteps.length > 0;

  if (shouldAggregate) {
    // 1. Flatten the entire tree of nested steps
    const allNestedSteps: StoredFunctionCall[] = [];
    const queue: StoredFunctionCall[] | undefined = step.multiSteps && [...step.multiSteps];

    while (queue && queue.length > 0) {
      const nestedStep = queue.shift()!;
      allNestedSteps.push(nestedStep);
      if (nestedStep.multiSteps && nestedStep.multiSteps.length > 0) {
        queue.push(...nestedStep.multiSteps);
      }
    }

    // 2. Aggregate sheetInfo (same for both modes)
    const allNestedSheetInfo = allNestedSteps.flatMap(s => s.schemaHeaderSheetInfo || []);
    aggregatedSheetInfo = [...aggregatedSheetInfo, ...allNestedSheetInfo];

    // 2. Aggregate generatedHtml (same for both modes)
    // Bhavani TO_DO: See in future if we should support array of html pages. For now just the first result
    const allGeneratedHtml = allNestedSteps.filter(g => !!g.generatedHtml?.trim()).flatMap(g => g.generatedHtml);
    aggregatedGeneratedHtml =
      allGeneratedHtml?.length && allGeneratedHtml[0] ? allGeneratedHtml[0] : aggregatedGeneratedHtml;

    const allGeneratedDocUrl = allNestedSteps.filter(g => !!g.generatedDocUrl?.trim()).flatMap(g => g.generatedDocUrl);
    aggregatedGeneratedDocUrl =
      allGeneratedDocUrl?.length && allGeneratedDocUrl[0] ? allGeneratedDocUrl[0] : aggregatedGeneratedDocUrl;

    const allGeneratedSlidesUrl = allNestedSteps
      .filter(g => !!g.generatedSlidesUrl?.trim())
      .flatMap(g => g.generatedSlidesUrl);
    aggregatedGeneratedSlidesUrl =
      allGeneratedSlidesUrl?.length && allGeneratedSlidesUrl[0]
        ? allGeneratedSlidesUrl[0]
        : aggregatedGeneratedSlidesUrl;

    // 4. Aggregate error
    const errSteps = allNestedSteps.filter(s => s.error !== undefined && s.error !== null);
    if (errSteps?.length) {
      aggregatedError = errSteps.flatMap(s => s.error).join('\n') ?? undefined;
    }

    // 5. Aggregate rawOutput based on the structuredOutput flag
    if (structuredOutput) {
      // Mode 1: Collect all raw ToolOutput arrays and combine them
      const nestedRawOutputs = allNestedSteps.map(s => s.output).filter((o): o is ToolOutput => !!o);

      // Combine the parent's output with all children's outputs
      aggregatedRawOutput = combineAndCleanToolOutputs([aggregatedRawOutput as ToolOutput, ...nestedRawOutputs]);
    } else {
      // Mode 2: Collect all stringified outputs and join them
      const allNestedTextOutputs = allNestedSteps
        .map(nestedStep => {
          const stepOutput = nestedStep.output ? toolOutputToString(nestedStep.output) : '';
          // Only include steps that actually produced an output
          if (stepOutput) {
            return `--- Output of ${nestedStep.toolName} ---\n${stepOutput}`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n\n');

      // Combine parent's string output with the aggregated children's string
      aggregatedRawOutput = [aggregatedRawOutput as string, allNestedTextOutputs].filter(Boolean).join('\n\n');
    }
  }

  // Ensure we have a string version of the output for display purposes
  const rawOutputString = structuredOutput
    ? toolOutputToString(aggregatedRawOutput as ToolOutput)
    : (aggregatedRawOutput as string);

  return {
    rawOutput: aggregatedRawOutput,
    sheetInfo: aggregatedSheetInfo,
    generatedHtml: aggregatedGeneratedHtml,
    generatedDocUrl: aggregatedGeneratedDocUrl,
    generatedSlidesUrl: aggregatedGeneratedSlidesUrl,
    displayableOutput: getFormattedOutputDisplay(rawOutputString),
    sheetLinks: Array.from(extractOutputSheetLinks(aggregatedSheetInfo)),
    error: aggregatedError,
  };
};

/**
 * Traverses a task and all its nested sub-steps to extract all generated artifacts.
 * This includes schemas (for Google Sheets), generated HTML, Google Doc URLs, and Google Slides URLs.
 * It deduplicates the results to ensure each unique artifact is returned only once.
 *
 * @param task The top-level StoredFunctionCall to process.
 * @returns An object containing arrays of unique, extracted artifacts.
 */
export function extractAllArtifactsFromTask(task: StoredFunctionCall | null): {
  textOutputs: string;
  schemas: SchemaHeaderSheetInfo[];
  htmlContents: string[];
  docUrls: string[];
  slidesUrls: string[];
} {
  if (!task) {
    return {
      textOutputs: '',
      schemas: [],
      htmlContents: [],
      docUrls: [],
      slidesUrls: [],
    };
  }
  const textOutputs: string[] = [];
  const schemas: SchemaHeaderSheetInfo[] = [];
  const htmls = new Set<string>();
  const docUrls = new Set<string>();
  const slidesUrls = new Set<string>();
  const schemaKeys = new Set<string>();

  const traverse = (currentTask: StoredFunctionCall) => {
    // Extract Outputs
    if (task.output) textOutputs.push(toolOutputToString(task.output)!);

    // Extract Schemas
    if (currentTask.schemaHeaderSheetInfo && Array.isArray(currentTask.schemaHeaderSheetInfo)) {
      currentTask.schemaHeaderSheetInfo.forEach(schema => {
        if (schema.sheetInfo && schema.sheetInfo.sheetId) {
          const key = `${schema.sheetInfo.sheetId}-${schema.sheetInfo.sheetTabId || '0'}`;
          if (!schemaKeys.has(key)) {
            schemas.push(schema);
            schemaKeys.add(key);
          }
        }
      });
    }

    // Extract HTML
    if (currentTask.generatedHtml && currentTask.generatedHtml.trim() !== '') {
      htmls.add(currentTask.generatedHtml);
    }

    // Extract Doc URLs
    if (currentTask.generatedDocUrl && currentTask.generatedDocUrl.trim()) {
      docUrls.add(currentTask.generatedDocUrl.trim());
    }

    // Extract Slides URLs
    if (currentTask.generatedSlidesUrl && currentTask.generatedSlidesUrl.trim()) {
      slidesUrls.add(currentTask.generatedSlidesUrl.trim());
    }

    // Recurse into sub-steps
    if (currentTask.multiSteps && currentTask.multiSteps.length > 0) {
      for (const step of currentTask.multiSteps) {
        traverse(step);
      }
    }
  };

  traverse(task);

  return {
    textOutputs: textOutputs.filter(Boolean).join('\n\n---\n\n'),
    schemas: schemas,
    htmlContents: Array.from(htmls),
    docUrls: Array.from(docUrls),
    slidesUrls: Array.from(slidesUrls),
  };
}

export function getSheetUrlFromSheetInfo(sheetId: string, sheetTabId?: number): string {
  if (sheetId === undefined || sheetId === null) return ``;
  const gid = sheetTabId !== undefined && sheetTabId !== null ? sheetTabId : 0;
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit?gid=${gid}`;
}
