// packages/shared/lib/types/index.ts
import type { SemanticNode } from '@rover/a11y-tree';

type Part = unknown;
type FirebaseUser = unknown;

export interface ExtensionLLMFunction extends Omit<LLMFunction, 'response'> {
  response: {
    success: boolean;
    error?: string;
    output?: any;
    logs?: any;
    allowFallback?: boolean;
    details?: string;
  };
}

export interface LLMFunction {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  response: {
    status: 'Success' | 'Failure' | 'Pending execution';
    error?: string;
    output?: any;
    logs?: any;
    allowFallback?: boolean;
  };
}

/**
 * Result of page data extraction operation
 * Contains extracted content and metadata
 */
export interface PageData {
  /** Page URL */
  url?: string;

  /** Page title */
  title?: string;

  /** Document content type */
  contentType?: string;

  /** Extracted text content */
  content?: string;

  /** Generated accessibility tree representation */
  tree?: string;

  /** roots need for accessibility tree gen */
  roots?: number[];

  /** nodes need for accessibility tree gen */
  nodes?: Record<number, SemanticNode>;

  /** Lookup for links/urls  */
  elementLinkRecord?: Record<number, string>;

  /** Extraction metadata */
  metadata?: PageDataMetadata;

  /** Structured Rover discovery information for this page, when available */
  agentDiscovery?: RoverAgentDiscoverySnapshot;

  /** Any errors encountered during extraction */
  error?: string;

  /** Starting Tab URL */
  originalTabUrl?: string;

  /** Data context string for the tab */
  dataContext?: string;

  /** Parent Tab URL */
  parentTabUrl?: string;

  sheetInfo?: SheetInfo;

  /** Flag to indicate tab creation in storedfunctioncall */
  requiresNewTab?: boolean;
}

/**
 * Metadata about the extraction process
 * Useful for debugging and optimization
 */
export interface PageDataMetadata {
  /** Time taken for extraction in milliseconds */
  extractionTime?: number;

  /** Number of DOM elements processed */
  elementsProcessed?: number;

  /** Whether scrolling was performed */
  scrollingPerformed?: boolean;

  /** Extraction method used */
  extractionMethod?: string;

  /** Accessibility-tree capture quality diagnostics */
  treeCapture?: {
    status?: 'normal' | 'suspicious_recovered' | 'suspicious_unrecovered';
    attempts?: number;
    waitedMs?: number;
    reasons?: string[];
  };
}

export type RoverDiscoveryExecutionPreference = 'auto' | 'browser' | 'cloud';

export type RoverDiscoveryResultMode = 'text' | 'markdown' | 'json' | 'observation' | 'artifacts';

export type RoverDiscoverySkillInterface = 'task' | 'shortcut' | 'client_tool' | 'webmcp';

export type RoverDiscoverySkillSource = 'shortcut' | 'client_tool' | 'webmcp' | 'additional';

export type RoverDiscoverySurfaceMode = 'silent' | 'beacon' | 'integrated' | 'debug';

export type RoverDiscoverySurfaceBranding = 'site' | 'co' | 'rover';

export type RoverDiscoveryHostSurface = 'auto' | 'existing-assistant' | 'floating-corner' | 'inline-primary';

export type RoverDiscoveryActionReveal = 'click' | 'focus' | 'keyboard' | 'agent-handshake';

export interface RoverAgentDiscoverySurfaceSnapshot {
  mode: RoverDiscoverySurfaceMode;
  branding: RoverDiscoverySurfaceBranding;
  hostSurface: RoverDiscoveryHostSurface;
  actionReveal: RoverDiscoveryActionReveal;
  beaconLabel?: string;
  agentModeEntryHints?: string[];
}

export interface RoverAgentDiscoveryCapabilitySnapshot {
  capabilityId: string;
  version?: string;
  label: string;
  description?: string;
  preferredInterface?: RoverDiscoverySkillInterface;
  source?: RoverDiscoverySkillSource;
  resultModes?: RoverDiscoveryResultMode[];
  pageScope?: string[];
  analyticsTags?: string[];
  deepLink?: string;
  toolName?: string;
  taskPayload?: Record<string, unknown>;
}

