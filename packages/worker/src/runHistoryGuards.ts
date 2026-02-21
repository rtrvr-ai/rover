export function shouldClearHistoryForRun(params: {
  resume?: boolean;
  preserveHistory?: boolean;
}): boolean {
  return !params.resume && !params.preserveHistory;
}

export function shouldBuildResumeCueChatLog(params: {
  resume?: boolean;
  preserveHistory?: boolean;
  resumeFollowupMode?: 'deterministic_cues' | string;
}): boolean {
  return !!(params.resume || params.preserveHistory) && params.resumeFollowupMode === 'deterministic_cues';
}
