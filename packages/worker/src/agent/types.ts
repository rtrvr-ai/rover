import type { ToolOutput } from '@rover/shared/lib/types/index.js';

export type RuntimeToolOutput =
  | ToolOutput
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export type RoverTab = {
  id: number;
  url?: string;
  title?: string;
  windowId?: number;
  external?: boolean;
  accessMode?: 'live_dom' | 'external_placeholder' | 'external_scraped';
  inaccessibleReason?: string;
};

export type ScopedTabRuntimeContext = {
  scopedTabIds?: number[];
  seedTabId?: number;
};

export type ExternalWebConfig = {
  enableExternalWebContext?: boolean;
  allowDomains?: string[];
  denyDomains?: string[];
  scrapeMode?: 'off' | 'on_demand';
};

export type RoverRuntimeContextExternalTab = {
  tabId: number;
  host?: string;
  title?: string;
  accessMode: 'external_placeholder' | 'external_scraped';
  reason?: string;
};

export type RoverRuntimeContext = {
  mode: 'rover_embed';
  agentName?: string;
  externalNavigationPolicy?: 'open_new_tab_notice' | 'block' | 'allow';
  tabIdContract?: 'tree_index_mapped_by_tab_order';
  taskBoundaryId?: string;
  externalTabs?: RoverRuntimeContextExternalTab[];
};

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
};

export type FunctionCall = {
  name?: string;
  args?: Record<string, any>;
};

export type GeminiSchema = {
  type?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  description?: string;
  items?: GeminiSchema;
  nullable?: boolean;
};

export type FunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: GeminiSchema;
};

export type ClientToolDefinition = {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  required?: string[];
  schema?: GeminiSchema;
  llmCallable?: boolean;
  mcpUrl?: string;
};

export type ApiAdditionalToolName = 'generate_sheets' | 'generate_docs' | 'generate_slides' | 'generate_websites';

export type ApiToolsConfig = {
  mode?: 'allowlist' | 'profile' | 'none';
  enableAdditionalTools?: ApiAdditionalToolName[];
  userDefined?: string[];
};

export type ExecutionState = 'running' | 'paused' | 'cancelled';

export type ExecutionRef = {
  current: {
    state: ExecutionState;
    userInputs: string[];
  };
};

export type ToolCall = FunctionCall & { id?: string };

export type PlannerQuestion = {
  key: string;
  query: string;
  id?: string;
  question?: string; // backward-compatible alias from older payloads
  choices?: string[];
  required?: boolean;
};

export type RoverStopState = 'continue' | 'cancel_requested' | 'cancelled' | 'terminal';

export type RoverStopSignal = {
  state?: RoverStopState;
  reason?: string;
};

export type LLMLogEntry = {
  role: 'user' | 'model';
  message?: string;
};

export type AgentLogState = {
  prevSteps?: PreviousSteps[];
  chatLog?: LLMLogEntry[];
};

export type StatusStage = 'analyze' | 'route' | 'execute' | 'verify' | 'complete';

export type TaskRoutingMode = 'auto' | 'act' | 'planner';

export type TaskRoutingConfig = {
  mode?: TaskRoutingMode;
  actHeuristicThreshold?: number;
  plannerOnActError?: boolean;
};

export type PlannerPreviousStep = {
  modelParts?: any[];
  thought?: string;
  toolCall?: { name: string; args: Record<string, any> };
  textOutput?: any;
  error?: string;
  questionsAsked?: PlannerQuestion[];
  userAnswers?: Record<string, any> | string[];
  schemaHeaderSheetInfo?: any;
  generatedContentRef?: any;
  lastToolPreviousSteps?: PreviousSteps[];
  userFeedback?: string[];
};

export type PreviousSteps = {
  accTreeId?: string;
  modelParts?: any[];
  thought?: string;
  functions?: Array<{
    name: string;
    args: Record<string, unknown>;
    response: {
      status: 'Success' | 'Failure' | 'Pending execution';
      error?: string;
      output?: RuntimeToolOutput;
      allowFallback?: boolean;
    };
  }>;
  data?: string;
  fail?: string;
  userFeedback?: string[];
};

