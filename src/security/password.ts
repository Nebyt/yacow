// Spending-password strength policy (plan §3.7a). Scores with zxcvbn.
import zxcvbn from 'zxcvbn';

export const MIN_SCORE = 3; // zxcvbn 0..4
export const MIN_LENGTH = 10;

export interface PasswordCheck {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  /** 0..4 label for a strength meter. */
  label: string;
  warning?: string;
  suggestions: string[];
}

const LABELS = ['very weak', 'weak', 'fair', 'strong', 'very strong'];

export function checkPassword(password: string): PasswordCheck {
  const result = zxcvbn(password);
  const score = result.score as PasswordCheck['score'];
  const longEnough = password.length >= MIN_LENGTH;
  const suggestions = [...result.feedback.suggestions];
  if (!longEnough) {
    suggestions.unshift(`Use at least ${MIN_LENGTH} characters.`);
  }
  return {
    ok: longEnough && score >= MIN_SCORE,
    score,
    label: LABELS[score] ?? 'unknown',
    warning: result.feedback.warning || undefined,
    suggestions,
  };
}
