import {
  asString,
  cloneJson,
  createId,
  defaultHost,
  defaultPageUrl,
  inferTarget,
  pushLimited,
  truncate,
  uniqueStrings,
} from './helpers.js';
import type {
  ResolvedAgentIdentity,
  RoverBookConfig,
  RoverBookEventType,
  RoverBookEvent,
  RoverRunSummary,
  RoverVisit,
  RunLifecyclePayload,
  RunStartedPayload,
  TrajectoryStep,
  VisitOutcome,
  VisitStatus,
} from './types.js';

type ActiveRunState = RoverRunSummary & {
  steps: TrajectoryStep[];
};

type ActiveVisitState = RoverVisit & {
  runs: ActiveRunState[];
  finalized: boolean;
};

type TrackingUpdate = {
  event?: RoverBookEvent;
  visit?: RoverVisit;
  finalized?: boolean;
};

function mapOutcome(payload?: RunLifecyclePayload): VisitOutcome {
  const outcome = asString(payload?.outcome)?.toLowerCase();
  if (
    outcome === 'success'
    || outcome === 'failure'
    || outcome === 'partial'
    || outcome === 'abandoned'
    || outcome === 'input_required'
  ) {
    return outcome;
  }
  if (payload?.needsUserInput) return 'input_required';
  if (payload?.terminalState === 'failed' || payload?.ok === false) return 'failure';
  if (payload?.taskComplete || payload?.terminalState === 'completed') return 'success';
  return 'partial';
}

function statusFromOutcome(outcome: VisitOutcome): VisitStatus {
  switch (outcome) {
    case 'success':
      return 'completed';
    case 'failure':
      return 'failed';
    case 'abandoned':
      return 'abandoned';
    case 'input_required':
      return 'input_required';
    default:
      return 'active';
  }
}

function createEvent(
  visit: ActiveVisitState,
  type: RoverBookEvent['type'],
  payload: Record<string, unknown>,
  runId?: string,
): RoverBookEvent {
  const toolName = asString(payload.toolName || (payload as { call?: { name?: unknown } })?.call?.name);
  const errorMessage = asString(payload.errorMessage || payload.error);
  const pageUrl = asString(payload.pageUrl || payload.url) || defaultPageUrl();
  return {
    eventId: createId('event'),
    type,
    event: type,
    siteId: visit.siteId,
    visitId: visit.visitId,
    taskId: visit.taskId,
    runId,
    taskBoundaryId: visit.taskBoundaryId,
    ts: Date.now(),
    pageUrl,
    summary: truncate(typeof payload.summary === 'string' ? payload.summary : undefined, 240),
    stepType: inferEventStepType(type, payload),
    toolName: toolName || undefined,
    target: asString(payload.target) || undefined,
    url: pageUrl || undefined,
    durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : undefined,
    success: typeof payload.success === 'boolean' ? payload.success : undefined,
    errorMessage: errorMessage || undefined,
    errorDetail: asString(payload.errorDetail) || undefined,
    payload,
  };
}

function inferToolStepType(toolName?: string): string {
  const normalized = asString(toolName).toLowerCase();
  if (!normalized) return 'other';
  if (
    normalized.includes('goto')
    || normalized.includes('navigate')
    || normalized.includes('open')
    || normalized.includes('visit')
  ) {
    return 'navigate';
  }
  if (
    normalized.includes('click')
    || normalized.includes('tap')
    || normalized.includes('press')
    || normalized.includes('select')
  ) {
    return 'click';
  }
  if (
    normalized.includes('type')
    || normalized.includes('fill')
    || normalized.includes('input')
    || normalized.includes('enter')
  ) {
    return normalized.includes('fill') ? 'fill' : 'type';
  }
  if (normalized.includes('scroll')) return 'scroll';
  if (normalized.includes('submit')) return 'submit';
  if (
    normalized.includes('extract')
    || normalized.includes('read')
    || normalized.includes('scrape')
    || normalized.includes('capture')
  ) {
    return 'extract';
  }
  if (normalized.includes('search') || normalized.includes('find')) return 'search';
  if (normalized.includes('wait')) return 'wait_for';
  return 'other';
}

