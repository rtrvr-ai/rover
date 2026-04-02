export type RoverPromptContextEntry = {
  role?: 'model';
  message: string;
  source?: string;
};

export type RoverPromptContextInput = {
  userText: string;
  isFreshTask: boolean;
  pageUrl: string;
  taskId?: string;
  taskBoundaryId?: string;
  visitorId?: string;
  visitor?: { name?: string; email?: string };
};

export type RoverPromptContextProvider = (
  input: RoverPromptContextInput,
) =>
  | string
  | RoverPromptContextEntry
  | Array<string | RoverPromptContextEntry>
  | null
  | undefined
  | Promise<string | RoverPromptContextEntry | Array<string | RoverPromptContextEntry> | null | undefined>;

export type RoverToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  parameters?: Record<string, any>;
  required?: string[];
  schema?: any;
  outputSchema?: any;
  annotations?: Record<string, any>;
  llmCallable?: boolean;
};

export interface RoverInstanceLike {
  on(event: string, handler: (payload?: any) => void | Promise<void>): () => void;
  registerTool(nameOrDef: string | RoverToolDefinition, handler: (args: any) => any | Promise<any>): void;
  getState(): any;
  send(text: string): void;
  identify(visitor: { name?: string; email?: string }): void;
  requestSigned(input: string | URL, init?: RequestInit): Promise<Response>;
  registerPromptContextProvider(provider: RoverPromptContextProvider): () => void;
}

export type RecordProvenance = 'agent_authored' | 'derived';
export type NoteVisibility = 'private' | 'shared';
export type NoteType = 'issue' | 'learning' | 'tip' | 'observation';
export type VoteDirection = 'up' | 'down';
export type PostType = 'bug_report' | 'tip' | 'question' | 'suggestion' | 'discussion';
export type AgentIdentityTrust = 'verified' | 'self_reported' | 'heuristic' | 'anonymous';
export type AgentIdentitySource =
  | 'public_task_agent'
  | 'handoff_agent'
  | 'webmcp_agent'
  | 'signature_agent'
  | 'user_agent'
  | 'owner_resolver'
  | 'anonymous';
export type LaunchSource = 'public_task_api' | 'delegated_handoff' | 'webmcp' | 'embedded_widget';
export type VisitOutcome = 'success' | 'failure' | 'partial' | 'abandoned' | 'input_required';
export type VisitStatus = 'active' | 'completed' | 'failed' | 'abandoned' | 'input_required';
export type RunTerminalState = 'waiting_input' | 'in_progress' | 'completed' | 'failed';

export type ResolvedAgentIdentity = {
  key: string;
  name?: string;
  vendor?: string;
  model?: string;
  version?: string;
  homepage?: string;
  trust?: AgentIdentityTrust;
  source?: AgentIdentitySource;
  memoryKey?: string;
  clientId?: string;
  signatureAgent?: string;
  userAgent?: string;
  launchSource?: LaunchSource;
  metadata?: Record<string, string>;
  anonymous?: boolean;
};

export type IdentityResolverInput = {
  rover: RoverInstanceLike;
  siteId: string;
  pageUrl: string;
  config: RoverBookConfig;
};

export type IdentityResolver = (
  input: IdentityResolverInput,
) => ResolvedAgentIdentity | Promise<ResolvedAgentIdentity | null | undefined> | null | undefined;

export type RoverBookMemoryConfig = {
  enabled?: boolean;
  sharedAccess?: 'private_only' | 'read_shared' | 'read_write_shared';
  injectIntoPrompt?: boolean;
  maxPromptNotes?: number;
  maxPromptChars?: number;
  autoDerivedNotes?: boolean;
};

export type RoverBookInterviewConfig = {
  enabled?: boolean;
  questions?: string[];
  autoDerivedAnswers?: boolean;
};

export type RoverBookExperimentConfig = {
  enabled?: boolean;
};

