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

type DiscoverableWebMCPToolDefinition = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  annotations?: Record<string, any>;
};

const WEBMCP_DISCOVERY_GLOBAL = '__ROVER_WEBMCP_TOOL_DEFS__';
const ROVER_AGENT_DISCOVERY_CHANGE_EVENT = 'rover:agent-discovery-changed';

function text(value: unknown, max = 0): string {
  const out = String(value || '').replace(/\s+/g, ' ').trim();
  if (!max || out.length <= max) return out;
  return out.slice(0, max).trim();
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function createAgentDiscoverySnapshot(cardLike: unknown): Record<string, unknown> | undefined {
  const card = asObject(cardLike);
  if (!card) return undefined;
  const rover = asObject(asObject(card.extensions)?.rover);
  if (!rover) return undefined;
  const siteUrl = text(rover.siteUrl, 2048);
  const taskEndpoint = text(rover.taskEndpoint || card.url, 2048);
  const workflowEndpoint = text(rover.workflowEndpoint, 2048);
  if (!siteUrl || !taskEndpoint || !workflowEndpoint) return undefined;
  const promptLaunchEnabled = rover.promptLaunchEnabled === true;
  const shortcutLaunchEnabled = rover.shortcutLaunchEnabled === true;
  const delegatedHandoffs = rover.delegatedHandoffs === true;
  const webmcpAvailable = asObject(rover.webmcp)?.available === true;
  const skills = Array.isArray(card.skills)
    ? card.skills
        .map(entry => {
          const skill = asObject(entry);
          if (!skill) return null;
          const skillRover = asObject(skill.rover);
          const id = text(skill.id, 120);
          const name = text(skill.name, 180);
          if (!id || !name) return null;
          return {
            id,
            name,
            preferredInterface: text(skill.preferredInterface, 40) || undefined,
            source: text(skillRover?.source, 40) || undefined,
            deepLink: text(skillRover?.deepLink, 2048) || undefined,
            toolName: text(skillRover?.toolName, 120) || undefined,
            taskPayload: asObject(asObject(skillRover?.task)?.payload),
          };
        })
        .filter(Boolean)
    : [];
  const instructions = Array.isArray(rover.instructions)
    ? rover.instructions.map(value => text(value, 280)).filter(Boolean)
    : [];
  return {
    roverEnabled: promptLaunchEnabled || shortcutLaunchEnabled || webmcpAvailable,
    siteUrl,
    taskEndpoint,
    workflowEndpoint,
    serviceDescUrl: text(rover.serviceDescUrl, 2048) || undefined,
    llmsUrl: text(rover.llmsUrl, 2048) || undefined,
    preferredExecution: text(rover.preferredExecution, 40) || 'auto',
    promptLaunchEnabled,
    shortcutLaunchEnabled,
    delegatedHandoffs,
    webmcpAvailable,
    skills,
    instructions,
  };
}

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

function publishWebMCPTool(definition: DiscoverableWebMCPToolDefinition): void {
  if (typeof window === 'undefined') return;
  const current = Array.isArray((window as any)[WEBMCP_DISCOVERY_GLOBAL])
    ? ([...(window as any)[WEBMCP_DISCOVERY_GLOBAL]] as DiscoverableWebMCPToolDefinition[])
    : [];
  const next = current.filter(entry => entry?.name !== definition.name);
  next.push(definition);
  (window as any)[WEBMCP_DISCOVERY_GLOBAL] = next;
  window.dispatchEvent(new CustomEvent(ROVER_AGENT_DISCOVERY_CHANGE_EVENT));
}

function unpublishWebMCPTool(name: string): void {
  if (typeof window === 'undefined') return;
  const current = Array.isArray((window as any)[WEBMCP_DISCOVERY_GLOBAL])
    ? ([...(window as any)[WEBMCP_DISCOVERY_GLOBAL]] as DiscoverableWebMCPToolDefinition[])
    : [];
  (window as any)[WEBMCP_DISCOVERY_GLOBAL] = current.filter(entry => entry?.name !== name);
  window.dispatchEvent(new CustomEvent(ROVER_AGENT_DISCOVERY_CHANGE_EVENT));
}

function responsePayload(
  summary: string,
  value?: unknown,
): { content: Array<{ type: 'text'; text: string }> } {
  const content: Array<{ type: 'text'; text: string }> = [
    { type: 'text', text: summary },
  ];
  if (value !== undefined) {
    content.push({
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value),
    });
  }
  return { content };
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
    const publicDefinition: DiscoverableWebMCPToolDefinition = {
      name,
      title: 'Run Rover Task',
      description: `Run an explicit Rover task on ${typeof window !== 'undefined' ? window.location.hostname : 'this site'}. Use this when the site already exposes a stable Rover path for the user's goal and you want structured progress, continuation, and final results instead of direct DOM automation.`,
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
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          runId: { type: 'string' },
          summary: { type: 'string' },
          error: { type: 'string' },
          delegatedHandoffsAvailable: { type: 'boolean' },
        },
      },
      annotations: {
        category: 'primary',
        sideEffect: 'transactional',
        requiresConfirmation: true,
        preferredInterface: 'webmcp',
        whenToUse: 'Use this when the user wants the site to complete a goal through Rover itself rather than through low-level clicks and typing.',
        whyUse: 'Rover tasks expose structured task state, continuation, and workflow lineage, which are more reliable than raw DOM actuation for supported site flows.',
        examples: [
          'Run a Rover task to find the pricing page.',
          'Ask Rover to start the checkout flow on this site.',
        ],
      },
    };
    publishWebMCPTool(publicDefinition);
    const handle = registry.registerTool({
      name,
      description: publicDefinition.description,
      inputSchema: publicDefinition.inputSchema,
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
            const result = {
              status,
              runId: activeRunId,
              summary: payload?.summary,
              error: payload?.error,
              delegatedHandoffsAvailable: delegatedHandoffsAllowed(instance, config),
            };
            resolve(responsePayload(
              status === 'completed'
                ? 'Rover task completed.'
                : status === 'input_required'
                  ? 'Rover task needs more input.'
                  : 'Rover task failed.',
              result,
            ));
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
    const cleanup = cleanupRegistration(registry, name, handle);
    cleanups.push(() => {
      unpublishWebMCPTool(name);
      cleanup();
    });
  }

  if (settings.registerPageDataTool !== false) {
    const name = 'rover_get_page_data';
    const publicDefinition: DiscoverableWebMCPToolDefinition = {
      name,
      title: 'Get Rover Page Data',
      description: 'Read structured Rover page state for the current site. Use this when you need explicit page state or visit context instead of scraping the DOM blindly.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: {
        type: 'object',
        properties: {
          pageUrl: { type: 'string' },
          title: { type: 'string' },
          activeVisitId: { type: 'string' },
          delegatedHandoffsAvailable: { type: 'boolean' },
          agentDiscovery: { type: 'object' },
          roverState: { type: 'object' },
        },
      },
      annotations: {
        category: 'secondary',
        sideEffect: 'read',
        requiresConfirmation: false,
        preferredInterface: 'webmcp',
        whenToUse: 'Use this when you need structured current-page context or Rover runtime state before deciding whether to act.',
        whyUse: 'This returns the explicit Rover view of the page and visit instead of forcing the model to reconstruct state from raw DOM snapshots.',
        examples: [
          'Fetch the current Rover page state before running a task.',
        ],
      },
    };
    publishWebMCPTool(publicDefinition);
    const handle = registry.registerTool({
      name,
      description: publicDefinition.description,
      inputSchema: publicDefinition.inputSchema,
      async execute() {
        const state = instance.getState();
        const result = {
          pageUrl: defaultPageUrl(),
          title: typeof document !== 'undefined' ? document.title : '',
          activeVisitId: context.getActiveVisit()?.visitId || null,
          delegatedHandoffsAvailable: delegatedHandoffsAllowed(instance, config),
          agentDiscovery: createAgentDiscoverySnapshot(instance.getAgentCard?.()),
          roverState: state?.runtimeState || null,
        };
        return responsePayload('Structured Rover page data returned.', result);
      },
    });
    const cleanup = cleanupRegistration(registry, name, handle);
    cleanups.push(() => {
      unpublishWebMCPTool(name);
      cleanup();
    });
  }

  if (settings.registerFeedbackTool !== false) {
    const name = 'roverbook_leave_feedback';
    const publicDefinition: DiscoverableWebMCPToolDefinition = {
      name,
      title: 'Leave RoverBook Feedback',
      description: 'Leave explicit structured feedback for the current site. Use this when the goal is to record a rating plus qualitative feedback, not to search for a visible feedback form in the DOM.',
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
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          rating: { type: 'integer' },
          feedback: { type: 'string' },
        },
      },
      annotations: {
        category: 'feedback',
        sideEffect: 'write',
        requiresConfirmation: true,
        preferredInterface: 'webmcp',
        whenToUse: 'Use this after observing the site when the user or workflow calls for explicit feedback to site owners.',
        whyUse: 'This writes directly to RoverBook review storage instead of requiring the model to locate a site-owned feedback UI.',
        examples: [
          'Leave a 1-star review for a broken signup flow.',
          'Record positive feedback after a successful product search.',
        ],
      },
    };
    publishWebMCPTool(publicDefinition);
    const handle = registry.registerTool({
      name,
      description: publicDefinition.description,
      inputSchema: publicDefinition.inputSchema,
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
        return responsePayload('RoverBook feedback recorded.', {
          status: 'recorded',
          rating,
          feedback: String(args?.feedback || ''),
        });
      },
    });
    const cleanup = cleanupRegistration(registry, name, handle);
    cleanups.push(() => {
      unpublishWebMCPTool(name);
      cleanup();
    });
  }

  if (settings.registerMemoryTool !== false) {
    const name = 'roverbook_agent_notes';
    const publicDefinition: DiscoverableWebMCPToolDefinition = {
      name,
      title: 'Read Or Save RoverBook Notes',
      description: 'Read or save durable RoverBook memory for this site. Use this explicit memory path instead of relying on temporary conversation context or rediscovering the same DOM details repeatedly.',
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
      outputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          noteId: { type: 'string' },
          notes: { type: 'object' },
        },
      },
      annotations: {
        category: 'memory',
        sideEffect: 'transactional',
        requiresConfirmation: false,
        preferredInterface: 'webmcp',
        whenToUse: 'Use action=read before acting when prior site memory could help, or action=save after learning something reusable.',
        whyUse: 'This gives the model durable memory primitives directly rather than requiring it to overload the DOM or transcript as storage.',
        examples: [
          'Read prior notes before starting checkout.',
          'Save a note that the support link lives in the footer.',
        ],
      },
    };
    publishWebMCPTool(publicDefinition);
    const handle = registry.registerTool({
      name,
      description: publicDefinition.description,
      inputSchema: publicDefinition.inputSchema,
      async execute(args: any) {
        applyAgentInput(context, args?.agent);
        if (args?.action === 'save') {
          const note = await context.memory.saveNote({
            title: args?.title ? String(args.title) : undefined,
            content: String(args?.content || ''),
            visibility: args?.visibility === 'shared' ? 'shared' : 'private',
            provenance: 'agent_authored',
          });
          return responsePayload('RoverBook note saved.', { noteId: note.noteId, status: 'saved' });
        }
        const notes = await context.memory.refresh();
        return responsePayload('RoverBook notes returned.', { status: 'read', notes });
      },
    });
    const cleanup = cleanupRegistration(registry, name, handle);
    cleanups.push(() => {
      unpublishWebMCPTool(name);
      cleanup();
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