export interface RoverAgentDiscoveryPageSnapshot {
  pageId: string;
  route?: string;
  label?: string;
  capabilityIds: string[];
  entityHints?: string[];
  formHints?: string[];
  visibleCueLabel?: string;
  beaconLabel?: string;
  discoveryMode?: RoverDiscoverySurfaceMode;
  hostSurface?: RoverDiscoveryHostSurface;
  actionReveal?: RoverDiscoveryActionReveal;
  agentModeEntryHints?: string[];
  capabilitySummary?: string[];
}

export interface RoverAgentDiscoverySkillSnapshot {
  id: string;
  name: string;
  preferredInterface?: RoverDiscoverySkillInterface;
  source?: RoverDiscoverySkillSource;
  deepLink?: string;
  toolName?: string;
  taskPayload?: Record<string, unknown>;
}

export interface RoverAgentDiscoverySnapshot {
  roverEnabled: boolean;
  siteUrl: string;
  taskEndpoint: string;
  workflowEndpoint: string;
  serviceDescUrl?: string;
  llmsUrl?: string;
  roverSiteUrl?: string;
  preferredExecution: RoverDiscoveryExecutionPreference;
  promptLaunchEnabled: boolean;
  shortcutLaunchEnabled: boolean;
  delegatedHandoffs: boolean;
  webmcpAvailable: boolean;
  skills: RoverAgentDiscoverySkillSnapshot[];
  discoverySurface?: RoverAgentDiscoverySurfaceSnapshot;
  capabilities?: RoverAgentDiscoveryCapabilitySnapshot[];
  pages?: RoverAgentDiscoveryPageSnapshot[];
  page?: RoverAgentDiscoveryPageSnapshot;
  instructions: string[];
}

// Update ExtensionCommand type:
export type ExtensionCommand = ConfigureProxyCommand | ClearProxyCommand | OpenTabsCommand | CloseAllTabsCommand;

export interface NativeMessage {
  id: string;
  type: 'command' | 'response' | 'event';
  timestamp: number;
}

export interface CommandMessage extends NativeMessage {
  type: 'command';
  command: ExtensionCommand;
}

