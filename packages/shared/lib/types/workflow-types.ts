// packages/shared/lib/types/workflow-types.ts

import type {
  CustomFunction,
  GEMINI_MODEL,
  LLMFunction,
  LLMIntegration,
  PageData,
  PreviousSteps,
  ProxyConfig,
  RtrvrAIOptions,
  SheetInfo,
  TabData,
  TabInfo,
  ToolOutput,
  UserProfile,
} from './index.js';
import type { PLANNER_FUNCTION_CALLS, FUNCTION_CALLS } from '../utils/constants.js';
import { ArtifactKind, DocInfo, ExistingDocMode, ReuseArtifacts, SlidesInfo } from './artifact-types.js';

type UserUsageData = unknown;
type FunctionDeclaration = { name: string; description?: string; parameters?: Record<string, any> };
type Schema = any;
type Part = unknown;
type MutableRefObject<T> = { current: T };

// --- Planner Specific Types ---

// Input data structure for the client-side planTask function
export interface PlannerData {
  userInput: string;
  // NEW: Pass the list of relevant tab IDs instead of the pre-computed map
  tabOrder: Array<number>;
  previousSteps?: PlannerPreviousStep[];
  lastToolPreviousSteps?: ToolPreviousSteps;
  chatLog?: LLMLogEntry[];
  llmIntegration: LLMIntegration;
  files?: LLMDataInput[];
  recordingContext?: string;
  userFunctionDeclarations?: FunctionDeclaration[];
  setExportToSheetStatus?: (status: ExportToSheetStatus) => void;
  executionRef: MutableRefObject<{ state: ExecutionState; userInputs: string[] }>;
  continuePlanning?: boolean;
  setOptionsState?: (newOptions: Partial<RtrvrAIOptions>) => void;
  trajectoryId: string;
}

// Interface for the context needed to resume planner after func call
export interface PlannerResumeContext {
  lastPlannerResponse: PlanTaskResponse;
  currentPlannerHistory: PlannerPreviousStep[];
  lastToolPreviousSteps?: ToolPreviousSteps;
  initialUserInput: string;
  activeWorkflowId?: string;
}

// Interface for storing intermediate page fetch results with metadata
export interface PlannerFetchedPageResult {
  tabId: number;
  pageData: WebPage;
  wasOnlyTextContent?: boolean;
}

export interface PlannerQuestion {
  // camelCase
  key: string;
  query: string;
  id?: string;
  question?: string;
  choices?: string[];
  /** True by default. Set false for non-blocking preference questions. */
  required?: boolean;
}

// Bhavani TO_DO: In the future, see if you wanna add support: file and image outputs, generated html full code
// --- PlannerPreviousStep: Log of interaction with the planner and tool execution outcome ---
export interface PlannerPreviousStep {
  // Model's complete response (ALL parts exactly as generated)
  modelParts?: Part[]; // Includes thoughtSignature, thought, text, functionCall - everything

  // Planner's thought process for *this* step in the overall plan
  thought?: string;

  // The tool call planned by the planner in this step
  toolCall?: {
    name: PLANNER_FUNCTION_CALLS | string; // Tool name (e.g., "extract_from_tab", "user_defined_tool_abc")
    args: Record<string, unknown>; // Arguments for the tool, matching planner's output (snake_case keys)
  };

  // If planner asked questions in this step
  questionsAsked?: PlannerQuestion[];
  // User's answers to those questions (provided before the next planning cycle)
  userAnswers?: Record<string, any>;

  // Outcome of the tool execution that resulted from the planner's decision in this step
  textOutput?: ToolOutput; // text output of what the tool did or produced
  error?: string; // Error message if the tool execution failed
  schemaHeaderSheetInfo?: SchemaHeaderSheetInfo[]; // Information about any Google Sheets created or modified by this step's tool

  /**
   * NEW: References to generated artifacts (docs/slides/pdfs/webpages) created by this step.
   * Kept lightweight; content is fetched ONLY when resolving history placeholders.
   */
  generatedContentRef?: GeneratedContentReferences;

  // Contextual information relevant to this step in history
  accTreeIds?: string[]; // Accessibility tree IDs relevant *before* this step's action was taken
  userFeedback?: string[]; // User feedback provided *after* this step's tool completed and *before* the next planning cycle began
}

// Structure for the arguments of EXECUTE_MULTIPLE_TOOLS
export interface ToolCallSpec {
  tool_name: string; // Name of the client-side function
  tool_args: Record<string, unknown>; // Arguments for that function (may contain \`T:0;E:112\` format initially)
}

