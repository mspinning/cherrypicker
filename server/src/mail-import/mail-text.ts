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

  const cut = quoteStart(text);
  if (hasOwnText(text, cut)) text = text.slice(0, cut);

  text = tidy(
    text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('>'))
      .join('\n'),
  );

  if (text.length <= maxChars) return text;
  const tail = Math.min(600, Math.floor(maxChars / 3));
  return `${text.slice(0, maxChars - tail - 5).trimEnd()}\n[…]\n${text.slice(-tail).trimStart()}`;
}

/**
 * The conversation quoted below the new text: what the mail answers to.
 * Empty if nothing is quoted, or if the quote is all the mail consists of
 * (then `cleanMailText` already returns it).
 */
export function quotedHistory(full: string, maxChars = 1500): string {
  const text = full.replace(/\r\n?/g, '\n');
  const cut = quoteStart(text);
  if (cut >= text.length || !hasOwnText(text, cut)) return '';
  const quoted = tidy(
    text
      .slice(cut)
      .split('\n')
      .map((line) => line.replace(/^\s*(>\s?)+/, ''))
      .join('\n'),
  );
  return quoted.length <= maxChars ? quoted : `${quoted.slice(0, maxChars).trimEnd()}\n[…]`;
}

/** Where the first quoted reply begins; the length of the text if there is none. */
function quoteStart(text: string): number {
  let cut = text.length;
  for (const marker of REPLY_MARKERS) {
    const index = text.search(marker);
    if (index >= 0 && index < cut) cut = index;
  }
  return cut;
}

/** false for a bare forward ("FYI" + quoted mail): there the quoted part is the content. */
function hasOwnText(text: string, cut: number): boolean {
  return text.slice(0, cut).replace(/\s+/g, ' ').trim().length >= 60;
}

function tidy(text: string): string {
  return text
    .replace(/\[cid:[^\]]*]/gi, '')
    .replace(/<mailto:[^>]*>/gi, '')
    .replace(/<?(https?:\/\/[^\s>]{50,})>?/g, (_, url: string) => `[Link ${hostOf(url)}]`)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Link';
  }
}
