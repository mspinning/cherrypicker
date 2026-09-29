import { extname } from 'node:path';
import { convert, HtmlToTextOptions } from 'html-to-text';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { normalizeText } from './chunker';

export interface ExtractedText {
  text: string;
  /** Offsets in `text` where each PDF page starts */
  pageStarts?: number[];
  pageCount?: number;
  /** <title> of an HTML page */
  title?: string;
}

type Format = 'pdf' | 'docx' | 'html' | 'text';

const FORMATS: Record<string, Format> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text',
  '.md': 'text',
  '.markdown': 'text',
  '.csv': 'text',
};

/** File types an upload may have; the client shows the same list. */
export const SUPPORTED_EXTENSIONS = Object.keys(FORMATS);

/** Thrown for content that is valid but has nothing to index; shown to the user as is. */
export class ExtractionError extends Error {}

/** Decides by extension first: browsers often send octet-stream for .md or .csv. */
export function formatOf(fileName: string, mimeType?: string | null): Format | null {
  const byExtension = FORMATS[extname(fileName).toLowerCase()];
  if (byExtension) return byExtension;
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  if (mime.startsWith('text/')) return 'text';
  return null;
}

export async function extractFromFile(buffer: Buffer, fileName: string, mimeType?: string | null): Promise<ExtractedText> {
  switch (formatOf(fileName, mimeType)) {
    case 'pdf':
      return extractPdf(buffer);
    case 'docx':
      return extractDocx(buffer);
    case 'html':
      return htmlToText(decodeText(buffer));
    case 'text':
      return { text: normalizeText(decodeText(buffer)) };
    default:
      throw new ExtractionError('Dieser Dateityp wird nicht unterstützt.');
  }
}

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer), { verbosity: 0 });
    try {
      pages = (await extractText(pdf, { mergePages: false })).text;
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (err) {
    if ((err as Error)?.name === 'PasswordException') {
      throw new ExtractionError('Das PDF ist passwortgeschützt.');
    }
    throw new ExtractionError('Das PDF ist beschädigt oder lässt sich nicht lesen.');
  }

  const pageStarts: number[] = [];
  let text = '';
  for (const page of pages) {
    const normalized = normalizeText(page);
    pageStarts.push(text ? text.length + 2 : 0);
    text = text ? (normalized ? `${text}\n\n${normalized}` : text) : normalized;
  }
  if (!text) {
    throw new ExtractionError('Das PDF enthält keinen lesbaren Text, vermutlich ist es gescannt.');
  }
  return { text, pageStarts, pageCount: pages.length };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedText> {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: normalizeText(value) };
  } catch {
    throw new ExtractionError('Das Word-Dokument ist beschädigt oder kein .docx.');
  }
}

const HTML_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'nav', format: 'skip' },
    { selector: 'footer', format: 'skip' },
    { selector: 'aside', format: 'skip' },
    { selector: 'form', format: 'skip' },
    { selector: 'button', format: 'skip' },
    { selector: 'svg', format: 'skip' },
    { selector: 'iframe', format: 'skip' },
    { selector: 'noscript', format: 'skip' },
    ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((selector) => ({ selector, options: { uppercase: false } })),
    { selector: 'table', format: 'dataTable' },
  ],
};

/**
 * Main content only: the first of <main>, <article>, <body> that has text.
 * Navigation, footer and forms would otherwise repeat on every page.
 */
export function htmlToText(html: string): ExtractedText {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  for (const base of ['main', 'article', '[role=main]', 'body']) {
    const text = normalizeText(
      convert(html, { ...HTML_OPTIONS, baseElements: { selectors: [base], returnDomByDefault: base === 'body' } }),
    );
    if (text.length > 80 || base === 'body') {
      return { text, title: title ? normalizeText(convert(title, { wordwrap: false })) : undefined };
    }
  }
  return { text: '' };
}

/** UTF-8 if valid, otherwise Windows-1252 (Excel exports, older German files). */
export function decodeText(buffer: Buffer, charset?: string): string {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // unknown label, fall through to detection
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/** 1-based pages a text range covers, for citing "Seite 3–4". */
export function pagesOf(pageStarts: number[] | undefined, start: number, end: number): [number, number] | undefined {
  if (!pageStarts?.length) return undefined;
  const pageAt = (offset: number) => {
    let page = 0;
    while (page + 1 < pageStarts.length && pageStarts[page + 1] <= offset) page++;
    return page + 1;
  };
  return [pageAt(start), pageAt(Math.max(start, end - 1))];
}