// --- Planner Request/Response ---
export interface PlanTaskRequest {
  isUserAnonymous?: boolean;
  userInput: string;
  outputSchema?: Schema;
  // Input: Represents the state of relevant tabs *before* this planning request
  webPageMap?: Record<number, PageData>; // Input TabData data keyed by tabId
  tabOrder?: number[];
  previousSteps?: PlannerPreviousStep[]; // List of previous step details
  lastToolPreviousSteps?: ToolPreviousSteps;
  chatLog?: LLMLogEntry[];
  llmIntegration: LLMIntegration;
  userProfile?: UserProfile;
  files?: LLMDataInput[];
  recordingContext?: string; // Recording ID/name
  userFunctionDeclarations?: FunctionDeclaration[];
  authToken?: string;
  timestamp: string;
  continuePlanning?: boolean;
  trajectoryId: string;
}

export interface ToolPreviousSteps {
  name: string;
  prevSteps?: PreviousSteps[];
}

export interface PlannedStep {
  toolName: PLANNER_FUNCTION_CALLS | string; // snake_case value
  // Parameters object passed to LLM: keys MUST be snake_case
  parameters: {
    tab_id?: number;
    file_inputs?: number[]; //indices here
    resolved_file_ids?: string[]; //ids of the files resolved

    user_input?: string;
    schema?: Schema; // Added for schema support

    user_question?: string; // For query docs tool

    // --- Output Destination Params (snake_case) ---
    output_destination?: PlannerExistingSheetParams &
      PlannerNewSheetParams &
      PlannerExistingDocParams &
      PlannerExistingSheetParams;

    // --- SHEETS_WORKFLOW Params (snake_case) ---
    max_concurrency?: number;
    tab_reuse_policy?: SheetsTabReusePolicy;
    source_sheet_from_history?: string;
    sheet_title?: string;
    sheet_tab_title?: string;
    first_row_is_header?: boolean;
    input_column_header?: string;
    input_column_ordinal_position?: number;
    context_column_headers?: string[];
    context_column_ordinal_positions?: number[];
    start_row?: number; // NEW: Optional 1-based absolute start row
    end_row?: number; // NEW: Optional 1-based absolute end row (inclusive)
    workflow_steps?: PlannerWorkflowStepDefinition[]; // Key part of new sheets_workflow

    // INFER_SHEET_DATA specific params
    // sheet_title, sheet_tab_title, first_row_is_header, start_row, end_row already listed
    // user_input, schema also already listed
    input_column_headers?: string[]; // For infer_sheet_data (using plural for clarity as it might take multiple)
    input_column_ordinal_positions?: number[]; // For infer_sheet_data
    processing_mode?: InferWorkflowMode;

    // CREATE_SHEET_FROM_DATA
    data_inputs?: string[];
    task_instruction?: string; // used for PROCESS_TEXT too
    output_sheet_parameters?: PlannerNewSheetParams;

    // PROCESS_TEXT
    text_inputs?: string[];

    // Generation task: PDF_FILLER, WEBPAGE_GENERATOR, GRAPHBOT
    source_file_index?: number;
    resolved_source_file_id?: string;
    source_tab_id?: number;
    source_tab_ids?: Array<number>;

    // --- EXECUTE_MULTIPLE_TOOLS Param ---
    // Note: tool_args inside tool_calls will have resolved values
    tool_calls?: ToolCallSpec[];

    // ASK_USER
    questions_to_ask?: PlannerQuestion[];

    // TASK_COMPLETE
    reason?: string;

    [key: string]: any; // Allow other snake_case params
  };
  thought?: string;
  questions?: PlannerQuestion[];
  serverResult?: { success: boolean; data?: any; error?: string };
}

export interface PlannerExistingSheetParams {
  existing_sheet_id?: string;
  existing_tab_title?: string;
  existing_sheet_from_history?: string;
}

export interface PlannerExistingDocParams {
  existing_doc_id?: string;
  existing_doc_from_history?: string;
  mode: ExistingDocMode;
  rename_on_overwrite?: boolean;
}

export interface PlannerExistingSlidesParams {
  existing_presentation_id?: string;
  existing_presentation_from_history?: string;
  mode: ExistingDocMode;
  rename_on_overwrite?: boolean;
}

export interface PlannerNewSheetParams {
  new_sheet_title: string;
  new_tab_title: string;
}

// For SHEETS_WORKFLOW steps
export interface PlannerWorkflowStepDefinition {
  step_name: string;
  tool: PLANNER_FUNCTION_CALLS.ACT | PLANNER_FUNCTION_CALLS.EXTRACT | PLANNER_FUNCTION_CALLS.CRAWL;
  user_input_template: string;
  schema?: Schema; // Optional for act, required for extract/crawl if they are to produce structured output
  tab_management: {
    source: string; // "new", "current", "step.PREVIOUS_STEP_NAME"
    url_template?: string;
    ensure_url?: 'none' | 'navigate';
  };
  file_inputs?: number[]; //indices here
  resolved_file_ids?: string[]; //resolved file ids
  output_mapping: SheetOutputFormat;
  output_sheet_parameters?: { new_tab_title_template?: string }; // Optional, for finer control if 'new_tab'
}