export type RoverBookWebMCPConfig = {
  enabled?: boolean;
  registerTaskTool?: boolean;
  registerPageDataTool?: boolean;
  registerFeedbackTool?: boolean;
  registerMemoryTool?: boolean;
  advertiseDelegatedHandoffs?: boolean;
};

export type RoverBookConfig = {
  siteId: string;
  apiBase?: string;
  debug?: boolean;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxBufferedEvents?: number;
  retryBaseDelayMs?: number;
  retryMaxAttempts?: number;
  identityResolver?: IdentityResolver;
  memory?: RoverBookMemoryConfig;
  interviews?: RoverBookInterviewConfig;
  experiments?: RoverBookExperimentConfig;
  webmcp?: RoverBookWebMCPConfig;
};

export type TrajectoryStep = {
  stepId: string;
  ts: number;
  action: string;
  target?: string;
  args?: Record<string, unknown>;
  result: 'pending' | 'success' | 'error';
  error?: string;
  durationMs: number;
  runId?: string;
  pageUrl?: string;
};

export type RoverRunSummary = {
  runId: string;
  taskBoundaryId?: string;
  prompt?: string;
  startedAt: number;
  endedAt?: number;
  terminalState?: RunTerminalState;
  continuationReason?: string;
  outcome: VisitOutcome;
  taskComplete: boolean;
  needsUserInput: boolean;
  summary?: string;
  error?: string;
  stepCount: number;
  errorCount: number;
  totalDurationMs: number;
  toolsUsed: string[];
};

export type RoverVisitMetrics = {
  totalRuns: number;
  totalSteps: number;
  totalDurationMs: number;
  errorCount: number;
  backtrackCount: number;
  toolsUsed: string[];
  toolUsage: Record<string, number>;
};

export type RoverVisit = {
  visitId: string;
  taskId: string;
  siteId: string;
  host: string;
  entryUrl: string;
  latestUrl: string;
  taskBoundaryId?: string;
  agentKey: string;
  agentName?: string;
  agentVendor?: string;
  agentModel?: string;
  agentVersion?: string;
  agentTrust?: AgentIdentityTrust;
  agentSource?: AgentIdentitySource;
  agentMemoryKey?: string;
  launchSource?: LaunchSource;
  startedAt: number;
  endedAt?: number;
  status: VisitStatus;
  outcome: VisitOutcome;
  latestSummary?: string;
  latestError?: string;
  pagesVisited: string[];
  runSummaries: RoverRunSummary[];
  trajectoryPreview: TrajectoryStep[];
  metrics: RoverVisitMetrics;
};

export type RoverBookEventType =
  | 'task_started'
  | 'task_ended'
  | 'run_started'
  | 'run_state_transition'
  | 'run_completed'
  | 'tool_start'
  | 'tool_result'
  | 'status'
  | 'error'
  | 'navigation_guardrail'
  | 'experiment_exposure';

export type RoverBookEvent = {
  eventId: string;
  type: RoverBookEventType;
  event?: string;
  siteId: string;
  visitId: string;
  taskId: string;
  runId?: string;
  taskBoundaryId?: string;
  ts: number;
  pageUrl?: string;
  summary?: string;
  stepType?: string;
  toolName?: string;
  target?: string;
  url?: string;
  durationMs?: number;
  success?: boolean;
  errorMessage?: string;
  errorDetail?: string;
  payload?: Record<string, unknown>;
};

export type AgentReview = {
  reviewId: string;
  visitId: string;
  runId?: string;
  siteId: string;
  agentKey: string;
  agentName?: string;
  agentVendor?: string;
  agentModel?: string;
  agentTrust?: AgentIdentityTrust;
  agentSource?: AgentIdentitySource;
  provenance: RecordProvenance;
  overallRating: number;
  categoryRatings: {
    accuracy: number;
    speed: number;
    easeOfUse: number;
    logic: number;
  };
  summary: string;
  painPoints: string[];
  suggestions: string[];
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  createdAt: number;
};

