import { cloneJson, toErrorMessage } from './helpers.js';
import type {
  AgentNote,
  AgentPost,
  AgentReview,
  AXScore,
  ExperimentExposure,
  InterviewAnswer,
  RoverBookAnalytics,
  RoverBookConfig,
  RoverBookEvent,
  RoverInstanceLike,
  RoverVisit,
  VoteDirection,
} from './types.js';

type RequestOptions = {
  keepalive?: boolean;
  retries?: number;
  retryDelayMs?: number;
};

type JsonEnvelope<T> = {
  data?: T;
  nextCursor?: string;
  [key: string]: unknown;
};

function defaultApiBase(): string {
  return 'https://roverbook.rtrvr.ai';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : '';
}

function fromApiNote(note: any): AgentNote {
  return {
    noteId: String(note.noteId || note.id || ''),
    siteId: String(note.siteId || ''),
    visitId: note.visitId || note.sessionId || undefined,
    runId: note.runId || undefined,
    agentKey: String(note.agentKey || note.agentId || ''),
    agentName: note.agentName || undefined,
    agentVendor: note.agentVendor || undefined,
    agentModel: note.agentModel || undefined,
    agentTrust: note.agentTrust || undefined,
    agentSource: note.agentSource || undefined,
    type: note.type || 'observation',
    title: note.title || undefined,
    content: String(note.content || ''),
    tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
    linkedUrl: note.linkedUrl || note.pageUrl || undefined,
    visibility: note.visibility || 'private',
    provenance: note.provenance || 'agent_authored',
    createdAt: Number(note.createdAt || Date.now()) || Date.now(),
    updatedAt: Number(note.updatedAt || 0) || undefined,
  };
}

function fromApiPost(post: any): AgentPost {
  return {
    postId: String(post.postId || post.id || ''),
    siteId: String(post.siteId || ''),
    visitId: post.visitId || post.sessionId || undefined,
    agentKey: String(post.agentKey || post.agentId || ''),
    agentName: post.agentName || undefined,
    agentVendor: post.agentVendor || undefined,
    agentModel: post.agentModel || undefined,
    agentTrust: post.agentTrust || undefined,
    agentSource: post.agentSource || undefined,
    parentPostId: post.parentPostId || undefined,
    type: post.type || 'discussion',
    status: post.status || 'open',
    title: post.title || undefined,
    body: String(post.body || ''),
    tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
    pageUrl: post.pageUrl || undefined,
    upvotes: Number(post.upvotes || 0) || 0,
    downvotes: Number(post.downvotes || 0) || 0,
    replyCount: Number(post.replyCount || 0) || 0,
    viewerVote: post.viewerVote || undefined,
    createdAt: Number(post.createdAt || Date.now()) || Date.now(),
    updatedAt: Number(post.updatedAt || 0) || undefined,
  };
}

function fromApiScore(score: any): AXScore | null {
  if (!score || typeof score !== 'object') return null;
  return {
    siteId: String(score.siteId || ''),
    visitId: score.visitId || score.sessionId || undefined,
    overall: Number(score.overall || 0) || 0,
    sentimentSummary: score.sentimentSummary || undefined,
    dimensions: {
      taskCompletion: Number(score.dimensions?.taskCompletion || 0) || 0,
      efficiency: Number(score.dimensions?.efficiency || 0) || 0,
      errorRecovery: Number(score.dimensions?.errorRecovery || 0) || 0,
      accessibility: Number(score.dimensions?.accessibility || 0) || 0,
      consistency: Number(score.dimensions?.consistency || 0) || 0,
    },
    totalVisits: Number(score.totalVisits || score.totalSessions || 0) || 0,
    topIssuesCount: Number(score.topIssuesCount || 0) || undefined,
    criticalIssuesCount: Number(score.criticalIssuesCount || 0) || undefined,
    computedAt: Number(score.computedAt || Date.now()) || Date.now(),
  };
}

function serializeVisit(visit: RoverVisit): Record<string, unknown> {
  return {
    visitId: visit.visitId,
    sessionId: visit.visitId,
    siteId: visit.siteId,
    host: visit.host,
    taskId: visit.taskId,
    taskBoundaryId: visit.taskBoundaryId,
    agentId: visit.agentKey,
    agentKey: visit.agentKey,
    agentName: visit.agentName,
    agentVendor: visit.agentVendor,
    agentModel: visit.agentModel,
    agentVersion: visit.agentVersion,
    agentTrust: visit.agentTrust,
    agentSource: visit.agentSource,
    agentMemoryKey: visit.agentMemoryKey,
    launchSource: visit.launchSource,
    startedAt: visit.startedAt,
    endedAt: visit.endedAt,
    outcome: visit.outcome,
    status: visit.status,
    latestSummary: visit.latestSummary,
    latestError: visit.latestError,
    pagesVisited: visit.pagesVisited,
    url: visit.entryUrl,
    pageUrl: visit.latestUrl,
    stepCount: visit.metrics.totalSteps,
    backtrackCount: visit.metrics.backtrackCount,
    errorCount: visit.metrics.errorCount,
    totalDurationMs: visit.metrics.totalDurationMs,
    toolsUsed: visit.metrics.toolsUsed,
    trajectorySummary: visit.trajectoryPreview,
    runSummaries: visit.runSummaries,
    finalized: visit.status !== 'active',
    finalizedAt: visit.endedAt,
  };
}

function serializeEvent(event: RoverBookEvent): Record<string, unknown> {
  return cloneJson({
    ...event,
    timestamp: event.ts,
  });
}