export interface PlanTaskResponse {
  plan?: PlannedStep;
  webPageMapInput?: Record<number, PageData>;
  questions?: PlannerQuestion[];
  taskComplete: boolean;
  modelParts?: Part[];
  overallThought?: string;
  accTreeIds?: string[]; // IDs of the *current* accessibility trees used for this plan
  userUsageData?: UserUsageData;
  error?: string;
  warnings?: string[];
}

export interface WebPage {
  url: string;
  title: string;
  content?: string;
  sheetInfo?: SheetInfo; // optional sheetInfo for content type GOOGLE_SHEET_MIME_TYPE
  accTreeId?: string;
  roots?: number[];
  nodes?: Record<number, any>;
  contentType: string;
  originalTabUrl?: string;
  dataContext?: string; //data context string for the tab
  parentTabUrl?: string;
}

export const USER_ROLE = 'user';
export const USER_IMAGE_ROLE = 'user_image';
export const USER_FILE_ROLE = 'user_file';
export const MODEL_ROLE = 'model';
export const MODEL_IMAGE_ROLE = 'model_image';
export const GRAPHBOT_ROLE = 'graphbot';
export const FUNCTION_ROLE = 'function';
export const SYSTEM_ROLE = 'system';
export const TOOL_ROLE = 'tool';
export const ASSISTANT_ROLE = 'assistant';
export const RTRVR_AI_ROLE = 'rtrvr.ai';
export const RTRVR_AI_WARNING_ROLE = 'rtrvr_ai_warning';
export interface LLMLogEntry {
  role?:
    | typeof USER_ROLE
    | typeof MODEL_ROLE
    | typeof USER_IMAGE_ROLE
    | typeof USER_FILE_ROLE
    | typeof MODEL_IMAGE_ROLE
    | typeof GRAPHBOT_ROLE
    | typeof FUNCTION_ROLE
    | typeof SYSTEM_ROLE
    | typeof TOOL_ROLE
    | typeof ASSISTANT_ROLE
    | typeof RTRVR_AI_ROLE
    | typeof RTRVR_AI_WARNING_ROLE;
  prevSteps?: PreviousSteps[];
  message?: string;
  function?: LLMFunction;
}

export interface ChatLog {
  id: string;
  role: LLMLogEntry['role'];
  content: string;
  timestamp: number | any; // number or Firebase Timestamp

  // Execution metadata
  functionCall?: StoredFunctionCall;
  creditsUsed?: number;
  // Attachments
  attachments?: {
    files: ChatAttachmentFile[];
    sheets: LinkInfo[];
  };

  // Additional metadata
  mimeType?: string;
  messageContext?: string;
  taskId?: string;
  executionId?: string;
  error?: string;
  warnings?: string[];
}

export interface DisplayLog {
  id: string;
  title: string;
  chatLogs: ChatLog[];
  createdAt: number;
  // Persist Acc Tree IDs across trajectory?
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  lastMessageAt?: number;
}

export type ExecutionState = 'idle' | 'running' | 'paused' | 'cancelled';
export type ExecutionStatus = 'executing' | 'success' | 'error' | 'cancelled' | 'paused' | 'waiting_input' | '';
export interface ExportToSheetStatus {
  status: ExecutionStatus;
  message: string;
  callingFunction: FUNCTION_CALLS | string; // Could be FUNCTION_CALLS (user readable) or 'Planner', or user-defined tool string
  action?: string;
  thought?: string;
  // NEW: Add questions field
  questions?: PlannerQuestion[] | null;
}

// A type representing a reference to a large artifact in storage
export interface ArtifactReference {
  $ref: string; // The full path to the artifact in Cloud Storage
  size?: number; // Optional: store the size in bytes
  contentType?: string; // Optional: store the content type
}

export interface GeneratedSheetData {
  sheetId: string;
  sheetTitle?: string;
  sheetTab: string;
  sheetTabId?: number;
  // MODIFIED: sheetData can now be the data itself or a reference to it
  sheetData: any[][] | ArtifactReference;
}

export interface GeneratedDocData {
  docId: string;
  // MODIFIED: docHTMLData can now be the data itself or a reference
  docHTMLData: string | ArtifactReference;
}

export interface GeneratedWebPageData {
  url: string;
  // MODIFIED: htmlData can now be the data itself or a reference
  htmlData: string | ArtifactReference;
}

// Interface for params to extract custom data heading info
export interface ExtractDataHeadingInfo {
  headings: Array<string>;
  schema: Schema;
  title?: string;
  dimensions?: Array<string>;
}

export interface SchemaHeaderSheetInfo {
  headingInfo: ExtractDataHeadingInfo;
  sheetInfo: SheetInfo;
  headerRow?: Array<string>;
}

