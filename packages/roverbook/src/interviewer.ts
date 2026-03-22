import { createId, hashQuestion } from './helpers.js';
import type { InterviewAnswer, ResolvedAgentIdentity, RoverVisit } from './types.js';
import { RoverBookAPI } from './api.js';

export const DEFAULT_INTERVIEW_QUESTIONS = [
  'What was the hardest part of using this site?',
  'Could you find what you were looking for?',
  'What would you change about the navigation?',
  'How would you rate the overall agent experience?',
];

function answerForQuestion(visit: RoverVisit, question: string): string {
  const lower = question.toLowerCase();
  if (lower.includes('hardest') || lower.includes('difficult')) {
    if (visit.latestError) return `The hardest part was ${visit.latestError}.`;
    if (visit.metrics.backtrackCount > 0) return `The hardest part was navigation. I backtracked ${visit.metrics.backtrackCount} time(s).`;
    return `No single step stood out as hard. The task path stayed stable across ${visit.metrics.totalSteps} step(s).`;
  }
  if (lower.includes('find') || lower.includes('looking for')) {
    if (visit.metrics.backtrackCount > 0) {
      return `I eventually found it, but only after visiting ${visit.pagesVisited.length} pages and backtracking ${visit.metrics.backtrackCount} time(s).`;
    }
    return `Yes. The task stayed on track across ${visit.pagesVisited.length} page(s).`;
  }
  if (lower.includes('change') || lower.includes('navigation')) {
    if (visit.metrics.backtrackCount > 0) return 'I would make the next relevant page or action more explicit so agents do not revisit prior pages.';
    if (visit.metrics.totalSteps > 10) return 'I would collapse the flow so common tasks finish in fewer steps.';
    return 'Navigation was serviceable. I would focus on keeping labels and destinations predictable.';
  }
  if (lower.includes('rate') || lower.includes('experience')) {
    return visit.outcome === 'success'
      ? `Overall it was positive: ${visit.metrics.totalSteps} steps, ${visit.metrics.errorCount} errors, ${visit.metrics.totalDurationMs}ms total.`
      : `Overall it was mixed: outcome=${visit.outcome}, errors=${visit.metrics.errorCount}, backtracks=${visit.metrics.backtrackCount}.`;
  }
  return `I observed outcome=${visit.outcome}, steps=${visit.metrics.totalSteps}, errors=${visit.metrics.errorCount}, pages=${visit.pagesVisited.length}.`;
}

function sentimentForVisit(visit: RoverVisit): InterviewAnswer['sentiment'] {
  if (visit.outcome === 'success' && visit.metrics.errorCount === 0) return 'positive';
  if (visit.outcome === 'failure') return 'negative';
  return 'neutral';
}

export function buildDerivedInterviewAnswers(
  visit: RoverVisit,
  identity: ResolvedAgentIdentity,
  questions: string[],
): InterviewAnswer[] {
  return questions.map(question => {
    const answer = answerForQuestion(visit, question);
    return {
      answerId: createId('answer'),
      questionId: hashQuestion(question),
      visitId: visit.visitId,
      runId: visit.runSummaries[visit.runSummaries.length - 1]?.runId,
      siteId: visit.siteId,
      agentKey: identity.memoryKey || identity.key,
      agentName: identity.name || visit.agentName,
      agentVendor: identity.vendor || visit.agentVendor,
      agentModel: identity.model || visit.agentModel,
      agentTrust: identity.trust || visit.agentTrust,
      agentSource: identity.source || visit.agentSource,
      question,
      answer,
      sentiment: sentimentForVisit(visit),
      isHighlight: answer.length > 60 || visit.metrics.errorCount > 0,
      provenance: 'derived',
      createdAt: Date.now(),
    };
  });
}

export async function submitDerivedInterviews(
  api: RoverBookAPI,
  visit: RoverVisit,
  identity: ResolvedAgentIdentity,
  questions: string[],
): Promise<InterviewAnswer[]> {
  const answers = buildDerivedInterviewAnswers(visit, identity, questions.length ? questions : DEFAULT_INTERVIEW_QUESTIONS);
  const ok = await api.submitInterviews(answers);
  if (!ok) {
    throw new Error(`Failed to submit derived interviews for visit ${visit.visitId}`);
  }
  return answers;
}