function inferEventStepType(type: RoverBookEventType, payload: Record<string, unknown>): string {
  if (type === 'error') return 'error';
  if (type === 'navigation_guardrail') return 'backtrack';
  if (
    type === 'status'
    || type === 'task_started'
    || type === 'task_ended'
    || type === 'run_started'
    || type === 'run_state_transition'
    || type === 'run_completed'
  ) {
    return 'status';
  }
  if (type === 'tool_start' || type === 'tool_result') {
    return inferToolStepType(asString(payload.toolName || (payload as { call?: { name?: unknown } })?.call?.name));
  }
  return 'other';
}

function createEmptyVisit(
  taskId: string,
  siteId: string,
  identity: ResolvedAgentIdentity,
): ActiveVisitState {
  const pageUrl = defaultPageUrl();
  return {
    visitId: taskId,
    taskId,
    siteId,
    host: defaultHost(),
    entryUrl: pageUrl,
    latestUrl: pageUrl,
    agentKey: identity.key,
    agentName: identity.name,
    agentModel: identity.model,
    startedAt: Date.now(),
    status: 'active',
    outcome: 'partial',
    pagesVisited: pageUrl ? [pageUrl] : [],
    runSummaries: [],
    trajectoryPreview: [],
    metrics: {
      totalRuns: 0,
      totalSteps: 0,
      totalDurationMs: 0,
      errorCount: 0,
      backtrackCount: 0,
      toolsUsed: [],
      toolUsage: {},
    },
    runs: [],
    finalized: false,
  };
}

export class VisitTracker {
  private readonly visits = new Map<string, ActiveVisitState>();
  private readonly runToVisit = new Map<string, string>();
  private readonly pendingSteps = new Map<string, TrajectoryStep[]>();
  private activeVisitId?: string;
  private identity: ResolvedAgentIdentity;

  constructor(
    private readonly config: RoverBookConfig,
    identity: ResolvedAgentIdentity,
  ) {
    this.identity = identity;
  }

  setIdentity(identity: ResolvedAgentIdentity): void {
    this.identity = identity;
    for (const visit of this.visits.values()) {
      visit.agentKey = identity.key;
      visit.agentName = identity.name;
      visit.agentModel = identity.model;
    }
  }

  getActiveVisit(): RoverVisit | undefined {
    if (!this.activeVisitId) return undefined;
    return this.snapshotVisit(this.visits.get(this.activeVisitId));
  }

  getVisit(visitId: string): RoverVisit | undefined {
    return this.snapshotVisit(this.visits.get(visitId));
  }

  listVisits(): RoverVisit[] {
    return Array.from(this.visits.values()).map(visit => this.snapshotVisit(visit)!);
  }

  handleTaskStarted(payload: { taskId?: string; reason?: string }): TrackingUpdate | null {
    const taskId = asString(payload.taskId) || createId('visit');
    const visit = this.ensureVisit(taskId);
    visit.startedAt = Date.now();
    this.activeVisitId = visit.visitId;
    return {
      event: createEvent(visit, 'task_started', {
        taskId,
        reason: payload.reason,
      }),
      visit: this.snapshotVisit(visit),
    };
  }

  handleRunStarted(payload: RunStartedPayload): TrackingUpdate | null {
    const taskId = asString(payload.taskId) || this.activeVisitId || createId('visit');
    const visit = this.resolveVisitForRun(taskId);
    const runId = asString(payload.runId) || createId('run');
    const taskBoundaryId = asString(payload.taskBoundaryId);
    const run: ActiveRunState = {
      runId,
      taskBoundaryId,
      prompt: asString(payload.text),
      startedAt: Number(payload.startedAt || Date.now()) || Date.now(),
      outcome: 'partial',
      taskComplete: false,
      needsUserInput: false,
      stepCount: 0,
      errorCount: 0,
      totalDurationMs: 0,
      toolsUsed: [],
      steps: [],
    };
    visit.taskBoundaryId = taskBoundaryId || visit.taskBoundaryId;
    visit.taskId = taskId || visit.taskId;
    visit.latestUrl = asString(payload.pageUrl) || defaultPageUrl();
    this.addVisitedPage(visit, visit.latestUrl);
    visit.runs.push(run);
    visit.metrics.totalRuns = visit.runs.length;
    visit.runSummaries = visit.runs.map(current => this.toRunSummary(current));
    this.runToVisit.set(runId, visit.visitId);
    this.activeVisitId = visit.visitId;
    return {
      event: createEvent(visit, 'run_started', {
        runId,
        taskId: visit.taskId,
        taskBoundaryId,
        text: run.prompt,
        pageUrl: visit.latestUrl,
      }, runId),
      visit: this.snapshotVisit(visit),
    };
  }