export interface LinkInfo {
  url: string;
  text: string;
  sheetId?: string;
  sheetTabId?: string;
}

export enum SchemaWorkflowType {
  Extract = 'Extract',
  Crawl = 'Crawl',
  Infer = 'Infer',
}

export interface ActWorkflow {
  tabId: number;
  fileInputs?: string[]; // indices of files to be passed
  userInput: string;
  files?: LLMDataInput[];
  schema?: Schema;
}

export type ExtractWorkflow = CrawlWorkflow; // Currently both are same, can change in future

export interface CrawlWorkflow {
  tabId: number;
  fileInputs?: string[]; // indices of files to be passed
  userInput: string;
  schema: Schema;
  outputDestination?: ExistingSheetParams & NewSheetParams;
  followLinks?: boolean; // Add this
  maxPages?: number;
}

// How's the workflow step output written/stored
export enum SheetOutputFormat {
  COLUMNS = 'columns',
  NEWTAB = 'new_tab',
  CONTEXT = 'context_only',
}

export enum InferWorkflowMode {
  ROWBYROW = 'row_by_row',
  ALLATONCE = 'all_at_once',
}

export enum SheetsTabReusePolicy {
  AUTO = 'auto',
  REUSE_SINGLE_TAB = 'reuse_single_tab',
  REUSE_BY_URL = 'reuse_by_url',
  NEVER = 'never',
}

// Interface for sheets workflow data
export interface SheetsWorkflow {
  fileInputs?: string[]; // indices of files to be passed
  workflowSteps: SheetsWorkflowStep[];
  sheetName: string;
  sheetId?: string;
  sheetTabTitle?: string;
  sheetTabId?: number;
  maxConcurrency?: number;
  tabReusePolicy?: SheetsTabReusePolicy;
  sourceSheetFromHistory?: string; //If referencing sheet from history
  inputColumnHeader?: string;
  inputColumnOrdinalPosition?: number; //Number of the input url column if no headers are present
  contextColumnHeaders?: string[];
  contextColumnOrdinals?: number[]; //Numbers of the context url columns if no headers are present
  contextRecordingId?: string;
  isFirstRowHeader: boolean;
  deleteTabsAfterRun: boolean;
  startRowIndex?: number;
  endRowIndex?: number;

  /**
   * Portable “starting point” for row-level browser steps.
   * MUST be URL-based (tabIds are not portable across distributed workers).
   * Filled by planner orchestration from the primary tab URL (tabOrder[0]) when available.
   */
  initialTabContext?: {
    primaryUrl?: string;
    urls?: string[];
  };
}

export interface SheetsWorkflowStep {
  stepName: string;
  // adding PLANNER_FUNCTION_CALLS.PROCESS_TEXT only on client side just to be failsafe, planner wasnt guided on using process text
  tool:
    | PLANNER_FUNCTION_CALLS.ACT
    | PLANNER_FUNCTION_CALLS.EXTRACT
    | PLANNER_FUNCTION_CALLS.CRAWL
    | PLANNER_FUNCTION_CALLS.PROCESS_TEXT
    | string;
  userInputTemplate: string; // user_input_template
  taskInstruction?: string; // For process text
  textInputs?: string[]; // For process text
  toolArgs?: Record<string, any>; // For user defined tool
  files?: LLMDataInput[];
  schema?: Schema; // Optional for act, required for extract/crawl if they are to produce structured output
  tabManagement: {
    source: 'new' | 'current' | string; // "new", "current", "step.PREVIOUS_STEP_NAME" - will be resolved
    urlTemplate?: string; // If 'inputUrlColumn' is a URL and source is 'new', this will be omitted
    /**
     * Optional: when source='current' and urlTemplate is provided,
     * enforce that the current tab is at that URL.
     * Default: 'navigate' when urlTemplate exists, else 'none'.
     */
    ensureUrl?: 'none' | 'navigate';
  };
  fileInputs?: string[]; // indices of files to be passed
  outputMapping: SheetOutputFormat;
  outputSheetParameters?: { newTabTitleTemplate?: string }; // Optional if new Tab is needed and is resolved from template
  followLinks?: boolean; // Add this
  maxPages?: number;
}

export interface InferSheetWorkflow {
  fileInputs?: string[]; // indices of files to be passed
  sheetId?: string;
  sheetTabTitle?: string;
  sheetTabId?: number;
  sourceSheetFromHistory?: string; //If referencing sheet from history
  isFirstRowHeader: boolean;
  userInput: string;
  schema?: Schema;
  inputColumnHeaders?: string[];
  inputColumnOrdinalPositions?: number[];
  processingMode: InferWorkflowMode;
  startRowIndex?: number;
  endRowIndex?: number;
  returnDataOnly?: boolean;
  // Ideally planner shouldn't return these but to safe fallback
  // If provided tab title is picked from here
  outputDestination?: ExistingSheetParams & NewSheetParams;
  outputSheetParameters?: NewSheetParams & ExistingSheetParams;
  files?: LLMDataInput[]; //any attached in the chat
}

