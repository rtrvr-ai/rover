import type { ClientToolDefinition, FunctionDeclaration, GeminiSchema } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, ClientToolDefinition>();

  registerTool(def: ClientToolDefinition): void {
    if (!def?.name) return;
    this.tools.set(def.name, def);
  }

  getTool(name: string): ClientToolDefinition | undefined {
    return this.tools.get(name);
  }

  getToolFunctions(): Record<string, ClientToolDefinition> {
    const out: Record<string, ClientToolDefinition> = {};
    for (const [name, def] of this.tools.entries()) out[name] = def;
    return out;
  }

  getFunctionDeclarations(): FunctionDeclaration[] {
    const declarations: FunctionDeclaration[] = [];
    for (const def of this.tools.values()) {
      if (def.llmCallable === false) continue;
      const parameters = def.schema ?? buildSchemaFromParameters(def.parameters || {}, def.required || []);
      declarations.push({
        name: def.name,
        description: def.description,
        parameters,
      });
    }
    return declarations;
  }
}

function buildSchemaFromParameters(
  parameters: Record<string, any>,
  required: string[] = [],
): GeminiSchema {
  const properties: Record<string, GeminiSchema> = {};

  for (const [paramName, param] of Object.entries(parameters)) {
    if (!param || typeof param !== 'object') continue;

    const type = String(param.type || 'string');
    const base: GeminiSchema = {
      type: normalizeType(type),
      description: param.description,
      nullable: !required.includes(paramName),
    };

    if (type === 'array' && param.items) {
      base.items = {
        type: normalizeType(param.items.type || 'string'),
        description: param.items.description,
      };
    }

    if (type === 'object' && param.properties) {
      base.properties = {};
      for (const [key, nested] of Object.entries(param.properties)) {
        base.properties[key] = {
          type: normalizeType((nested as any)?.type || 'string'),
          description: (nested as any)?.description,
        };
      }
      if (Array.isArray(param.required)) base.required = param.required;
    }

    properties[paramName] = base;
  }

  return {
    type: 'object',
    properties,
    required,
  };
}

function normalizeType(type: string): string {
  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array':
    case 'object':
      return type;
    default:
      return 'string';
  }
}

