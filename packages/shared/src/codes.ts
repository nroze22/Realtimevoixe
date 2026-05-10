/**
 * Short, usher-friendly join codes for services. Format: SVC-XXXX where X is
 * an unambiguous base-32 alphabet (no I/L/O/0/1 to avoid confusion).
 */

const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 chars, no 0/1/I/L/O

/** Generate a 4-char public code, e.g. "SVC-7K2L". */
export function generateJoinCode(): string {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  }
  return `SVC-${out}`;
}

const JOIN_CODE_REGEX = /^SVC-[2-9A-HJ-NP-Z]{4}$/i;

export function isJoinCode(input: string): boolean {
  return JOIN_CODE_REGEX.test(input.trim());
}

/** Normalize any user input to a canonical join code or null. */
export function normalizeJoinCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned) return null;
  const withDash = cleaned.startsWith('SVC-') ? cleaned : cleaned.startsWith('SVC') ? `SVC-${cleaned.slice(3)}` : `SVC-${cleaned}`;
  return isJoinCode(withDash) ? withDash : null;
}