  handleToolStart(payload: any): TrackingUpdate | null {
    const run = this.findRun(asString(payload?.runId));
    if (!run) return null;
    const visit = run.visit;
    const step: TrajectoryStep = {
      stepId: createId('step'),
      ts: Date.now(),
      action: asString(payload?.call?.name) || 'tool',
      target: inferTarget(payload?.call?.args),
      args: payload?.call?.args && typeof payload.call.args === 'object' ? cloneJson(payload.call.args) : undefined,
      result: 'pending',
      durationMs: 0,
      runId: run.run.runId,
      pageUrl: defaultPageUrl(),
    };
    run.run.steps.push(step);
    pushLimited(visit.trajectoryPreview, cloneJson(step), 60);
    const queue = this.pendingSteps.get(run.run.runId) || [];
    queue.push(step);
    this.pendingSteps.set(run.run.runId, queue);
    return {
      event: createEvent(visit, 'tool_start', {
        runId: run.run.runId,
        toolName: step.action,
        target: step.target,
        args: step.args,
      }, run.run.runId),
      visit: this.snapshotVisit(visit),
    };
  }

  handleToolResult(payload: any): TrackingUpdate | null {
    const run = this.findRun(asString(payload?.runId));
    if (!run) return null;
    const visit = run.visit;
    const queue = this.pendingSteps.get(run.run.runId) || [];
    const toolName = asString(payload?.call?.name);
    let step = [...queue].reverse().find(candidate => candidate.result === 'pending' && (!toolName || candidate.action === toolName));
    if (!step) {
      step = {
        stepId: createId('step'),
        ts: Date.now(),
        action: toolName || 'tool',
        target: inferTarget(payload?.call?.args),
        result: 'pending',
        durationMs: 0,
        runId: run.run.runId,
        pageUrl: defaultPageUrl(),
      };
      run.run.steps.push(step);
      queue.push(step);
      this.pendingSteps.set(run.run.runId, queue);
    }

    const success = payload?.result?.success !== false;
    step.result = success ? 'success' : 'error';
    step.error = !success ? asString(payload?.result?.error) : undefined;
    step.durationMs = Math.max(0, Date.now() - step.ts);
    step.args = step.args || (payload?.call?.args && typeof payload.call.args === 'object' ? cloneJson(payload.call.args) : undefined);
    step.target = step.target || inferTarget(payload?.call?.args);
    run.run.stepCount = run.run.steps.length;
    run.run.totalDurationMs = run.run.steps.reduce((sum, current) => sum + current.durationMs, 0);
    run.run.toolsUsed = uniqueStrings([...run.run.toolsUsed, step.action]);
    if (!success) {
      run.run.errorCount += 1;
      visit.metrics.errorCount += 1;
    }
    visit.metrics.totalSteps = visit.runs.reduce((sum, current) => sum + current.steps.length, 0);
    visit.metrics.totalDurationMs = visit.runs.reduce((sum, current) => sum + current.totalDurationMs, 0);
    visit.metrics.toolsUsed = uniqueStrings([...visit.metrics.toolsUsed, step.action]);
    visit.metrics.toolUsage[step.action] = (visit.metrics.toolUsage[step.action] || 0) + 1;
    visit.runSummaries = visit.runs.map(current => this.toRunSummary(current));
    pushLimited(visit.trajectoryPreview, cloneJson(step), 60);
    return {
      event: createEvent(visit, 'tool_result', {
        runId: run.run.runId,
        toolName: step.action,
        success,
        errorMessage: step.error,
        durationMs: step.durationMs,
        target: step.target,
      }, run.run.runId),
      visit: this.snapshotVisit(visit),
    };
  }

  handleStatus(payload: any): TrackingUpdate | null {
    const visit = this.resolveVisitFromPayload(payload);
    if (!visit) return null;
    return {
      event: createEvent(visit, 'status', {
        status: asString(payload?.status) || asString(payload?.message) || 'status',
        summary: asString(payload?.summary) || asString(payload?.message),
      }),
      visit: this.snapshotVisit(visit),
    };
  }

  handleError(payload: any): TrackingUpdate | null {
    const visit = this.resolveVisitFromPayload(payload);
    if (!visit) return null;
    visit.metrics.errorCount += 1;
    return {
      event: createEvent(visit, 'error', {
        error: asString(payload?.message) || asString(payload?.error) || 'Unknown error',
      }),
      visit: this.snapshotVisit(visit),
    };
  }

