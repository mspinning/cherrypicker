export interface TextChunk {
  content: string;
  /** Offsets into the (normalized) source text */
  start: number;
  end: number;
}

export interface ChunkOptions {
  /** Hard upper limit per chunk */
  maxChars: number;
  /** A break is only searched after this many characters, so chunks do not get tiny */
  minChars: number;
  /** Characters repeated from the end of the previous chunk, keeps context across the cut */
  overlap: number;
}

/**
 * ~350 tokens per chunk: big enough to carry a full service description or
 * offer position, small enough for precise retrieval.
 */
export const DEFAULT_CHUNKING: ChunkOptions = { maxChars: 1400, minChars: 500, overlap: 200 };

/** Collapses the whitespace noise PDF and HTML extraction leave behind. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Cuts text into overlapping chunks. Prefers paragraph breaks, then line
 * breaks, then sentence ends, then spaces, so a chunk rarely ends mid-thought.
 */
export function chunkText(text: string, options: ChunkOptions = DEFAULT_CHUNKING): TextChunk[] {
  const { maxChars, minChars, overlap } = options;
  const chunks: TextChunk[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = Math.min(pos + maxChars, text.length);
    if (end < text.length) {
      end = findBreak(text, pos + minChars, end);
    }

    const raw = text.slice(pos, end);
    const lead = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (content) {
      chunks.push({ content, start: pos + lead, end: pos + lead + content.length });
    }
    if (end >= text.length) break;

    pos = Math.max(nextStart(text, end - overlap, end), pos + 1);
  }
  return chunks;
}

/** Last good break position in (from, to]; `to` itself if there is none. */
function findBreak(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  for (const pattern of [/\n\n/g, /\n/g, /[.!?:;](?=\s)/g, /\s/g]) {
    let last = -1;
    for (const match of window.matchAll(pattern)) {
      last = match.index + match[0].length;
    }
    if (last > 0) return from + last;
  }
  return to;
}

/** Start of the overlap: the beginning of a sentence or at least of a word. */
function nextStart(text: string, from: number, end: number): number {
  if (from <= 0) return 0;
  const window = text.slice(from, end);
  const match = /(?<=[.!?\n])\s*(?=\S)/.exec(window) ?? /\s(?=\S)/.exec(window);
  return match ? from + match.index + match[0].length : end;
}