export interface CreateSheetWorkflow {
  fileInputs?: string[]; // indices of files to be passed
  dataInputs: string[];
  taskInstruction: string;
  schema: Schema;
  outputSheetParameters: NewSheetParams & ExistingSheetParams; //mostly it will be just NewSheetParams
  // from Planner, when re-running with re-use sheet, use existing sheet params
}

// For SHEETS_WORKFLOW steps
export interface PlannerSheetsWorkflowStep {
  step_name: string;
  tool:
    | PLANNER_FUNCTION_CALLS.ACT
    | PLANNER_FUNCTION_CALLS.EXTRACT
    | PLANNER_FUNCTION_CALLS.CRAWL
    | PLANNER_FUNCTION_CALLS.PROCESS_TEXT
    | string;
  user_input_template: string;
  task_instruction?: string;
  text_inputs?: string[];
  tool_args?: Record<string, any>;
  schema?: Schema;
  tab_management: {
    source: 'new' | 'current' | string; // 'string' for 'step.PREVIOUS_STEP_NAME'
    url_template?: string;
    ensure_url?: 'none' | 'navigate';
  };
  file_inputs?: number[]; //indices here
  resolved_file_ids?: string[]; //resolved file ids
  output_mapping: SheetOutputFormat;
  output_sheet_parameters?: {
    new_tab_title_template?: string;
  };
}

export interface ProcessTextWorkflow {
  fileInputs?: string[]; // indices of files to be passed
  textInputs: string[];
  taskInstruction: string;
  schema?: Schema;
}

export interface QueryRtrvrDocsWorkflow {
  userQuestion: string;
}

export interface NewSheetParams {
  newSheetTitle: string;
  newTabTitle: string;
}

export interface ExistingSheetParams {
  existingSheetId?: string;
  existingTabTitle?: string;
  /** NEW (preferred by planner): pass '{{history.step[N].sheet[i].tab[j]}}' */
  existingSheetFromHistory?: string; // NEW (preferred by planner)
}

export interface ExistingDocParams {
  existingDocId?: string;
  /** NEW: pass '{{history.step[N].doc[i]}}' (preferred) */
  existingDocFromHistory?: string;
  mode: ExistingDocMode;
  /** Bhavani: In the future we can have this */
  renameOnOverwrite?: boolean;
}

export interface ExistingSlidesParams {
  existingPresentationId?: string;
  /** NEW: pass '{{history.step[N].slides[i]}}' (preferred) */
  existingPresentationFromHistory?: string;
  mode: ExistingDocMode;
  /** Bhavani: In the future we can have this */
  renameOnOverwrite?: boolean;
}

export interface NewSheetParams {
  newSheetTitle: string;
  newTabTitle: string;
}

export interface GenerationWorkflow {
  // for GRAPHBOT, PDF_FILLER, WEBPAGE_GENERATOR, GOOGLE_DOC_GENERATOR, GOOGLE_SLIDES_GENERATOR
  // Generation task: PDF_FILLER, WEBPAGE_GENERATOR, GRAPHBOT, GOOGLE_DOC_GENERATOR, GOOGLE_SLIDES_GENERATOR
  sourceFileIndex?: string; // file_index is
  sourceTabId?: number;
  sourceTabIds?: Array<number>;
  fileInputs?: string[]; // indices of files to be passed
  userInput: string;
  outputDestination?: ExistingDocParams | ExistingSlidesParams;
}
export interface AgentLog {
  prevSteps?: PreviousSteps[];
  chatLog?: LLMLogEntry[];
}

// Interface for generating LLM Responses for adhoc
export enum GenerationIntent {
  Code = 'Code',
  Cron = 'Cron',
  Graph = 'Graph',
  PDFFill = 'PDFFill',
  ToolGenerate = 'ToolGenerate',
  WebPageGenerate = 'WebPageGenerate',
  GoogleDocGenerate = 'GoogleDocGenerate',
  GoogleSlidesGenerate = 'GoogleSlidesGenerate',
  ProcessText = 'ProcessText',
  CreateSheetFromData = 'CreateSheetFromData',
  QueryRtrvrAIDocs = 'QueryRtrvrAIDocs',
  EnhancePrompt = 'EnhancePrompt',
}

