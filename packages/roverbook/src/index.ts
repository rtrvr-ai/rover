import {
  buildAgentMemoryKey,
  createId,
  defaultPageUrl,
  resolveRuntimeAgentIdentity,
  toErrorMessage,
} from './helpers.js';
import { RoverBookAPI } from './api.js';
import { DiscussionBoard } from './board.js';
import { EventCollector } from './collector.js';
import { submitDerivedInterviews, DEFAULT_INTERVIEW_QUESTIONS } from './interviewer.js';
import { AgentMemory } from './memory.js';
import { submitDerivedReview } from './reviewer.js';
import { registerTools } from './tools.js';
import { VisitTracker } from './trajectory.js';
import { registerWebMCPTools } from './webmcp.js';
import type {
  ExperimentExposure,
  NotesSnapshot,
  ResolvedAgentIdentity,
  RoverBookConfig,
  RoverBookEvent,
  RoverBookInstance,
  RoverInstanceLike,
  RoverVisit,
  RunLifecyclePayload,
  RunStartedPayload,
} from './types.js';

export type {
  AgentNote,
  AgentPost,
  AgentReview,
  AXScore,
  ExperimentExposure,
  IdentityResolver,
  InterviewAnswer,
  NotesSnapshot,
  ResolvedAgentIdentity,
  RoverBookAnalytics,
  RoverBookConfig,
  RoverBookEvent,
  RoverBookInstance,
  RoverInstanceLike,
  RoverRunSummary,
  RoverVisit,
  RoverVisitMetrics,
  RunLifecyclePayload,
  RunStartedPayload,
  TrajectoryStep,
} from './types.js';

function createAnonymousIdentity(siteId: string): ResolvedAgentIdentity {
  const key = `anon:${siteId}:${createId('agent')}`;
  return {
    key,
    name: 'Anonymous agent',
    trust: 'anonymous',
    source: 'anonymous',
    memoryKey: key,
    launchSource: 'embedded_widget',
    anonymous: true,
  };
}

