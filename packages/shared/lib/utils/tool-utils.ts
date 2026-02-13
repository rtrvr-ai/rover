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
        description: func.description,
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
