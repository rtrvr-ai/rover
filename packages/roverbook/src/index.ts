import { createId, defaultPageUrl, toErrorMessage } from './helpers.js';
import { RoverBookAPI } from './api.js';
import { initializeATP } from './atp.js';
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
  return {
    key: `anon_${siteId}_${createId('agent')}`,
    name: 'Anonymous agent',
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
  };

  const resolveIdentity = async (): Promise<ResolvedAgentIdentity> => {
    if (identityState.promise) return identityState.promise;
    identityState.promise = (async () => {
      try {
        const resolved = await config.identityResolver?.({
          rover: instance,
          siteId: config.siteId,
          pageUrl: defaultPageUrl(),
          config,
        });
        if (resolved?.key) {
          identityState.value = {
            key: resolved.key,
            name: resolved.name,
            model: resolved.model,
            metadata: resolved.metadata,
            anonymous: resolved.anonymous === true,
          };
          if (identityState.value.name) {
            instance.identify({ name: identityState.value.name });
          }
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
  const collector = new EventCollector(api, config, { debug });
  const memory = new AgentMemory(api, config, {
    resolveIdentity: async () => {
      const identity = await resolveIdentity();
      tracker.setIdentity(identity);
      return identity;
    },
    getActiveVisit: () => tracker.getActiveVisit(),
  });
  const board = new DiscussionBoard(api, {
    resolveIdentity: async () => {
      const identity = await resolveIdentity();
      tracker.setIdentity(identity);
      return identity;
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
    const identity = await resolveIdentity();
    tracker.setIdentity(identity);
    if (config.memory?.enabled !== false && config.memory?.autoDerivedNotes !== false) {
      await memory.createDerivedNotes(visit);
    }
    if (config.interviews?.enabled !== false && config.interviews?.autoDerivedAnswers !== false) {
      const questions = config.interviews?.questions || DEFAULT_INTERVIEW_QUESTIONS;
      await submitDerivedInterviews(api, visit, identity, questions);
    }
    await submitDerivedReview(api, visit, identity);
    await collector.flush();
  };

  const unregisterPromptContext = instance.registerPromptContextProvider(async input => {
    if (!input.isFreshTask) return undefined;
    const identity = await resolveIdentity();
    tracker.setIdentity(identity);
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
      const identity = await resolveIdentity();
      tracker.setIdentity(identity);
      return identity;
    },
    getActiveVisit: () => tracker.getActiveVisit(),
    config,
  });

  const cleanupWebMCP = registerWebMCPTools(instance, config, {
    api,
    memory,
    resolveIdentity: async () => {
      const identity = await resolveIdentity();
      tracker.setIdentity(identity);
      return identity;
    },
    getActiveVisit: () => tracker.getActiveVisit(),
  });

  const cleanupATP = initializeATP(instance, config);

  const unsubs = [
    instance.on('task_started', async payload => {
      tracker.setIdentity(await resolveIdentity());
      recordUpdate(tracker.handleTaskStarted(payload || {}));
    }),
    instance.on('run_started', async payload => {
      tracker.setIdentity(await resolveIdentity());
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
      cleanupATP?.();
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
