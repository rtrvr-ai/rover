export type PromptContextEntryLike = {
  role?: 'model';
  message: string;
  source?: string;
};

export type NormalizedPromptContextEntry = {
  role: 'model';
  message: string;
};

export type RunCompletionStateLike = {
  runComplete?: boolean;
  needsUserInput: boolean;
  terminalState: 'waiting_input' | 'in_progress' | 'completed' | 'failed';
  continuationReason?: 'loop_continue' | 'same_tab_navigation_handoff' | 'awaiting_user';
  questions?: Array<{ key?: string; query?: string }>;
};

type CommonPayloadParams = {
  msg: any;
  runId?: string;
  currentRunBoundaryId?: string;
  normalizeRunBoundaryId?: (value: unknown) => string | undefined;
  pageUrl?: string;
  now?: number;
};

export function normalizePromptContextEntry(
  input: string | PromptContextEntryLike,
): NormalizedPromptContextEntry | null {
  if (typeof input === 'string') {
    const message = String(input || '').trim().slice(0, 4_000);
    return message ? { role: 'model', message } : null;
  }
  if (!input || typeof input !== 'object') return null;
  const message = String(input.message || '').trim().slice(0, 4_000);
  if (!message) return null;
  return { role: 'model', message };
}

export function buildPublicRunStartedPayload(params: CommonPayloadParams): Record<string, unknown> {
  const normalizeRunBoundaryId = params.normalizeRunBoundaryId || (value => String(value || '').trim() || undefined);
  const executionId =
    typeof params.msg?.executionId === 'string' && params.msg.executionId.trim()
      ? params.msg.executionId.trim()
      : (typeof params.msg?.runId === 'string' ? params.msg.runId : undefined);
  return {
    runId: String(params.runId || '').trim() || undefined,
    executionId,
    runBoundaryId:
      typeof params.msg?.runBoundaryId === 'string'
        ? normalizeRunBoundaryId(params.msg.runBoundaryId)
        : normalizeRunBoundaryId(params.currentRunBoundaryId),
    text: typeof params.msg?.text === 'string' ? params.msg.text : undefined,
    startedAt: params.now || Date.now(),
    pageUrl: params.pageUrl,
  };
}

export function buildPublicRunLifecyclePayload(
  params: CommonPayloadParams & {
    completionState: RunCompletionStateLike;
    latestSummary?: string;
  },
): Record<string, unknown> {
  const normalizeRunBoundaryId = params.normalizeRunBoundaryId || (value => String(value || '').trim() || undefined);
  const executionId =
    typeof params.msg?.executionId === 'string' && params.msg.executionId.trim()
      ? params.msg.executionId.trim()
      : typeof params.msg?.runId === 'string' && params.msg.runId.trim()
        ? params.msg.runId.trim()
      : undefined;
  const terminalState =
    params.completionState.terminalState === 'waiting_input'
      ? 'waiting_input'
      : params.completionState.terminalState;
  const summary = String(
    params.msg?.summary
    || params.msg?.message
    || params.msg?.result?.summary
    || params.latestSummary
    || '',
  ).trim() || undefined;
  const error = String(
    params.msg?.error
    || params.msg?.result?.error
    || '',
  ).trim() || undefined;
  const outcome =
    terminalState === 'completed'
      ? 'success'
      : terminalState === 'failed'
        ? 'failure'
        : params.completionState.needsUserInput || terminalState === 'in_progress'
          ? 'partial'
          : 'abandoned';
  return {
    runId: String(params.runId || '').trim() || undefined,
    executionId,
    runBoundaryId:
      typeof params.msg?.runBoundaryId === 'string'
        ? normalizeRunBoundaryId(params.msg.runBoundaryId)
        : normalizeRunBoundaryId(params.currentRunBoundaryId),
    terminalState,
    continuationReason: params.completionState.continuationReason,
    runComplete: params.completionState.runComplete === true,
    needsUserInput: params.completionState.needsUserInput,
    summary,
    error,
    ok: params.msg?.ok !== false,
    questions: params.completionState.questions,
    endedAt: params.now || Date.now(),
    outcome,
    pageUrl: params.pageUrl,
  };
}
