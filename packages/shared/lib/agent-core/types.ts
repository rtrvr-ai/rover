import { SheetInfo } from '../types/index.js';

export type HistorySource = 'sheet' | 'doc' | 'slides' | 'pdf' | 'webpage' | 'output' | 'text_output';

export interface ParsedHistoryPlaceholder {
  stepNumber: number;
  source: HistorySource;
  sheetIndex?: number;
  tabIndex?: number;
  tabTitle?: string;
  assetIndex?: number;
  fullPathAndOps: string;
  original: string;
  explicitTopIndex?: boolean;
}

export interface HistoryArtifactRef {
  artifactId: string;
  kind: 'sheet' | 'doc' | 'slides' | 'pdf' | 'webpage' | 'file' | string;
  storage: 'gcs' | 's3' | 'firebase' | 'inline' | string;
  sizeBytes?: number;
  hash?: string;
  pathPrefix?: string;
}

export interface PlannerStepCanonical {
  stepId: string;
  stepIndex: number;
  toolCall?: Record<string, unknown>;
  functionResponse?: {
    output?: Record<string, unknown>;
    [key: string]: unknown;
  };
  error?: string;
  createdAt?: number;
  accTreeRefs?: string[];
  artifactRefs?: HistoryArtifactRef[];
  schemaHeaderSheetInfo?: Array<{ sheetInfo?: Record<string, unknown> }>;
  userFeedback?: unknown;
  [key: string]: unknown;
}

export interface PlannerStepPromptView {
  stepIndex: number;
  toolCall?: Record<string, unknown>;
  functionResponse?: Record<string, unknown>;
  fieldManifest?: string[];
  thought?: string;
}

export interface HistoryCursor {
  sessionId: string;
  taskId: string;
  latestStepIndex: number;
  digest: string;
  hydrateFromStep?: number;
}

export interface HistorySyncState {
  sessionId: string;
  taskId: string;
  latestStepIndex: number;
  digest: string;
  hydrateFromStep?: number;
}

export interface ResolverUnavailableFormatter {
  (kind: string, details: Record<string, unknown>): unknown;
}

export interface ResolverIO {
  toolOutputToString: (value: unknown) => string;
  getGoogleSheetContent: (args: {
    sheetInfo: SheetInfo;
    authToken?: string;
    tabularStore?: unknown;
  }) => Promise<unknown>;
  getGoogleDocContentForLLM?: (args: { authToken: string; docId: string }) => Promise<unknown>;
  getGoogleSlidesContentForLLM?: (args: { authToken: string; presentationId: string }) => Promise<unknown>;
  getPdfContentForLLM?: (args: { authToken?: string; info: unknown }) => Promise<unknown>;
  getWebpageContentForLLM?: (args: { info: unknown }) => Promise<unknown>;
  formatUnavailable?: ResolverUnavailableFormatter;
}

export interface ResolvePlannerHistoryArgs {
  data: unknown;
  plannerPrevSteps?: any[];
  authToken?: string;
  tabularStore?: unknown;
  returnSourceInfo?: boolean;
  io: ResolverIO;
}

export interface ResolveSheetInfoArgs {
  placeholder: unknown;
  plannerPrevSteps?: any[];
}

export interface ResolveExtractOutputDestinationArgs {
  outputDestination: any;
  plannerPrevSteps?: any[];
  authToken?: string;
  tabularStore?: unknown;
  io: ResolverIO;
}

export interface ResolveCreateSheetOutputParamsArgs {
  outputSheetParameters: any;
  plannerPrevSteps?: any[];
  authToken?: string;
  tabularStore?: unknown;
  io: ResolverIO;
}

export interface PrevStepFunction {
  name?: string;
  args?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export interface PrevStep {
  accTreeId?: string;
  fail?: string;
  userFeedback?: unknown;
  thought?: string;
  data?: string;
  modelParts?: unknown;
  functions?: PrevStepFunction[];
  [key: string]: unknown;
}

export interface PlannerPrevStep {
  textOutput?: unknown;
  modelParts?: unknown;
  thought?: string;
  [key: string]: unknown;
}
