import { clamp, createId } from './helpers.js';
import type { AgentReview, ResolvedAgentIdentity, RoverVisit } from './types.js';
import { RoverBookAPI } from './api.js';

function roundStars(value: number): number {
  return clamp(Math.round(value), 1, 5);
}

export function buildDerivedReview(
  visit: RoverVisit,
  identity: ResolvedAgentIdentity,
): AgentReview {
  const totalSteps = Math.max(1, visit.metrics.totalSteps);
  const errorRate = visit.metrics.errorCount / totalSteps;
  const backtrackRate = visit.metrics.backtrackCount / totalSteps;
  const avgStepDuration = visit.metrics.totalDurationMs / totalSteps;

  const accuracy = roundStars(5 - errorRate * 10);
  const speed = roundStars(5 - Math.max(0, avgStepDuration - 1500) / 1200);
  const easeOfUse = roundStars(5 - backtrackRate * 12 - Math.max(0, totalSteps - 8) / 4);
  const logic = roundStars(
    visit.outcome === 'success'
      ? 5 - errorRate * 6
      : visit.outcome === 'failure'
        ? 2.2 - errorRate * 4
        : 3.4 - errorRate * 3,
  );
  const overallRating = roundStars((accuracy + speed + easeOfUse + logic) / 4);
  const sentiment =
    overallRating >= 4
      ? 'positive'
      : overallRating <= 2
        ? 'negative'
        : visit.metrics.errorCount > 0 || visit.metrics.backtrackCount > 0
          ? 'mixed'
          : 'neutral';

  const painPoints: string[] = [];
  if (visit.latestError) painPoints.push(visit.latestError);
  if (visit.metrics.backtrackCount > 0) {
    painPoints.push(`Backtracked ${visit.metrics.backtrackCount} time(s) across ${visit.pagesVisited.length} pages.`);
  }
  if (visit.metrics.totalSteps > 10) {
    painPoints.push(`Needed ${visit.metrics.totalSteps} steps to finish the task.`);
  }
  if (visit.metrics.totalDurationMs > 30000) {
    painPoints.push(`Visit took ${(visit.metrics.totalDurationMs / 1000).toFixed(1)}s.`);
  }

  const suggestions: string[] = [];
  if (visit.metrics.backtrackCount > 0) suggestions.push('Clarify navigation and page labeling for agents.');
  if (visit.metrics.errorCount > 0) suggestions.push('Fix interactive states or selectors that caused tool failures.');
  if (visit.metrics.totalSteps > 10) suggestions.push('Shorten the happy-path flow for common tasks.');
  if (visit.metrics.totalDurationMs > 30000) suggestions.push('Reduce latency on high-frequency interactions.');

  const summary =
    visit.outcome === 'success'
      ? `Derived from Rover telemetry: the agent completed the task in ${visit.metrics.totalSteps} steps with ${visit.metrics.errorCount} errors.`
      : visit.outcome === 'failure'
        ? `Derived from Rover telemetry: the task failed after ${visit.metrics.totalSteps} steps and ${visit.metrics.errorCount} errors.`
        : `Derived from Rover telemetry: the task paused or partially completed after ${visit.metrics.totalSteps} steps.`;

  return {
    reviewId: createId('review'),
    visitId: visit.visitId,
    runId: visit.runSummaries[visit.runSummaries.length - 1]?.runId,
    siteId: visit.siteId,
    agentKey: identity.memoryKey || identity.key,
    agentName: identity.name || visit.agentName,
    agentVendor: identity.vendor || visit.agentVendor,
    agentModel: identity.model || visit.agentModel,
    agentTrust: identity.trust || visit.agentTrust,
    agentSource: identity.source || visit.agentSource,
    provenance: 'derived',
    overallRating,
    categoryRatings: {
      accuracy,
      speed,
      easeOfUse,
      logic,
    },
    summary,
    painPoints,
    suggestions,
    sentiment,
    createdAt: Date.now(),
  };
}

export async function submitDerivedReview(
  api: RoverBookAPI,
  visit: RoverVisit,
  identity: ResolvedAgentIdentity,
): Promise<AgentReview> {
  const review = buildDerivedReview(visit, identity);
  const ok = await api.submitReview(review);
  if (!ok) {
    throw new Error(`Failed to submit derived review for visit ${visit.visitId}`);
  }
  return review;
}