// Interface for GenerateLLM Request
export interface GenerationTaskRequest {
  userInput?: string;
  llmIntegration: LLMIntegration;
  generationIntent: GenerationIntent;
  processText?: ProcessTextRequest;
  createSheet?: CreateSheetFromDataRequest;
  queryRtrvrDocs?: QueryRtrvrDocsRequest;
  tabOrder: Array<number>;
  webPageMap?: Record<number, WebPage> | null; // WebPage associated with each tabId for graphGenerator
  files?: LLMDataInput[];
  accessibilityTreeMap?: Record<number, string>; // Accessibility Tree associated with each tabId
  recordingContext?: string;
  functionDeclarations?: FunctionDeclaration[];
  agentLog?: AgentLog;
  plannerPrevSteps?: PlannerPreviousStep[]; //PlannerPreviousStep[] to resolve placeholders in toolArgs
  authToken?: string;
  userProfile?: UserProfile;
  timestamp: string; // timestamp for LLM instr
  trajectoryId: string;
}

// Interface for GenerateLLM Response
export type GenerationTaskResponse = {
  llmOutput?: string;
  filledPdfs?: string[];
  processText?: ProcessTextResponse;
  createSheet?: CreateSheetFromDataResponse;
  googleDocUrl?: string;
  googleSlidesUrl?: string;
  generatedTool?: CustomFunction;
  queryRtrvrDocs?: QueryRtrvrDocsResponse;
  generatedPrompt?: EnhancePromptResponse;
  warnings?: string[];
} & { userUsageData: UserUsageData };

export interface EnhancePromptResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  text_output?: string;
}

// Interface for extracted PDF form field info
export interface PdfFieldInfo {
  name: string;
  type: string;
  options?: string[];
}

// Interface for the result of processing and filling one PDF
export interface FilledPdfResult {
  status: 'success' | 'error';
  data?: string; // Base64 encoded filled PDF data
  mimeType?: string;
  errorMessage?: string;
  originalIndex: number; // Keep track of original order if needed
}

export interface ProcessTextRequest {
  textInputs: string[];
  taskInstruction: string;
  schema?: Schema;
  plannerPrevSteps?: PlannerPreviousStep[];
}

export type ProcessTextResponse = {
  text?: string; // For unstructured output
  data?: Record<string, any> | Record<string, any>[]; // For structured output
  thought?: string;
  error?: string;
};

export interface CreateSheetFromDataRequest {
  dataInputs: string[];
  taskInstruction: string;
  schema: Schema;
  outputSheetParameters: NewSheetParams & ExistingSheetParams; //mostly this is new for re-runs with reuse sheet existing will be passed
  plannerPrevSteps?: PlannerPreviousStep[];
}

export type CreateSheetFromDataResponse = {
  // Data returned by the server for this tool
  ok?: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  sheetInfo?: SheetInfo;
};

export interface SlideContent {
  title: string;
  content: SlideElement[];
}

export interface Theme {
  slideBackgroundColor: string;
  textColor: string;
  accentColor: string;
}

export type SlideElement =
  | {
      type: 'text';
      value: string;
    }
  | {
      type: 'image';
      url: string;
      altText?: string;
    };

export interface StructuredSlide {
  title: string;
  layout?: 'title_and_body' | 'two_column_text_image' | 'two_column_image_text';
  content: SlideElement[];
}

export interface QueryRtrvrDocsRequest {
  userQuestion: string;
}

export interface QueryRtrvrDocsResponse {
  ok?: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  text_output?: string;
}

// Define the structure of a single documentation item
export interface RtrvrDocItem {
  title: string;
  description?: string;
  content: string;
  href: string;
  section: string;
}

export type SystemWorkflows =
  | ActWorkflow
  | ExtractWorkflow
  | CrawlWorkflow
  | SheetsWorkflow
  | InferSheetWorkflow
  | CreateSheetWorkflow
  | ProcessTextWorkflow
  | QueryRtrvrDocsWorkflow
  | GenerationWorkflow;

export type SystemWorkflowsWithFile =
  | ActWorkflow
  | ExtractWorkflow
  | CrawlWorkflow
  | SheetsWorkflow
  | InferSheetWorkflow
  | CreateSheetWorkflow
  | ProcessTextWorkflow
  | GenerationWorkflow;

// Structure for the arguments of EXECUTE_MULTIPLE_TOOLS
export interface ToolCallSpec {
  tool_name: string; // Name of the client-side function
  tool_args: Record<string, unknown>; // Arguments for that function (may contain \`TabID 0: Element 72 iframe_id=3\` format initially)
}

/**
 * GeneratedContentReferences - References to generated content
 */
export interface GeneratedContentReferences {
  webpages?: CloudFileDescriptor[]; // uploaded html files
  pdfs?: CloudFileDescriptor[]; // uploaded pdf files
  docs?: DocInfo[]; // google docs metadata
  slides?: SlidesInfo[]; // google slides metadata
}

export interface CloudFileDescriptor {
  id: string; // stable id for response arrays

