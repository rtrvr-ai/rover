import type { AgentContext } from './context.js';
import type { PlannerPreviousStep, PreviousSteps, StatusStage } from './types.js';
import { executeExtract } from './extractAgent.js';

export type CrawlOptions = {
  tabOrder: number[];
  userInput: string;
  schema?: any;
  trajectoryId: string;
  recordingContext?: string;
  plannerPrevSteps?: PlannerPreviousStep[];
  previousSteps?: PreviousSteps[];
  files?: any[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  returnDataOnly?: boolean;
  bridgeRpc: (method: string, params?: any) => Promise<any>;
  ctx: AgentContext;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
};

export type CrawlResult = {
  data?: any[];
  schemaHeaderSheetInfo?: any;
  sheetUrl?: string;
  prevSteps?: PreviousSteps[];
  error?: string;
  warnings?: string[];
  creditsUsed?: number;
};

export async function executeCrawl(options: CrawlOptions): Promise<CrawlResult> {
  const result = await executeExtract({
    tabOrder: options.tabOrder,
    userInput: options.userInput,
    schema: options.schema,
    trajectoryId: options.trajectoryId,
    recordingContext: options.recordingContext,
    plannerPrevSteps: options.plannerPrevSteps,
    previousSteps: options.previousSteps,
    files: options.files,
    onStatusUpdate: options.onStatusUpdate,
    returnDataOnly: options.returnDataOnly,
    bridgeRpc: options.bridgeRpc,
    ctx: options.ctx,
    onPrevStepsUpdate: options.onPrevStepsUpdate,
  });

  const warnings = result.warnings ? [...result.warnings] : [];
  warnings.push('Crawl workflow is limited in embed context; processed current page only.');

  return {
    data: result.data,
    schemaHeaderSheetInfo: result.schemaHeaderSheetInfo,
    prevSteps: result.prevSteps,
    error: result.error,
    warnings,
    creditsUsed: result.creditsUsed,
  };
}