export type ToolExecutionResult = {
  toolName?: string;
  output?: RuntimeToolOutput;
  error?: string;
  errorDetails?: any;
  creditsUsed?: number;
  needsUserInput?: boolean;
  questions?: PlannerQuestion[];
  schemaHeaderSheetInfo?: any;
  generatedContentRef?: any;
  generatedTools?: any;
  prevSteps?: PreviousSteps[];
  warnings?: string[];
};

export type PlannerResponse = {
  response: {
    plan?: { toolName: string; parameters: Record<string, any>; thought?: string };
    questions?: PlannerQuestion[];
    taskComplete: boolean;
    modelParts?: any[];
    overallThought?: string;
    accTreeIds?: string[];
    userUsageData?: { creditsUsed?: number };
    error?: string;
    errorDetails?: any;
    warnings?: string[];
  };
  toolResults: ToolExecutionResult[];
  completedWorkflow?: any;
  previousSteps?: PlannerPreviousStep[];
};

export type MessageOrchestratorOptions = {
  message: string;
  tabs: RoverTab[];
  scopedTabIds?: number[];
  seedTabId?: number;
  getScopedTabRuntimeContext?: () => ScopedTabRuntimeContext;
  onScopedTabIdsTouched?: (tabIds: number[]) => void;
  previousMessages?: ChatMessage[];
  trajectoryId: string;
  files?: any[];
  recordingContext?: string;
  previousSteps?: PlannerPreviousStep[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  toolFunctions?: Record<string, any>;
  allowActions?: boolean;
  onAgentCall?: (creditsUsed: number) => void;
  driveAuthToken?: string;
  agentLog?: AgentLogState;
  lastToolPreviousSteps?: PreviousSteps[];
  taskRouting?: TaskRoutingConfig;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
  onPlannerHistoryUpdate?: (steps: PlannerPreviousStep[]) => void;
};

export type PlannerOptions = {
  userInput: string;
  tabs: RoverTab[];
  scopedTabIds?: number[];
  seedTabId?: number;
  getScopedTabRuntimeContext?: () => ScopedTabRuntimeContext;
  onScopedTabIdsTouched?: (tabIds: number[]) => void;
  previousMessages?: ChatMessage[];
  files?: any[];
  trajectoryId: string;
  recordingContext?: string;
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  toolFunctions?: Record<string, any>;
  previousSteps?: PlannerPreviousStep[];
  continuePlanning?: boolean;
  activeWorkflow?: any;
  onAgentCall?: (creditsUsed: number) => void;
  driveAuthToken?: string;
  agentLog?: AgentLogState;
  lastToolPreviousSteps?: PreviousSteps[];
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
  onPlannerHistoryUpdate?: (steps: PlannerPreviousStep[]) => void;
};

export type ToolExecutionContext = {
  toolName: string;
  toolArgs: any;
  userInput: string;
  webPageMapInput?: Record<number, any>;
  tabs: RoverTab[];
  scopedTabIds?: number[];
  seedTabId?: number;
  getScopedTabRuntimeContext?: () => ScopedTabRuntimeContext;
  onScopedTabIdsTouched?: (tabIds: number[]) => void;
  trajectoryId: string;
  plannerPrevSteps?: PlannerPreviousStep[];
  files?: any[];
  onStatusUpdate?: (message: string, thought?: string, stage?: StatusStage) => void;
  toolFunctions?: Record<string, any>;
  previousMessages?: ChatMessage[];
  recordingContext?: string;
  onAgentCall?: (creditsUsed: number) => void;
  bridgeRpc?: (method: string, params?: any) => Promise<any>;
  ctx?: any;
  functionDeclarations?: FunctionDeclaration[];
  driveAuthToken?: string;
  agentLog?: AgentLogState;
  onPrevStepsUpdate?: (steps: PreviousSteps[]) => void;
};
