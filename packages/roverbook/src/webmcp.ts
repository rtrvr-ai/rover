import { createId, defaultPageUrl } from './helpers.js';
import type {
  ResolvedAgentIdentity,
  RoverBookConfig,
  RoverInstanceLike,
  RoverVisit,
} from './types.js';
import { RoverBookAPI } from './api.js';
import { AgentMemory } from './memory.js';

type WebMCPContext = {
  api: RoverBookAPI;
  memory: AgentMemory;
  resolveIdentity: () => Promise<ResolvedAgentIdentity>;
  getActiveVisit: () => RoverVisit | undefined;
  setAgentOverride: (identity: Partial<ResolvedAgentIdentity> | null | undefined) => ResolvedAgentIdentity;
};

type RegisteredToolHandle = { unregister?: () => void } | void;

type ModelContextRegistry = {
  registerTool?: (definition: any) => RegisteredToolHandle;
  unregisterTool?: (name: string) => void;
};

function delegatedHandoffsAllowed(instance: RoverInstanceLike, config: RoverBookConfig): boolean {
  if (config.webmcp?.advertiseDelegatedHandoffs !== true) return false;
  const state = instance.getState();
  const aiAccess =
    state?.runtimeState?.backendSiteConfig?.aiAccess
    || state?.runtimeState?.siteConfig?.aiAccess
    || state?.sharedState?.siteConfig?.aiAccess;
  return aiAccess?.enabled !== false && aiAccess?.allowDelegatedHandoffs === true;
}

function cleanupRegistration(registry: ModelContextRegistry, name: string, handle: RegisteredToolHandle): () => void {
  return () => {
    try {
      handle?.unregister?.();
      registry.unregisterTool?.(name);
    } catch {
      // best effort only
    }
  };
}

function responseText(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  };
}

function applyAgentInput(
  context: WebMCPContext,
  agent: Record<string, unknown> | undefined,
): ResolvedAgentIdentity | null {
  if (!agent || typeof agent !== 'object') return null;
  return context.setAgentOverride({
    key: typeof agent.key === 'string' ? agent.key : undefined,
    name:
      typeof agent.name === 'string'
        ? agent.name
        : typeof agent.vendor === 'string'
          ? agent.vendor
          : undefined,
    vendor: typeof agent.vendor === 'string' ? agent.vendor : undefined,
    model: typeof agent.model === 'string' ? agent.model : undefined,
    version: typeof agent.version === 'string' ? agent.version : undefined,
    homepage: typeof agent.homepage === 'string' ? agent.homepage : undefined,
    source: 'webmcp_agent',
    trust: 'self_reported',
    launchSource: 'webmcp',
    anonymous: false,
  });
}

