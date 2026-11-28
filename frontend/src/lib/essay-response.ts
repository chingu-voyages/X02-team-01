/**
 * JHEP-120 essay-entry policy.
 *
 * The default reuses backend/app/schemas/exam.py's current text-response cap.
 * It is provisional until the product owner confirms the essay-specific limit.
 * Count Unicode code points, not JavaScript UTF-16 units, to match Python len().
 * Validation must never trim, normalize, or truncate the learner's response.
 */
export const defaultEssayMaxCharacters = 10_000;

export interface EssayResponseValidation {
  characterCount: number;
  remainingCharacters: number;
  isBlank: boolean;
  isOverLimit: boolean;
  canSubmit: boolean;
}

export function validateEssayResponse(
  value: string,
  maxCharacters: number = defaultEssayMaxCharacters,
): EssayResponseValidation {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 1) {
    throw new RangeError("The essay character limit must be a positive safe integer.");
  }

  const characterCount = Array.from(value).length;
  const isBlank = value.trim().length === 0;
  const isOverLimit = characterCount > maxCharacters;

  return {
    characterCount,
    remainingCharacters: maxCharacters - characterCount,
    isBlank,
    isOverLimit,
    canSubmit: !isBlank && !isOverLimit,
  };
}
