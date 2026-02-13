import { PLANNER_FUNCTION_CALLS } from '@rover/shared/lib/utils/constants.js';
import type { FunctionDeclaration, GeminiSchema } from './types.js';

function arrayOfNumbers(description: string): GeminiSchema {
  return {
    type: 'array',
    description,
    items: { type: 'number' },
  };
}

export function getEmbeddedPlannerDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: PLANNER_FUNCTION_CALLS.WEBPAGE_GENERATOR,
      description:
        'Generates a new HTML webpage (dashboards, visualizations, complex layouts). Use when output needs rich layout or charts.',
      parameters: {
        type: 'object',
        properties: {
          user_input: {
            type: 'string',
            description:
              "Detailed instructions for the webpage. Reference data sources via history (e.g. {{history.step[N].text_output}}) or sheet refs ({{history.step[N].sheet[i].tab[j]}}). Do not use element IDs/selectors.",
          },
          source_tab_ids: arrayOfNumbers(
            'Optional tab IDs (from current accessibility trees) used as data sources. If provided, user_input must explain how to use them.',
          ),
          file_inputs: arrayOfNumbers(
            'Optional file_index values from the available files manifest when attachments are required.',
          ),
        },
        required: ['user_input'],
      },
    },
  ];
}