export function registerWebMCPTools(
  instance: RoverInstanceLike,
  config: RoverBookConfig,
  context: WebMCPContext,
): (() => void) | null {
  const settings = {
    enabled: true,
    registerTaskTool: true,
    registerPageDataTool: true,
    registerFeedbackTool: true,
    registerMemoryTool: true,
    ...(config.webmcp || {}),
  };
  if (settings.enabled === false) return null;

  const registry = (typeof navigator !== 'undefined' ? (navigator as any).modelContext : undefined) as ModelContextRegistry | undefined;
  if (!registry?.registerTool) return null;

  const cleanups: Array<() => void> = [];

  if (settings.registerTaskTool !== false) {
    const name = 'rover_run_task';
    const handle = registry.registerTool({
      name,
      description: `Run a Rover task on ${typeof window !== 'undefined' ? window.location.hostname : 'this site'}.`,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Natural-language task to execute on the current site.' },
          agent: {
            type: 'object',
            description: 'Optional self-reported agent identity metadata.',
            properties: {
              key: { type: 'string' },
              name: { type: 'string' },
              vendor: { type: 'string' },
              model: { type: 'string' },
              version: { type: 'string' },
              homepage: { type: 'string' },
            },
          },
        },
        required: ['task'],
      },
      async execute({ task, agent }: { task: string; agent?: Record<string, unknown> }) {
        applyAgentInput(context, agent);
        const startedAfter = Date.now();
        return new Promise(resolve => {
          let activeRunId: string | undefined;
          let settled = false;
          const finish = (status: 'completed' | 'failed' | 'input_required', payload?: any) => {
            if (settled) return;
            settled = true;
            unsubscribeStarted();
            unsubscribeState();
            unsubscribeCompleted();
            clearTimeout(timer);
            resolve(responseText({
              status,
              runId: activeRunId,
              summary: payload?.summary,
              error: payload?.error,
              delegatedHandoffsAvailable: delegatedHandoffsAllowed(instance, config),
            }));
          };
          const matches = (payload: any) => {
            if (!payload) return false;
            if (activeRunId) return payload.runId === activeRunId;
            return Number(payload.startedAt || payload.endedAt || Date.now()) >= startedAfter - 100;
          };
          const unsubscribeStarted = instance.on('run_started', payload => {
            if (Number(payload?.startedAt || Date.now()) < startedAfter - 100) return;
            activeRunId = payload?.runId || activeRunId;
          });
          const unsubscribeState = instance.on('run_state_transition', payload => {
            if (!matches(payload)) return;
            if (payload?.needsUserInput) finish('input_required', payload);
          });
          const unsubscribeCompleted = instance.on('run_completed', payload => {
            if (!matches(payload)) return;
            if (payload?.needsUserInput) {
              finish('input_required', payload);
              return;
            }
            if (payload?.terminalState === 'failed' || payload?.outcome === 'failure' || payload?.ok === false) {
              finish('failed', payload);
              return;
            }
            if (payload?.taskComplete || payload?.terminalState === 'completed') {
              finish('completed', payload);
            }
          });
          const timer = setTimeout(() => finish('failed', { error: 'Timed out waiting for task completion.' }), 90_000);
          instance.send(String(task || ''));
        });
      },
    });
    cleanups.push(cleanupRegistration(registry, name, handle));
  }

  if (settings.registerPageDataTool !== false) {
    const name = 'rover_get_page_data';
    const handle = registry.registerTool({
      name,
      description: 'Get structured Rover page state for the current site.',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        const state = instance.getState();
        return responseText({
          pageUrl: defaultPageUrl(),
          title: typeof document !== 'undefined' ? document.title : '',
          activeVisitId: context.getActiveVisit()?.visitId || null,
          delegatedHandoffsAvailable: delegatedHandoffsAllowed(instance, config),
          roverState: state?.runtimeState || null,
        });
      },
    });
    cleanups.push(cleanupRegistration(registry, name, handle));
  }

  if (settings.registerFeedbackTool !== false) {
    const name = 'roverbook_leave_feedback';
    const handle = registry.registerTool({
      name,
      description: 'Leave explicit RoverBook feedback for the current site.',
      inputSchema: {
        type: 'object',
        properties: {
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          feedback: { type: 'string' },
          painPoints: { type: 'array', items: { type: 'string' } },
          suggestions: { type: 'array', items: { type: 'string' } },
          agent: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              name: { type: 'string' },
              vendor: { type: 'string' },
              model: { type: 'string' },
              version: { type: 'string' },
              homepage: { type: 'string' },
            },
          },
        },
        required: ['rating', 'feedback'],
      },
      async execute(args: any) {
        applyAgentInput(context, args?.agent);
        const identity = await context.resolveIdentity();
        const visit = context.getActiveVisit();
        const rating = Math.max(1, Math.min(5, Math.round(Number(args?.rating || 3) || 3)));
        await context.api.submitReview({
          reviewId: createId('review'),
          visitId: visit?.visitId || createId('visit'),
          runId: visit?.runSummaries[visit.runSummaries.length - 1]?.runId,
          siteId: config.siteId,
          agentKey: identity.memoryKey || identity.key,
          agentName: identity.name,
          agentVendor: identity.vendor || visit?.agentVendor,
          agentModel: identity.model,
          agentTrust: identity.trust || visit?.agentTrust,
          agentSource: identity.source || visit?.agentSource,
          provenance: 'agent_authored',
          overallRating: rating,
          categoryRatings: {
            accuracy: rating,
            speed: rating,
            easeOfUse: rating,
            logic: rating,
          },
          summary: String(args?.feedback || ''),
          painPoints: Array.isArray(args?.painPoints) ? args.painPoints.map(String) : [],
          suggestions: Array.isArray(args?.suggestions) ? args.suggestions.map(String) : [],
          sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
          createdAt: Date.now(),
        });
        return responseText('RoverBook feedback recorded.');
      },
    });
    cleanups.push(cleanupRegistration(registry, name, handle));
  }

  if (settings.registerMemoryTool !== false) {
    const name = 'roverbook_agent_notes';
    const handle = registry.registerTool({
      name,
      description: 'Read or save RoverBook memory for this site.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'save'] },
          content: { type: 'string' },
          title: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'shared'] },
          agent: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              name: { type: 'string' },
              vendor: { type: 'string' },
              model: { type: 'string' },
              version: { type: 'string' },
              homepage: { type: 'string' },
            },
          },
        },
        required: ['action'],
      },
      async execute(args: any) {
        applyAgentInput(context, args?.agent);
        if (args?.action === 'save') {
          const note = await context.memory.saveNote({
            title: args?.title ? String(args.title) : undefined,
            content: String(args?.content || ''),
            visibility: args?.visibility === 'shared' ? 'shared' : 'private',
            provenance: 'agent_authored',
          });
          return responseText({ noteId: note.noteId, status: 'saved' });
        }
        const notes = await context.memory.refresh();
        return responseText(notes);
      },
    });
    cleanups.push(cleanupRegistration(registry, name, handle));
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
