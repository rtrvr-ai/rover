import { RequiredFunctionKey, requiredFunctionNameMap, requiredFunctionNames } from './requiredFunctions.js';
import type { ClientToolDefinition, FunctionCall } from './types.js';
import type { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';

export interface ParsedFunctionCall {
  functionName: string;
  parameters: Record<string, any>;
  rawExpression: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedMessage {
  originalMessage: string;
  cleanedMessage: string;
  functionCalls: ParsedFunctionCall[];
  hasOnlyFunctionCalls: boolean;
}

export function parseMessage(message: string): ParsedMessage {
  const functionCalls = extractFunctionCallsFromMessage(message);

  let cleanedMessage = message;
  const sortedCalls = [...functionCalls].sort((a, b) => b.startIndex - a.startIndex);
  for (const call of sortedCalls) {
    cleanedMessage = cleanedMessage.slice(0, call.startIndex) + cleanedMessage.slice(call.endIndex);
  }

  cleanedMessage = cleanedMessage.replace(/\s+/g, ' ').trim();

  return {
    originalMessage: message,
    cleanedMessage,
    functionCalls,
    hasOnlyFunctionCalls: cleanedMessage === '',
  };
}

export function extractFunctionCallsFromMessage(message: string): ParsedFunctionCall[] {
  const functionCalls: ParsedFunctionCall[] = [];
  const pattern = /@([\w.]+)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(message))) {
    const startIndex = match.index;
    const functionName = match[1];

    const { endIndex, paramsString } = findClosingParenthesis(message, startIndex + match[0].length);
    if (endIndex !== -1) {
      const parameters = parseParameters(paramsString);
      functionCalls.push({
        functionName,
        parameters,
        rawExpression: message.substring(startIndex, endIndex + 1),
        startIndex,
        endIndex: endIndex + 1,
      });
      pattern.lastIndex = endIndex + 1;
    }
  }

  return functionCalls;
}

function isRequiredFunctionKey(name: string): name is RequiredFunctionKey {
  return requiredFunctionNames.has(name as RequiredFunctionKey);
}

function findClosingParenthesis(str: string, startPos: number): { endIndex: number; paramsString: string } {
  let parenCount = 1;
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let escapeNext = false;
  let i = startPos;

  while (i < str.length && parenCount > 0) {
    const char = str[i];

    if (escapeNext) {
      escapeNext = false;
      i++;
      continue;
    }

    if (char === '\\' && (inSingleQuotes || inDoubleQuotes)) {
      escapeNext = true;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (!inSingleQuotes && !inDoubleQuotes) {
      if (char === '(') parenCount++;
      else if (char === ')') parenCount--;
    }

    i++;
  }

  if (parenCount === 0) {
    return { endIndex: i - 1, paramsString: str.substring(startPos, i - 1).trim() };
  }

  return { endIndex: -1, paramsString: '' };
}

function parseParameters(paramsString: string): Record<string, any> {
  if (!paramsString) return {};
  const params: Record<string, any> = {};
  const paramPairs = splitParametersByComma(paramsString);

  for (const pair of paramPairs) {
    const eqIndex = pair.indexOf('=');

    if (eqIndex === -1) {
      params.prompt = cleanParameterValue(pair.trim());
    } else {
      const key = pair.substring(0, eqIndex).trim();
      const value = pair.substring(eqIndex + 1).trim();
      params[key] = cleanParameterValue(value);
    }
  }

  return params;
}

function splitParametersByComma(str: string): string[] {
  const params: string[] = [];
  let current = '';
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let escapeNext = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuotes) inDoubleQuotes = !inDoubleQuotes;
    else if (char === "'" && !inDoubleQuotes) inSingleQuotes = !inSingleQuotes;

    if (!inSingleQuotes && !inDoubleQuotes) {
      if (char === '(') parenDepth++;
      else if (char === ')') parenDepth--;
      else if (char === '[') bracketDepth++;
      else if (char === ']') bracketDepth--;
      else if (char === ',' && parenDepth === 0 && bracketDepth === 0) {
        params.push(current.trim());
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) params.push(current.trim());
  return params;
}

function cleanParameterValue(value: string): any {
  if (!value) return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch {
      // keep as string
    }
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) return parseFloat(value);
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  return value;
}

export function validateFunctionCall(
  functionName: string,
  availableFunctions: Record<string, ClientToolDefinition>,
): {
  isValid: boolean;
  isRequired: boolean;
  isUserDefined: boolean;
  isMcp: boolean;
  mappedFunction?: PLANNER_FUNCTION_CALLS;
  functionDef?: ClientToolDefinition;
  error?: string;
} {
  if (isRequiredFunctionKey(functionName)) {
    return {
      isValid: true,
      isRequired: true,
      isUserDefined: false,
      isMcp: false,
      mappedFunction: requiredFunctionNameMap[functionName],
    };
  }

  if (availableFunctions[functionName]) {
    const func = availableFunctions[functionName];
    return {
      isValid: true,
      isRequired: false,
      isUserDefined: !func.mcpUrl,
      isMcp: !!func.mcpUrl,
      functionDef: func,
    };
  }

  // MCP fallback: match by suffix if tool name lacks domain
  const mcpToolWithoutDomain = Object.entries(availableFunctions).find(([name, func]) => {
    if (!func.mcpUrl) return false;
    const toolNamePart = name.split('.').pop();
    return toolNamePart === functionName;
  });

  if (mcpToolWithoutDomain) {
    const [, func] = mcpToolWithoutDomain;
    return {
      isValid: true,
      isRequired: false,
      isUserDefined: false,
      isMcp: true,
      functionDef: func,
    };
  }

  return {
    isValid: false,
    isRequired: false,
    isUserDefined: false,
    isMcp: false,
    error: `Function "${functionName}" not found`,
  };
}

export function convertParametersToTypes(
  parameters: Record<string, any>,
  functionDef?: ClientToolDefinition,
): Record<string, any> {
  if (!functionDef || !functionDef.parameters) return parameters;

  const converted: Record<string, any> = {};
  for (const [key, value] of Object.entries(parameters)) {
    const paramDef = functionDef.parameters?.[key];
    if (!paramDef || !paramDef.type) {
      converted[key] = value;
      continue;
    }

    switch (paramDef.type) {
      case 'number':
      case 'integer': {
        const num = Number(value);
        converted[key] = Number.isFinite(num) ? num : value;
        break;
      }
      case 'boolean': {
        if (typeof value === 'boolean') converted[key] = value;
        else if (typeof value === 'string') converted[key] = value.toLowerCase() === 'true';
        else converted[key] = !!value;
        break;
      }
      case 'array': {
        if (Array.isArray(value)) converted[key] = value;
        else if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            converted[key] = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            converted[key] = [value];
          }
        } else {
          converted[key] = [value];
        }
        break;
      }
      case 'object': {
        if (typeof value === 'object') converted[key] = value;
        else if (typeof value === 'string') {
          try {
            converted[key] = JSON.parse(value);
          } catch {
            converted[key] = { value };
          }
        } else {
          converted[key] = { value };
        }
        break;
      }
      default:
        converted[key] = value;
    }
  }

  return converted;
}

export function normalizeToolCall(call: FunctionCall): FunctionCall {
  if (!call) return call;
  if (!call.args) call.args = {};
  return call;
}
