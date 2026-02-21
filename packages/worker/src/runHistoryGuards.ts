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

export function shouldUseFollowupChatLog(params: {
  resume?: boolean;
  followupChatLogLength?: number;
}): boolean {
  if (params.resume) return false;
  return Number(params.followupChatLogLength) > 0;
}