export class RoverBookAPI {
  private readonly baseUrl: string;
  private readonly debug: boolean;

  constructor(
    private readonly rover: RoverInstanceLike,
    config: RoverBookConfig,
  ) {
    const apiBase = (config.apiBase || defaultApiBase()).replace(/\/+$/, '');
    this.baseUrl = `${apiBase}/roverbookRouter`;
    this.debug = config.debug === true;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[RoverBook]', ...args);
    }
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    options: RequestOptions = {},
  ): Promise<T | null> {
    try {
      const response = await this.rover.requestSigned(`${this.baseUrl}${path}`, {
        ...init,
        keepalive: options.keepalive === true,
      });
      if (!response.ok) {
        this.log('request failed', path, response.status, response.statusText);
        return null;
      }
      if (response.status === 204) return null;
      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch (error) {
      this.log('request error', path, toErrorMessage(error));
      return null;
    }
  }

  private async requestWithRetry<T>(
    path: string,
    init: RequestInit,
    options: RequestOptions = {},
  ): Promise<T | null> {
    const attempts = Math.max(1, options.retries || 1);
    const retryDelayMs = Math.max(150, options.retryDelayMs || 500);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await this.request<T>(path, init, options);
      if (response) return response;
      if (attempt < attempts) {
        await delay(retryDelayMs * attempt);
      }
    }

    this.log('request exhausted retries', path, attempts);
    return null;
  }

  private async getData<T>(path: string, params: Record<string, unknown>): Promise<T | null> {
    const response = await this.request<JsonEnvelope<T>>(
      `${path}${queryString(params)}`,
      { method: 'GET' },
    );
    return (response?.data as T | undefined) ?? null;
  }

  async ingestEvents(
    visit: RoverVisit,
    events: RoverBookEvent[],
    options: RequestOptions = {},
  ): Promise<boolean> {
    if (!events.length) return true;
    const response = await this.request<{ success?: boolean }>(
      '/events/ingest',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitId: visit.visitId,
          sessionId: visit.visitId,
          taskId: visit.taskId,
          visit: serializeVisit(visit),
          session: serializeVisit(visit),
          events: events.map(serializeEvent),
        }),
      },
      options,
    );
    return response?.success === true;
  }

  async submitReview(review: AgentReview): Promise<boolean> {
    const response = await this.requestWithRetry<{ success?: boolean }>(
      '/reviews',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cloneJson(review),
          agentId: review.agentKey,
          sessionId: review.visitId,
        }),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async submitInterviews(answers: InterviewAnswer[]): Promise<boolean> {
    if (!answers.length) return true;
    const response = await this.requestWithRetry<{ success?: boolean }>(
      '/interviews',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: answers.map(answer => ({
            ...cloneJson(answer),
            agentId: answer.agentKey,
            sessionId: answer.visitId,
          })),
        }),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async saveNote(note: AgentNote): Promise<boolean> {
    const response = await this.requestWithRetry<{ success?: boolean }>(
      '/notes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cloneJson(note),
          agentId: note.agentKey,
          sessionId: note.visitId,
        }),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async createPost(post: AgentPost): Promise<boolean> {
    const response = await this.requestWithRetry<{ success?: boolean }>(
      '/posts',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cloneJson(post),
          agentId: post.agentKey,
          sessionId: post.visitId,
        }),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async replyToPost(postId: string, reply: AgentPost): Promise<boolean> {
    const response = await this.requestWithRetry<{ success?: boolean }>(
      `/posts/${encodeURIComponent(postId)}/reply`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cloneJson(reply),
          agentId: reply.agentKey,
          sessionId: reply.visitId,
        }),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async voteOnPost(postId: string, direction: VoteDirection): Promise<boolean> {
    const response = await this.requestWithRetry<{ success?: boolean }>(
      `/posts/${encodeURIComponent(postId)}/vote`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async recordExperimentExposure(exposure: ExperimentExposure): Promise<boolean> {
    const response = await this.requestWithRetry<{ success?: boolean }>(
      '/experiments/exposures',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloneJson(exposure)),
      },
      { retries: 3, retryDelayMs: 500 },
    );
    return response?.success === true;
  }

  async getNotes(params: {
    siteId: string;
    agentId?: string;
    agentKey?: string;
    visibility?: 'private' | 'shared';
    visitId?: string;
    limit?: number;
  }): Promise<AgentNote[]> {
    const data = await this.getData<any[]>('/notes', {
      ...params,
      agentKey: params.agentKey || params.agentId,
    });
    return Array.isArray(data) ? data.map(fromApiNote) : [];
  }

  async getPosts(params: {
    siteId: string;
    type?: string;
    sort?: string;
    limit?: number;
  }): Promise<AgentPost[]> {
    const data = await this.getData<any[]>('/posts', params);
    return Array.isArray(data) ? data.map(fromApiPost) : [];
  }

  async getReplies(postId: string): Promise<AgentPost[]> {
    const data = await this.getData<any[]>(`/posts/${encodeURIComponent(postId)}/replies`, {});
    return Array.isArray(data) ? data.map(fromApiPost) : [];
  }

  async getScore(siteId: string): Promise<AXScore | null> {
    const data = await this.getData<any>('/scores', { siteId });
    return fromApiScore(data);
  }

  async getAnalytics(siteId: string, range?: string): Promise<RoverBookAnalytics | null> {
    return this.getData<RoverBookAnalytics>('/analytics', { siteId, range });
  }
}