  /** Human-friendly name surfaced to the LLM, e.g. "Resume-2025.pdf" */
  displayName: string;

  /** Mime type for LLM / sites, e.g. "application/pdf" */
  mimeType: string;

  /** HTTPS download URL if we have one (Firebase Storage URL) */
  storageUrl?: string;

  /** Optional GCS URI, if resolvable from storageUrl or directly provided */
  gcsUri?: string;

  /** Optional size in bytes (can be added later) */
  sizeBytes?: number;

  // optional direct access (mainly apiMode / external clients)
  downloadUrl?: string; // signed url OR firebase download URL
  expiresAt?: string; // ISO

  // optional useful metadata
  kind?: ArtifactKind; // 'pdfs'|'webpage' etc
  sourceStepId?: string;
  originalIndex?: number; // useful for pdfFiller
}

/**
 * Passing encoded data and
 */
export interface LLMDataInput extends CloudFileDescriptor {
  /**
   * Optional base64-encoded data when you really want inlineData.
   * Can be omitted for cloud refs where you only want upload-by-URI.
   */
  data?: string;
  ORIGIN_KEY?: 'user' | 'tool';
}

/** What we store in ChatMessage.attachments.files */
export interface ChatAttachmentFile extends CloudFileDescriptor {
  isImage?: boolean;
  width?: number;
  height?: number;
}

export type TabExecutionMode = 'new_tabs' | 'current_context' | 'reuse_tabs';

// --- StoredFunctionCall: Represents a logged task/workflow instance. ---
// This can be a top-level task initiated by the user/planner,
// or a sub-step within a complex tool like EXECUTE_MULTIPLE_TOOLS or SHEETS_WORKFLOW.
export interface StoredFunctionCall {
  id: string; // Unique ID for this specific task instance or log entry

  // --- Core details of the tool/function that was planned or called ---
  toolName: PLANNER_FUNCTION_CALLS | string; // The specific planner tool (e.g., PLANNER_FUNCTION_CALLS.EXTRACT) or PLANNER start/default or a user-defined function name.
  systemWorkflow?: SystemWorkflows; // If System Workflow this will be set
  toolArgs?: PlannedStep['parameters']; // The arguments (parameters) passed to this tool. , for user-defined tool, this will be set
  // For planner tools, these are the snake_case parameters from PlannedStep.
  // For user-defined functions, these are its specific arguments.

  // --- Contextual information for this task/step ---
  userInput?: string; // The original user input or specific sub-instruction that (eventually) led to this tool call.

  // For sub-steps, this might be a template-resolved input.
  selectedChromeTabs?: TabInfo; // Tabs relevant at the time of this call.
  files?: CloudFileDescriptor[]; // files passed to this step
  recordingId?: string; // Associated recording, if any.
  modelConfig?: GEMINI_MODEL; // LLM model used (e.g., for planning or if the tool itself is LLM-based).
  userDefinedFunction?: {
    name: string;
    description: string;
    parameters: Record<string, any>;
    mcpUrl?: string; // If it's an MCP function
  };
  fileInput?: LLMDataInput[];
  imageInput?: LLMDataInput[];

  // --- Status and Logging for this specific call/step ---
  timestamp: number; // When this task/step was initiated or logged.
  status?: 'pending' | 'running' | 'completed' | 'error' | 'cancelled'; // Execution status of this call/step.
  plannerThought?: string; // If planner-driven, the thought process that led to this toolName/toolArgs.
  output?: ToolOutput; // if output is structured object
  schemaHeaderSheetInfo?: SchemaHeaderSheetInfo[]; // Sheets created/modified by this tool call/step.
  // Generated content references (not inline)
  generatedContentRef?: GeneratedContentReferences;
  generatedTools?: CustomFunction[];
  generatedHtml?: string;
  generatedDocUrl?: string;
  generatedSlidesUrl?: string;
  error?: string; // Detailed error message if status is 'error' for this specific step/call.

  // --- For hierarchical tasks (e.g., EXECUTE_MULTIPLE_TOOLS, SHEETS_WORKFLOW internal steps) ---
  multiSteps?: StoredFunctionCall[]; // Child/sub-steps executed as part of this call.
  parentWorkflowId?: string; // ID of the parent StoredFunctionCall if this is a sub-step.
  tabExecutionMode?: TabExecutionMode; // How to handle tabs when re-executing as shortcut

  // --- User preferences & metadata ---
  reuseArtifacts?: ReuseArtifacts;

  // --- User preferences & metadata for saved tasks (primarily for top-level StoredFunctionCalls) ---
  reuseSheet?: boolean;
  displayName?: string;
  photoURL?: string;
  creditsUsed?: number;
}

export type PredefinedTasks = StoredFunctionCall & { label: string };

// Define the StoredFunctionCallMetadata interface
export interface StoredFunctionCallMetadata {
  callingFunction: string;
  userInput: string;
  pinned?: string;
  addedToContextMenu?: string;
}