export function enableRoverBook(
  instance: RoverInstanceLike,
  config: RoverBookConfig,
): RoverBookInstance {
  const debug = config.debug === true;
  const log = (...args: unknown[]) => {
    if (debug) console.log('[RoverBook]', ...args);
  };

  const identityState = {
    value: createAnonymousIdentity(config.siteId),
    promise: null as Promise<ResolvedAgentIdentity> | null,
    override: null as ResolvedAgentIdentity | null,
  };

  const normalizeIdentity = (
    identity: Partial<ResolvedAgentIdentity> | null | undefined,
    defaults: Partial<ResolvedAgentIdentity> = {},
  ): ResolvedAgentIdentity => {
    const fallback = identityState.value.anonymous ? identityState.value : createAnonymousIdentity(config.siteId);
    const merged: Partial<ResolvedAgentIdentity> = {
      ...defaults,
      ...(identity || {}),
    };
    const hasAgentSignal = Boolean(
      merged.key
      || merged.memoryKey
      || merged.vendor
      || merged.model
      || merged.name
      || merged.signatureAgent
      || merged.userAgent
      || merged.clientId,
    );
    const trust =
      merged.trust
      || (
        merged.source === 'public_task_agent'
        || merged.source === 'handoff_agent'
        || merged.source === 'webmcp_agent'
          ? 'self_reported'
          : merged.source === 'signature_agent'
            || merged.source === 'user_agent'
            || merged.source === 'owner_resolver'
            ? 'heuristic'
            : undefined
      )
      || (merged.anonymous === true || !hasAgentSignal ? 'anonymous' : undefined);
    const anonymous = merged.anonymous === true || trust === 'anonymous';
    const memoryKey =
      merged.memoryKey
      || buildAgentMemoryKey({
        key: merged.key,
        memoryKey: merged.memoryKey,
        vendor: merged.vendor,
        signatureAgent: merged.signatureAgent,
        anonymous,
      })
      || fallback.memoryKey
      || fallback.key;
    const launchSource =
      merged.launchSource
      || (
        merged.source === 'handoff_agent'
          ? 'delegated_handoff'
          : merged.source === 'webmcp_agent'
            ? 'webmcp'
            : merged.source === 'public_task_agent'
              ? 'public_task_api'
              : undefined
      )
      || fallback.launchSource;
    return {
      key: merged.key || memoryKey || fallback.key,
      name: merged.name || (anonymous ? 'Anonymous agent' : undefined) || merged.vendor || fallback.name,
      vendor: merged.vendor,
      model: merged.model,
      version: merged.version,
      homepage: merged.homepage,
      trust,
      source: merged.source || (anonymous ? 'anonymous' : fallback.source),
      memoryKey,
      clientId: merged.clientId,
      signatureAgent: merged.signatureAgent,
      userAgent: merged.userAgent,
      launchSource,
      metadata: merged.metadata,
      anonymous,
    };
  };

  const resolveIdentity = async (): Promise<ResolvedAgentIdentity> => {
    if (identityState.promise) return identityState.promise;
    identityState.promise = (async () => {
      const runtimeIdentity = resolveRuntimeAgentIdentity(instance.getState());
      if (runtimeIdentity) {
        identityState.value = normalizeIdentity(runtimeIdentity);
        return identityState.value;
      }
      if (identityState.override) {
        identityState.value = normalizeIdentity(identityState.override);
        return identityState.value;
      }
      try {
        const resolved = await config.identityResolver?.({
          rover: instance,
          siteId: config.siteId,
          pageUrl: defaultPageUrl(),
          config,
        });
        if (resolved) {
          identityState.value = normalizeIdentity(resolved, {
            source: 'owner_resolver',
            trust: resolved.trust || 'heuristic',
          });
        }
      } catch (error) {
        log('identity resolution failed', toErrorMessage(error));
      }
      return identityState.value;
    })().finally(() => {
      identityState.promise = null;
    });
    return identityState.promise;
  };

  void resolveIdentity();

  const api = new RoverBookAPI(instance, config);
  const tracker = new VisitTracker(config, identityState.value);
  const applyIdentity = (identity: Partial<ResolvedAgentIdentity> | null | undefined): ResolvedAgentIdentity => {
    const resolved = normalizeIdentity(identity);
    identityState.value = resolved;
    tracker.setIdentity(resolved);
    if (resolved.name && resolved.anonymous !== true) {
      instance.identify({ name: resolved.name });
    }
    return resolved;
  };
  const setAgentOverride = (identity: Partial<ResolvedAgentIdentity> | null | undefined): ResolvedAgentIdentity => {
    const resolved = normalizeIdentity(identity, {
      source: 'webmcp_agent',
      trust: 'self_reported',
      launchSource: 'webmcp',
    });
    identityState.promise = null;
    identityState.override = resolved;
    return applyIdentity(resolved);
  };
  const collector = new EventCollector(api, config, { debug });
  const memory = new AgentMemory(api, config, {
    resolveIdentity: async () => {
      return applyIdentity(await resolveIdentity());
    },
    getActiveVisit: () => tracker.getActiveVisit(),
  });
  const board = new DiscussionBoard(api, {
    resolveIdentity: async () => {
      return applyIdentity(await resolveIdentity());
    },
    getActiveVisit: () => tracker.getActiveVisit(),
    siteId: config.siteId,
  });
  const finalizedVisits = new Set<string>();

  const recordUpdate = (update: { event?: RoverBookEvent; visit?: RoverVisit; finalized?: boolean } | null): void => {
    if (!update) return;
    if (update.visit) collector.updateVisit(update.visit);
    if (update.event) collector.record(update.event, update.visit);
    if (update.finalized && update.visit) {
      void finalizeVisit(update.visit);
    }
  };

  const finalizeVisit = async (visit: RoverVisit): Promise<void> => {
    if (finalizedVisits.has(visit.visitId)) return;
    finalizedVisits.add(visit.visitId);
    collector.updateVisit(visit);
    const identity = applyIdentity(await resolveIdentity());
    if (config.memory?.enabled !== false && config.memory?.autoDerivedNotes !== false) {
      try {
        await memory.createDerivedNotes(visit);
      } catch (error) {
        log('derived note submission failed', visit.visitId, toErrorMessage(error));
      }
    }
    if (config.interviews?.enabled !== false && config.interviews?.autoDerivedAnswers !== false) {
      const questions = config.interviews?.questions || DEFAULT_INTERVIEW_QUESTIONS;
      try {
        await submitDerivedInterviews(api, visit, identity, questions);
      } catch (error) {
        log('derived interview submission failed', visit.visitId, toErrorMessage(error));
      }
    }
    try {
      await submitDerivedReview(api, visit, identity);
    } catch (error) {
      log('derived review submission failed', visit.visitId, toErrorMessage(error));
    }
    await collector.flush();
  };

  const unregisterPromptContext = instance.registerPromptContextProvider(async input => {
    if (!input.isFreshTask) return undefined;
    const identity = applyIdentity(await resolveIdentity());
    const message = await memory.buildPromptContext();
    if (!message) return undefined;
    return {
      role: 'model',
      source: 'roverbook-memory',
      message,
    };
  });

  registerTools(instance, {
    api,
    memory,
    board,
    resolveIdentity: async () => {
      return applyIdentity(await resolveIdentity());
    },
    getActiveVisit: () => tracker.getActiveVisit(),
    config,
  });

  const cleanupWebMCP = registerWebMCPTools(instance, config, {
    api,
    memory,
    resolveIdentity: async () => {
      return applyIdentity(await resolveIdentity());
    },
    getActiveVisit: () => tracker.getActiveVisit(),
    setAgentOverride,
  });

  const unsubs = [
    instance.on('task_started', async payload => {
      applyIdentity(await resolveIdentity());
      recordUpdate(tracker.handleTaskStarted(payload || {}));
    }),
    instance.on('run_started', async payload => {
      applyIdentity(await resolveIdentity());
      recordUpdate(tracker.handleRunStarted((payload || {}) as RunStartedPayload));
    }),
    instance.on('tool_start', payload => {
      recordUpdate(tracker.handleToolStart(payload || {}));
    }),
    instance.on('tool_result', payload => {
      recordUpdate(tracker.handleToolResult(payload || {}));
    }),
    instance.on('status', payload => {
      recordUpdate(tracker.handleStatus(payload || {}));
    }),
    instance.on('error', payload => {
      recordUpdate(tracker.handleError(payload || {}));
    }),
    instance.on('navigation_guardrail', payload => {
      recordUpdate(tracker.handleNavigationGuardrail(payload || {}));
    }),
    instance.on('run_state_transition', payload => {
      recordUpdate(tracker.handleRunLifecycle('run_state_transition', (payload || {}) as RunLifecyclePayload));
    }),
    instance.on('run_completed', payload => {
      recordUpdate(tracker.handleRunLifecycle('run_completed', (payload || {}) as RunLifecyclePayload));
    }),
    instance.on('task_ended', payload => {
      recordUpdate(tracker.handleTaskEnded(payload || {}));
    }),
  ];

  void memory.refresh().catch(error => {
    log('memory preload failed', toErrorMessage(error));
  });

  return {
    flush: () => collector.flush(),
    shutdown: async () => {
      for (const unsub of unsubs) unsub();
      unregisterPromptContext();
      cleanupWebMCP?.();
      await collector.dispose();
    },
    exposeExperiment: async (
      experimentId: string,
      variantId: string,
      metadata?: Record<string, unknown>,
    ): Promise<ExperimentExposure | null> => {
      const visit = tracker.getActiveVisit();
      if (!visit) return null;
      const exposure: ExperimentExposure = {
        exposureId: createId('exposure'),
        siteId: config.siteId,
        visitId: visit.visitId,
        experimentId,
        variantId,
        metadata,
        createdAt: Date.now(),
      };
      const ok = await api.recordExperimentExposure(exposure);
      if (!ok) return null;
      collector.record({
        eventId: createId('event'),
        type: 'experiment_exposure',
        siteId: config.siteId,
        visitId: visit.visitId,
        taskId: visit.taskId,
        ts: Date.now(),
        pageUrl: visit.latestUrl,
        summary: `${experimentId}:${variantId}`,
        payload: {
          experimentId,
          variantId,
          metadata,
        },
      }, visit);
      return exposure;
    },
    getNotes: async (): Promise<NotesSnapshot> => memory.refresh(true),
    getBoardPosts: options => board.listPosts(options),
    getScore: () => api.getScore(config.siteId),
  };
}
