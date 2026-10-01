/** Turns a mail body into the few hundred characters an LLM needs: the new text and the signature. */

const REPLY_MARKERS = [
  /^-{2,}\s*(original message|ursprüngliche nachricht|weitergeleitete nachricht|forwarded message|message d'origine)\s*-{2,}/im,
  /^_{8,}\s*$/m,
  /^\*?(von|from):\*?\s.+\n\*?(gesendet|sent|datum|date):/im,
  /^(am|on)\s.{5,160}\s(schrieb|wrote)(\s.{0,120})?:\s*$/im,
];

/**
 * Prefers Graph's uniqueBody (only what this mail added). The full body is
 * cut at the first quoted reply, unless the mail itself is just a forward.
 * Long texts keep their beginning and their end, where the signature is.
 */
export function cleanMailText(unique: string, full: string, maxChars = 1800): string {
  let text = (unique.trim() ? unique : full).replace(/\r\n?/g, '\n');

  let cut = text.length;
  for (const marker of REPLY_MARKERS) {
    const index = text.search(marker);
    if (index >= 0 && index < cut) cut = index;
  }
  // A bare forward ("FYI" + quoted mail): the quoted part is the content
  if (text.slice(0, cut).replace(/\s+/g, ' ').trim().length >= 60) text = text.slice(0, cut);

  text = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\[cid:[^\]]*]/gi, '')
    .replace(/<mailto:[^>]*>/gi, '')
    .replace(/<?(https?:\/\/[^\s>]{50,})>?/g, (_, url: string) => `[Link ${hostOf(url)}]`)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length <= maxChars) return text;
  const tail = Math.min(600, Math.floor(maxChars / 3));
  return `${text.slice(0, maxChars - tail - 5).trimEnd()}\n[…]\n${text.slice(-tail).trimStart()}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Link';
  }
}