// Chat and Thread Types
export interface ChatThread {
  id: string;
  title: string;
  createdAt: any; // Firebase Timestamp
  userId: string;
  lastMessageAt?: any;
  messageCount?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content?: string;
  timestamp: any; // Firebase Timestamp or number
  attachments?: {
    files: ChatAttachmentFile[];
    sheets: LinkInfo[]; // LinkInfo[]
  };
  functionCall?: any; // StoredFunctionCall
  executionId?: string;
  creditsUsed?: number;
  warnings?: string[];
  error?: string;
}

// Proxy and Device Types
export interface ProxySettings {
  server: string;
  port?: number;
  username?: string;
  password?: string;
  bypass?: string[];
  name?: string;
}

export interface DeviceRouting {
  deviceId: string;
  deviceName: string;
  isOnline?: boolean;
}

export interface UserDevice {
  id: string;
  deviceId: string;
  deviceName?: string;
  deviceType: 'chrome_extension' | 'mobile' | 'tablet' | 'desktop';
  lastUpdated?: any;
  lastSeen?: any;
  online: boolean;
  fcmToken?: string;
  chromeVersion?: string;
  extensionVersion?: string;
  capabilities?: {
    tools: string[];
  };
}

export interface ChatOptions {
  model: any; // GEMINI_MODEL
  proxyMode: 'none' | 'custom' | 'default' | 'device';
  savedProxies?: ProxySettings[];
  selectedProxy?: ProxySettings;
  selectedDevice?: DeviceRouting;
}

// Execution Request/Response Types
export interface ExecuteRequest {
  userInput: string;
  urls: string[];
  llmIntegration: any; // LLMIntegration
  proxy?: ProxyConfig;
  authToken: string;
  previousSteps?: any[]; // PlannerPreviousStep[]
  threadId?: string;
  previousMessages?: ChatMessage[];
  userId: string;
  executionId: string;
  userTimestamp: string;
}

export interface ExecuteAPIResponse {
  status: 'complete' | 'error' | 'processing';
  data?: string;
  artifacts?: {
    sheets?: any[]; // SchemaHeaderSheetInfo[]
  };
  metadata?: {
    executionId?: string;
    creditsUsed?: number;
  };
  error?: string;
}

export interface EnhanceRequest {
  userInput: string;
  webPageMap?: Record<number, PageData>; // Map of tab IDs to page data
  tabOrder?: number[]; // Array of tab IDs in order
  files?: LLMDataInput[]; // File attachments
  llmIntegration: LLMIntegration;
  authToken: string;
  trajectoryId: string;
  functionDeclarations?: any[]; // MCP or user-defined functions
  currentPageUrl?: string; // Fallback: current page URL
  currentPageTitle?: string; // Fallback: current page title
  userTimestamp: string;
  userProfile: UserProfile; // User's personal context from settings
  recordingContext?: string;
}

export interface EnhanceResponse {
  success: boolean;
  data?: string; // The enhanced prompt
  error?: string;
  creditsUsed?: number;
  warnings?: string[];
}

// Execution State for handling questions
export interface ExecutionStateData {
  status: 'completed' | 'failed' | 'cancelled' | 'waiting_input' | 'processing';
  pendingQuestions?: any[]; // PlannerQuestion[]
  error?: string;
  result?: any;
}

// Configuration Types
export interface ExecutionConfig {
  geminiApiKey?: string;
  enableGeminiApiKey?: boolean;
}

// Model Enums (matching the website)
export enum GeminiModel {
  FLASH_LITE = 'Gemini Flash Lite',
  FLASH = 'Gemini Flash',
  PRO = 'Gemini Pro',
}

// Interface for stored Succesful Function Calls
export interface StoredScheduledWorkflow {
  id: string;
  title: string;
  workflowCall: StoredFunctionCall[];
  periodInMinutes?: number; // undefined for non-repeating (run once)
  nextRun: number; // Timestamp for the first/next run (in milliseconds)
  enabled: boolean;
}

export interface PastWorkflowEvent {
  id: string;
  flowId: string;
  dateTime: number; // Timestamp of when it ran
  title: string;
  periodInMinutes?: number;
  results: {
    toolName: string;
    output: ToolOutput; // Will have console output pushed in if present
    error?: string;
    schemaHeaderSheetInfo?: SchemaHeaderSheetInfo[];
    generatedContentRef?: GeneratedContentReferences;
    generatedTools?: CustomFunction[];
    creditsUsed?: number;
    executionTime?: number;
  }[]; // Accumulated results
  totalCreditsUsed?: number;
  resourcesCreated?: {
    sheets: string[];
    docs: string[];
    slides: string[];
    webpages: string[];
    pdfs: string[];
  };
}
