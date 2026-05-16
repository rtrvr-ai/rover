/**
 * Decide whether a composer submission originated from voice dictation.
 *
 * Two reliable signals are combined:
 * 1. The dictation→auto-submit path passes `explicitFromVoice: true` because it
 *    unambiguously knows the submit came from voice (pendingVoiceSubmit is only
 *    set when the visitor pressed Send while dictation was still listening).
 * 2. For the manual-review path (dictate → voice ends on silence → visitor
 *    reviews and clicks Send), we use `voiceOriginText` presence as the signal.
 *    The composer's onTextInput handler clears composerVoiceOriginText the
 *    moment the visitor types/pastes/cuts (when voice is not listening), so a
 *    non-empty value here means "current draft came from voice dictation and
 *    was not manually edited."
 *
 * We intentionally do NOT compare voiceOriginText to the submitted message
 * string. That comparison was the original bug: the textarea may hold interim
 * transcript while voiceOriginText is set from the final draft, and the two
 * routinely diverge by a chunk boundary or trailing space.
 */
export function resolveSubmittedFromVoice(input: {
  explicitFromVoice?: boolean;
  voiceOriginText?: string;
}): boolean {
  if (input.explicitFromVoice === true) return true;
  return String(input.voiceOriginText || '').trim().length > 0;
}
