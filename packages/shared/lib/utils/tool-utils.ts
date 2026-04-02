import { FunctionDeclaration, Type } from '@google/genai';
import { CustomFunction } from '../types/index.js';

export const getToolFunctionDeclarations = (toolFunctions?: {
  [name: string]: CustomFunction;
}): FunctionDeclaration[] => {
  const functionDeclarations: FunctionDeclaration[] = [];
  for (const functionName in toolFunctions) {
    const func = toolFunctions[functionName];
    if (func.llmCallable) {
      const parameters: { [key: string]: { type: Type; description?: string; default: any } } = {}; // SchemaType is now enforced
      for (const paramName in func.parameters) {
        const param = func.parameters[paramName];
        let schemaType: Type; // No longer optional
        switch (param.type) {
          case 'string':
            schemaType = Type.STRING;
            break;
          case 'number':
            schemaType = Type.NUMBER;
            break;
          case 'integer':
            schemaType = Type.INTEGER;
            break; // Or NUMBER if Gemini doesn't distinguish
          case 'boolean':
            schemaType = Type.BOOLEAN;
            break;
          case 'array':
          case 'object':
            schemaType = Type.STRING; // Treat as stringified JSON
            break;
          default:
            // Handle or throw an error for truly unknown types:
            console.error(`Unsupported parameter type: ${param.type} for ${functionName}.${paramName}`);
            schemaType = Type.STRING; // Default to string to avoid stopping execution. Or throw an error.
        }
        parameters[paramName] = {
          type: schemaType,
          description: param.description,
          default: param.default,
          // required: param.required,
        };
      }
      functionDeclarations.push({
        name: functionName,
        description: buildToolDescription(functionName, func),
        parameters: {
          type: Type.OBJECT,
          properties: parameters,
          required: func.required ?? Object.keys(parameters),
        },
      });
    }
  }
  return functionDeclarations;
};

function buildToolDescription(functionName: string, func: CustomFunction): string | undefined {
  const annotations = func && typeof func === 'object' && typeof (func as any).annotations === 'object'
    ? (func as any).annotations
    : undefined;
  const title = typeof (func as any).title === 'string' ? String((func as any).title).trim() : '';
  const description = typeof func.description === 'string' ? func.description.trim() : '';
  const whenToUse = typeof annotations?.whenToUse === 'string' ? String(annotations.whenToUse).trim() : '';
  const whyUse = typeof annotations?.whyUse === 'string' ? String(annotations.whyUse).trim() : '';
  const examples = Array.isArray(annotations?.examples)
    ? annotations.examples.map((example: unknown) => String(example || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const parts = [title, description];
  if (whenToUse) parts.push(`When to use: ${whenToUse}`);
  if (whyUse) parts.push(`Why use this path: ${whyUse}`);
  if (examples.length) parts.push(`Examples: ${examples.join(' | ')}`);
  const joined = parts.filter(Boolean).join(' ').trim();
  return joined || functionName;
}
