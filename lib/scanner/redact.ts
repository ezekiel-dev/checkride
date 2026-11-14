/**
 * Redact a secret for storage/display: keep the first 4 and last 2 characters,
 * mask everything in between with "*". Values shorter than 12 characters are
 * fully masked. Unicode-safe (counts code points, not UTF-16 units).
 */
export function redactSecret(value: string): string {
  const chars = Array.from(value);
  if (chars.length === 0) {
    return "";
  }
  if (chars.length < 12) {
    return "*".repeat(chars.length);
  }
  return `${chars.slice(0, 4).join("")}${"*".repeat(chars.length - 6)}${chars.slice(-2).join("")}`;
}