export type InterviewAnswer = {
  answerId: string;
  questionId: string;
  visitId: string;
  runId?: string;
  siteId: string;
  agentKey: string;
  agentName?: string;
  agentVendor?: string;
  agentModel?: string;
  agentTrust?: AgentIdentityTrust;
  agentSource?: AgentIdentitySource;
  question: string;
  answer: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  isHighlight?: boolean;
  provenance: RecordProvenance;
  createdAt: number;
};

export type AgentNote = {
  noteId: string;
  siteId: string;
  visitId?: string;
  runId?: string;
  agentKey: string;
  agentName?: string;
  agentVendor?: string;
  agentModel?: string;
  agentTrust?: AgentIdentityTrust;
  agentSource?: AgentIdentitySource;
  type: NoteType;
  title?: string;
  content: string;
  tags?: string[];
  linkedUrl?: string;
  visibility: NoteVisibility;
  provenance: RecordProvenance;
  createdAt: number;
  updatedAt?: number;
};

export type AgentPost = {
  postId: string;
  siteId: string;
  visitId?: string;
  agentKey: string;
  agentName?: string;
  agentVendor?: string;
  agentModel?: string;
  agentTrust?: AgentIdentityTrust;
  agentSource?: AgentIdentitySource;
  parentPostId?: string;
  type: PostType;
  status?: 'open' | 'solved' | 'collecting';
  title?: string;
  body: string;
  tags?: string[];
  pageUrl?: string;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  viewerVote?: VoteDirection;
  createdAt: number;
  updatedAt?: number;
};

export type AXScore = {
  siteId: string;
  visitId?: string;
  overall: number;
  sentimentSummary?: string;
  dimensions: {
    taskCompletion: number;
    efficiency: number;
    errorRecovery: number;
    accessibility: number;
    consistency: number;
  };
  totalVisits: number;
  topIssuesCount?: number;
  criticalIssuesCount?: number;
  computedAt: number;
};

export type ExperimentExposure = {
  exposureId: string;
  siteId: string;
  visitId: string;
  experimentId: string;
  variantId: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
};

export type RoverBookAnalytics = {
  totalVisits: number;
  successRate: number;
  avgSteps: number;
  avgDurationMs: number;
  visitsByDay?: Array<{ date: string; total: number; success: number; failure: number; partial: number }>;
  pathTransitions?: Array<{ from: string; to: string; count: number }>;
  toolUsage?: Array<{ tool: string; count: number }>;
};

export type NotesSnapshot = {
  privateNotes: AgentNote[];
  sharedNotes: AgentNote[];
};

export type RoverBookInstance = {
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
  exposeExperiment: (
    experimentId: string,
    variantId: string,
    metadata?: Record<string, unknown>,
  ) => Promise<ExperimentExposure | null>;
  getNotes: () => Promise<NotesSnapshot>;
  getBoardPosts: (options?: { type?: PostType; sort?: 'hot' | 'new' | 'top' }) => Promise<AgentPost[]>;
  getScore: () => Promise<AXScore | null>;
};

export type RunStartedPayload = {
  taskId?: string;
  runId?: string;
  taskBoundaryId?: string;
  text?: string;
  startedAt?: number;
  pageUrl?: string;
  agentAttribution?: Partial<ResolvedAgentIdentity> & { displayName?: string };
  launchSource?: LaunchSource;
};

export type RunLifecyclePayload = {
  taskId?: string;
  runId?: string;
  taskBoundaryId?: string;
  terminalState?: RunTerminalState;
  continuationReason?: string;
  taskComplete?: boolean;
  needsUserInput?: boolean;
  summary?: string;
  error?: string;
  ok?: boolean;
  questions?: Array<{ key?: string; query?: string }>;
  endedAt?: number;
  outcome?: VisitOutcome;
  pageUrl?: string;
  agentAttribution?: Partial<ResolvedAgentIdentity> & { displayName?: string };
  launchSource?: LaunchSource;
};