  handleNavigationGuardrail(payload: any): TrackingUpdate | null {
    const visit = this.resolveVisitFromPayload(payload);
    if (!visit) return null;
    visit.metrics.backtrackCount += 1;
    return {
      event: createEvent(visit, 'navigation_guardrail', {
        reason: asString(payload?.reason) || asString(payload?.message) || 'navigation_guardrail',
        pageUrl: defaultPageUrl(),
      }),
      visit: this.snapshotVisit(visit),
    };
  }

  handleRunLifecycle(type: 'run_state_transition' | 'run_completed', payload: RunLifecyclePayload): TrackingUpdate | null {
    const run = this.findRun(asString(payload.runId), asString(payload.taskId));
    if (!run) return null;
    const visit = run.visit;
    run.run.taskBoundaryId = asString(payload.taskBoundaryId) || run.run.taskBoundaryId;
    visit.taskBoundaryId = run.run.taskBoundaryId || visit.taskBoundaryId;
    run.run.terminalState = payload.terminalState;
    run.run.continuationReason = asString(payload.continuationReason);
    run.run.taskComplete = payload.taskComplete === true;
    run.run.needsUserInput = payload.needsUserInput === true;
    run.run.summary = asString(payload.summary) || run.run.summary;
    run.run.error = asString(payload.error) || run.run.error;
    run.run.endedAt = Number(payload.endedAt || Date.now()) || Date.now();
    run.run.totalDurationMs = Math.max(run.run.totalDurationMs, run.run.endedAt - run.run.startedAt);
    run.run.outcome = mapOutcome(payload);
    visit.latestUrl = asString(payload.pageUrl) || defaultPageUrl();
    this.addVisitedPage(visit, visit.latestUrl);
    visit.latestSummary = run.run.summary || visit.latestSummary;
    visit.latestError = run.run.error || visit.latestError;
    visit.metrics.totalDurationMs = visit.runs.reduce((sum, current) => sum + current.totalDurationMs, 0);
    visit.runSummaries = visit.runs.map(current => this.toRunSummary(current));

    const event = createEvent(visit, type, {
      runId: run.run.runId,
      taskBoundaryId: run.run.taskBoundaryId,
      terminalState: run.run.terminalState,
      continuationReason: run.run.continuationReason,
      taskComplete: run.run.taskComplete,
      needsUserInput: run.run.needsUserInput,
      summary: run.run.summary,
      error: run.run.error,
      outcome: run.run.outcome,
      pageUrl: visit.latestUrl,
    }, run.run.runId);

    const shouldFinalize =
      run.run.outcome === 'success'
      || run.run.outcome === 'failure'
      || (type === 'run_completed' && payload.needsUserInput !== true && payload.taskComplete !== false && payload.terminalState === 'completed');
    if (shouldFinalize) {
      this.finalizeVisit(visit, run.run.outcome, run.run.endedAt);
    } else if (run.run.outcome === 'input_required') {
      visit.status = 'input_required';
      visit.outcome = 'input_required';
    }

    return {
      event,
      visit: this.snapshotVisit(visit),
      finalized: shouldFinalize,
    };
  }

  handleTaskEnded(payload: { taskId?: string; reason?: string; endedAt?: number }): TrackingUpdate | null {
    const taskId = asString(payload.taskId) || this.activeVisitId;
    if (!taskId) return null;
    const visit = this.visits.get(taskId);
    if (!visit) return null;
    if (!visit.finalized) {
      this.finalizeVisit(visit, 'abandoned', Number(payload.endedAt || Date.now()) || Date.now());
    }
    return {
      event: createEvent(visit, 'task_ended', {
        taskId: visit.taskId,
        reason: payload.reason,
        endedAt: payload.endedAt,
        outcome: visit.outcome,
      }),
      visit: this.snapshotVisit(visit),
      finalized: true,
    };
  }

  private ensureVisit(taskId: string): ActiveVisitState {
    const existing = this.visits.get(taskId);
    if (existing) {
      existing.agentKey = this.identity.key;
      existing.agentName = this.identity.name;
      existing.agentModel = this.identity.model;
      return existing;
    }
    const visit = createEmptyVisit(taskId, this.config.siteId, this.identity);
    this.visits.set(taskId, visit);
    return visit;
  }