export interface ResponseMessage extends NativeMessage {
  type: 'response';
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface EventMessage extends NativeMessage {
  type: 'event';
  event: ExtensionEvent;
}

export type ConfigureProxyCommand = { action: 'configureProxy' } & ProxyConfig;

export interface ClearProxyCommand {
  action: 'clearProxy';
}

// Add to your command types:
export interface CloseAllTabsCommand {
  action: 'closeAllTabs';
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  scheme?: 'http' | 'https' | 'socks4' | 'socks5';
  bypassList?: string[];
}

export interface UserProfile {
  name?: string;
  email?: string;
  gender?: string;
  age?: number;
  birthdate?: string;
  location?: string;
  userContext?: string;
  [key: string]: string | number | { [key: string]: string } | undefined; // Index signature
}

export interface RtrvrAIOptions {
  extractionConfig?: ExtractionConfig;
  userProfile?: UserProfile;
  userUsageData?: unknown;
}

export enum GEMINI_MODEL {
  FLASH_LITE = 'Gemini Flash Lite',
  FLASH = 'Gemini Flash',
  PRO = 'Gemini Pro',
}

/**
 * Updated LLMIntegration interface with multi-key support
 */
export interface LLMIntegration {
  model: GEMINI_MODEL;
  enableGoogleAiStudioApiKey?: boolean;
  disableCreditsFallback?: boolean;
  apiKey?: string;
  apiKeys?: string[];
}

export interface ExtractionConfig {
  llmIntegration?: LLMIntegration;
  maxParallelTabs?: number;
  pageLoadDelay?: number;
  disableAutoScroll?: boolean;
  consecutiveScrollDelay?: number; // Added
  maxScrollAttempts?: number; // Added
  makeNewTabsActive?: boolean;
  writeRowProcessingTime?: boolean;
  includeCrossOriginIframes?: boolean;
  iframeMaxDepth?: number;
  iframeTotalBudgetMs?: number;
  iframePerFrameTimeoutMs?: number;
  iframeMaxConcurrency?: number;
}

export type PageConfig = ExtractionConfig & {
  pageDataTimeoutMs?: number;
  pdfTextSelectionTimeoutMs?: number;
  onlyTextContent?: boolean;
  totalBudgetMs?: number;
  deadlineEpochMs?: number;
  adaptiveSettleDebounceMs?: number;
  adaptiveSettleMaxWaitMs?: number;
  adaptiveSettleRetries?: number;
  sparseTreeRetryDelayMs?: number;
  sparseTreeRetryMaxAttempts?: number;
};

export type RoverPageCaptureConfig = Pick<
  PageConfig,
  | 'disableAutoScroll'
  | 'onlyTextContent'
  | 'totalBudgetMs'
  | 'pageDataTimeoutMs'
  | 'pdfTextSelectionTimeoutMs'
  | 'adaptiveSettleDebounceMs'
  | 'adaptiveSettleMaxWaitMs'
  | 'adaptiveSettleRetries'
  | 'sparseTreeRetryDelayMs'
  | 'sparseTreeRetryMaxAttempts'
>;

export interface TabConfig {
  url: string;
  pageConfig?: PageConfig; // Optional per-tab config
}

export interface OpenTabsCommand {
  action: 'openTabs';
  urls: string[] | TabConfig[]; // Accept either simple URLs or configs
  pageConfig?: PageConfig; // Global config for all tabs
}

export interface ExecuteFunctionsCommand {
  action: 'executeFunctions';
  requests: ExecuteFunctionRequest[];
}

// =========================================
// TAB METADATA
// =========================================
export interface TabMetadata {
  tabId: number;
  url: string;
  title: string;
  contentType: string;
  windowId?: number;
  status: 'success' | 'error';
  error?: string;
  sheetInfo?: SheetInfo;
  accTreeId?: string; // ADD: Reference to specific tree state
  // Large data stored separately: tree, content, elementLinkRecord, metadata
}

export type TabData = TabMetadata & PageData;

export type TabInfo = Record<number, TabData>;

export interface ClipboardMessage {
  type: 'CLIPBOARD_REQUEST' | 'CLIPBOARD_RESPONSE';
  requestId: string;
  data?: string;
  error?: string;
  success?: boolean;
}

export enum ExtensionEvent {
  NativeHostConnected,
  NativeHostDisconnected,
}

export interface ClipboardRequestEntry {
  tabId: number;
  timestamp: number;
  resolver: (response: ClipboardMessage) => void;
  timeoutId?: number;
}

// Task Executor
export interface Task {
  id: string;
  action: string;
  params: any;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt?: number;
  priority?: number;
  timeout?: number;
}

export interface TaskData {
  tool?: string;
  summary?: string;
  creditsUsed?: number;
  recordCount?: number;
  pagesProcessed?: number;
  stepsExecuted?: number;
  taskComplete?: boolean;
}

export interface ReplayWorkflowData extends TaskData {
  output?: ToolOutput;
  creditsUsed?: number;
  sheetUrls?: string[];
  docUrls?: string[];
  slidesUrls?: string[];
  webpageUrls?: string[];
  pdfUrls?: string[];
  warnings?: string[];
  source: 'shared_url' | 'execution_id';
  originalExecutionId?: string;
  stepsExecuted: number;
}

export interface GetBrowserTabsData extends TaskData {
  tabs: Record<number, TabData>;
  activeTab: TabData | null;
}

export interface GetPageData {
  extractionResults?: {
    tabId: number;
    success: boolean;
    url?: string;
    error?: string;
  }[];
  pageDataErrors?: Record<number, string>;
  summary: {
    totalTabs?: number;
    successfulExtractions?: number;
    failedExtractions?: number;
    treesGenerated?: number;
  };
  trees?: string[];
  message?: string;
  errors?: Record<number, string>;
  warnings?: string[];
}

export interface PageAction {
  summary: {
    totalActions: number;
    successfulActions: number;
    failedActions: number;
    tabsProcessed: number;
    treesGenerated: number;
  };
  trees?: string[];
  actionResults: {
    tabId: number;
    action: any;
    success: boolean;
    error: any;
  }[];
  message?: string;
  completedAt?: number;
  duration?: number;
}

export interface UserFunctionData extends TaskData {
  result?: ToolOutput;
  consoleOutput?: string;
  executionTime: number;
  functionName?: string;
  error?: any;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
  completedAt: number;
  duration: number;
}

export interface ExtensionState {
  isAuthenticated: boolean;
  user: FirebaseUser | null;
  isOnline: boolean;
  activeTasks: Task[];
  completedToday: number;
  totalCompleted: number;
}

export interface TabSession {
  sessionId: string;
  tabs: Map<number, number>; // logical index -> actual tab ID
  nextIndex: number;
  activeTabIndex: number;
}

// =========================================
// OTHER TYPES
// =========================================

export interface ClipboardMessage {
  type: 'CLIPBOARD_REQUEST' | 'CLIPBOARD_RESPONSE';
  requestId: string;
  data?: string;
  error?: string;
  success?: boolean;
}

export interface ClipboardRequestEntry {
  tabId: number;
  timestamp: number;
  resolver: (response: ClipboardMessage) => void;
  timeoutId?: number;
}

export interface PendingFunctionExecution {
  timestamp: number;
  timeoutId?: number;
  resolver: (response: any) => void;
  rejector: (error: Error) => void;
}

// Add function execution message types
export interface OffScreenFuncExecuteRequest {
  type: 'OFFSCREEN_FUNC_EXECUTE_REQUEST';
  requests: ExecuteFunctionRequest[];
  batchId: string;
  timeout: number;
}

export interface OffScreenFuncExecuteResponse {
  type: 'OFFSCREEN_FUNC_EXECUTE_RESPONSE';
  batchId: string;
  success: boolean;
  results: Record<string, Omit<ExecuteFunctionResponse, 'parameters'>>;
  error?: CustomError;
}

export interface PreviousSteps {
  accTreeId?: string;
  modelParts?: Part[];
  thought?: string;
  functions?: LLMFunction[];
  data?: string;
  fail?: string;
  userFeedback?: string[];
}

// --- Output storing/passing to Planner ---
export type ToolOutputRecord = Record<string, unknown>;
export type ToolOutputElement = ToolOutputRecord | (ToolOutputRecord | string)[] | string;
export type ToolOutput = ToolOutputElement[]; // An array of defined elements

export interface SheetTabInfo {
  id: number;
  title: string;
}

export type TabularKind = 'google' | 'memory';

// Interface for passing sheets info
export interface SheetInfo {
  sheetId: string;
  sheetTitle?: string;
  sheetTab: string;
  sheetTabId?: number;
  sheetTabs?: SheetTabInfo[];
  // On server side alone to pass between files
  newTabTitle?: string;
  kind?: TabularKind;
  sheetData?: any[][]; // Optional in-memory data for API/embed mode
}

export interface ExecuteFunctionRequest {
  requestId: string;
  functionType: 'user-defined' | 'mcp'; // Bhavani TO_DO: Can remove this since we determine using func mcpUrl
  function: CustomFunction;
  parameters: Record<string, any>;
  timeout?: number;
}

export interface ExecuteFunctionResponse {
  requestId: string;
  parameters: { [key: string]: any };
  success: boolean;
  result?: ToolOutput; // Successful result
  consoleOutput?: string; // Captured console output
  error?: CustomError; // Error, if any
  executionTime?: number;
  prevSteps?: PreviousSteps[];
}

export interface CustomError {
  name: string;
  message: string;
  stack?: string;
}

export interface CustomFunction {
  id: string;
  name: string;
  description: string;
  parameters: {
    [key: string]: {
      type: string;
      default?: any;
      description?: string;
      required?: string[];
    };
  }; // Parameter name to type/default value mapping
  required?: string[];
  code: string;
  llmCallable: boolean;
  displayName?: string; // Add displayName to Shared Artifact metadata
  photoURL?: string; // Add photoURL to Shared Artifact metadata
  mcpUrl?: string;
}

/** To capture timestamp and also duration elapsed */
export interface Timestamp {
  seconds: number;
  nanos: number;
}
