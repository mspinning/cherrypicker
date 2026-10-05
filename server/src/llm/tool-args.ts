/** Arguments of a tool call come from the model and are never trusted: every field is checked and cut to size. */

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isPlaceholder(value: string): boolean {
  return /^(n\/?a|unbekannt|unknown|keine?( angabe)?|null|none|-|–|\?+)$/i.test(value);
}

export function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned && !isPlaceholder(cleaned) ? cleaned.slice(0, max) : undefined;
}

/** Keeps line breaks: mail drafts and call guides have paragraphs. */
export function multiline(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned && !isPlaceholder(cleaned) ? cleaned.slice(0, max) : undefined;
}

export function list(value: unknown, maxItems: number, maxLength: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => text(item, maxLength))
    .filter((item): item is string => !!item)
    .slice(0, maxItems);
}

export function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
}

export function phone(value: unknown): string | undefined {
  const number = text(value, 60);
  return number && /\d{4,}/.test(number.replace(/[\s()./+-]/g, '')) ? number : undefined;
}

export function website(value: unknown): string | undefined {
  const address = text(value, 300);
  if (!address || /\s|@/.test(address)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
    return url.hostname.includes('.') ? `${url.protocol}//${url.hostname}${url.pathname === '/' ? '' : url.pathname}` : undefined;
  } catch {
    return undefined;
  }
}

/** A percentage; models answer 0.9 as often as 90. */
export function clamp(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value <= 1 ? value * 100 : value))) : fallback;
}