  private resolveVisitForRun(taskId: string): ActiveVisitState {
    const explicitTaskId = asString(taskId);
    if (explicitTaskId && this.visits.has(explicitTaskId)) {
      return this.visits.get(explicitTaskId)!;
    }
    if (this.activeVisitId) {
      const active = this.visits.get(this.activeVisitId);
      if (active && !active.finalized && active.runs.length === 0) {
        active.taskId = explicitTaskId || active.taskId;
        return active;
      }
    }
    return this.ensureVisit(explicitTaskId || createId('visit'));
  }

  private addVisitedPage(visit: ActiveVisitState, pageUrl?: string): void {
    const page = asString(pageUrl);
    if (!page) return;
    const last = visit.pagesVisited[visit.pagesVisited.length - 1];
    if (last === page) return;
    if (visit.pagesVisited.includes(page)) {
      visit.metrics.backtrackCount += 1;
    }
    visit.pagesVisited.push(page);
  }

  private finalizeVisit(visit: ActiveVisitState, outcome: VisitOutcome, endedAt: number): void {
    visit.finalized = true;
    visit.outcome = outcome;
    visit.status = statusFromOutcome(outcome);
    visit.endedAt = endedAt;
    visit.metrics.totalRuns = visit.runs.length;
    visit.metrics.totalSteps = visit.runs.reduce((sum, run) => sum + run.steps.length, 0);
    visit.metrics.totalDurationMs = Math.max(visit.metrics.totalDurationMs, endedAt - visit.startedAt);
    visit.metrics.toolsUsed = uniqueStrings(visit.runs.flatMap(run => run.toolsUsed));
    visit.metrics.errorCount = visit.runs.reduce((sum, run) => sum + run.errorCount, 0);
    visit.runSummaries = visit.runs.map(run => this.toRunSummary(run));
  }

  private findRun(runId?: string, taskId?: string): { visit: ActiveVisitState; run: ActiveRunState } | null {
    const resolvedRunId = asString(runId);
    if (resolvedRunId) {
      const visitId = this.runToVisit.get(resolvedRunId);
      if (visitId) {
        const visit = this.visits.get(visitId);
        const run = visit?.runs.find(candidate => candidate.runId === resolvedRunId);
        if (visit && run) return { visit, run };
      }
    }
    const visit = taskId ? this.visits.get(taskId) : this.activeVisitId ? this.visits.get(this.activeVisitId) : undefined;
    if (!visit || visit.runs.length === 0) return null;
    return { visit, run: visit.runs[visit.runs.length - 1] };
  }

  private resolveVisitFromPayload(payload: any): ActiveVisitState | null {
    const taskId = asString(payload?.taskId);
    if (taskId && this.visits.has(taskId)) {
      return this.visits.get(taskId)!;
    }
    const runId = asString(payload?.runId);
    if (runId) {
      const visitId = this.runToVisit.get(runId);
      if (visitId && this.visits.has(visitId)) {
        return this.visits.get(visitId)!;
      }
    }
    if (this.activeVisitId && this.visits.has(this.activeVisitId)) {
      return this.visits.get(this.activeVisitId)!;
    }
    return null;
  }

  private snapshotVisit(visit?: ActiveVisitState): RoverVisit | undefined {
    if (!visit) return undefined;
    return cloneJson({
      visitId: visit.visitId,
      taskId: visit.taskId,
      siteId: visit.siteId,
      host: visit.host,
      entryUrl: visit.entryUrl,
      latestUrl: visit.latestUrl,
      taskBoundaryId: visit.taskBoundaryId,
      agentKey: visit.agentKey,
      agentName: visit.agentName,
      agentModel: visit.agentModel,
      startedAt: visit.startedAt,
      endedAt: visit.endedAt,
      status: visit.status,
      outcome: visit.outcome,
      latestSummary: visit.latestSummary,
      latestError: visit.latestError,
      pagesVisited: visit.pagesVisited,
      runSummaries: visit.runSummaries,
      trajectoryPreview: visit.trajectoryPreview,
      metrics: visit.metrics,
    });
  }

  private toRunSummary(run: ActiveRunState): RoverRunSummary {
    return {
      runId: run.runId,
      taskBoundaryId: run.taskBoundaryId,
      prompt: run.prompt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      terminalState: run.terminalState,
      continuationReason: run.continuationReason,
      outcome: run.outcome,
      taskComplete: run.taskComplete,
      needsUserInput: run.needsUserInput,
      summary: run.summary,
      error: run.error,
      stepCount: run.steps.length,
      errorCount: run.errorCount,
      totalDurationMs: run.totalDurationMs,
      toolsUsed: run.toolsUsed,
    };
  }
}
