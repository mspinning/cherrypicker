/** "ACME Maschinenbau GmbH" → "AM", "Julia Weber" → "JW" */
export function initialsOfName(name: string): string {
  const words = name
    .replace(/\b(GmbH|AG|KG|SE|UG|mbH|Co\.?|Inc\.?|Ltd\.?|LLC|e\.\s?K\.|&)/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·';
}

/** "Industriestr. 12, 70565 Stuttgart, Deutschland" from the separate fields */
export function addressOf(parts: { street: string | null; postalCode: string | null; city: string | null; country: string | null }): string {
  const place = [parts.postalCode, parts.city].filter(Boolean).join(' ');
  return [parts.street, place, parts.country].filter(Boolean).join(', ');
}

/** Only digits and a leading +, for tel: links */
export function telOf(phone: string): string {
  return phone.replace(/(?!^\+)[^\d]/g, '');
}

/** Non-empty parts joined with " · " (templates cannot call filter(Boolean)) */
export function joined(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ');
}
