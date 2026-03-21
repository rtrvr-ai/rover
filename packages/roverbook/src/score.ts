import type { AXScore } from './types.js';

export function scoreTone(score: AXScore | null): 'excellent' | 'healthy' | 'warning' | 'critical' {
  const overall = score?.overall || 0;
  if (overall >= 80) return 'excellent';
  if (overall >= 60) return 'healthy';
  if (overall >= 35) return 'warning';
  return 'critical';
}

export function summarizeScore(score: AXScore | null): string {
  if (!score) return 'No AX score is available yet.';
  return `AX ${score.overall}/100 across ${score.totalVisits} finalized visit(s).`;
}

