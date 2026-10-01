/** Name handling shared by the CRM and the mail import. */

const LEGAL_FORMS = new Set([
  'gmbh', 'mbh', 'ag', 'kg', 'kgaa', 'ohg', 'gbr', 'ug', 'haftungsbeschraenkt', 'se', 'ek', 'ev', 'eg', 'co', 'cokg',
  'ltd', 'limited', 'inc', 'llc', 'llp', 'corp', 'corporation', 'plc', 'sa', 'sas', 'sarl', 'srl', 'spa', 'bv', 'nv',
  'oy', 'ab', 'as', 'aps', 'kft', 'sro', 'spzoo', 'gesmbh', 'company',
]);

/** Mailboxes of a role, not of a person: never a contact on their own. */
const ROLE_LOCAL_PARTS = new Set([
  'info', 'kontakt', 'contact', 'office', 'mail', 'email', 'post', 'hello', 'hallo', 'hi', 'team', 'service', 'support',
  'help', 'helpdesk', 'sales', 'vertrieb', 'verkauf', 'einkauf', 'purchasing', 'procurement', 'buchhaltung', 'accounting',
  'billing', 'invoice', 'invoices', 'rechnung', 'rechnungen', 'finance', 'finanzen', 'hr', 'jobs', 'karriere', 'career',
  'careers', 'bewerbung', 'recruiting', 'admin', 'administrator', 'webmaster', 'it', 'empfang', 'zentrale', 'reception',
  'marketing', 'presse', 'press', 'news', 'auftrag', 'auftraege', 'order', 'orders', 'bestellung', 'dispo', 'logistik',
  'kundenservice', 'customerservice', 'service-desk', 'servicedesk', 'projekt', 'projects', 'legal', 'datenschutz',
  'privacy', 'compliance', 'security', 'noc', 'ops',
]);

/** "Müller & Söhne GmbH & Co. KG" → "mueller soehne" */
export function normalizeCompanyName(name: string): string {
  const all = foldGerman(name).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const words = all.filter((word) => !LEGAL_FORMS.has(word));
  // "e.K." / "e.V." leave single letters behind
  const meaningful = words.filter((word) => word.length > 1);
  return (meaningful.length ? meaningful : words.length ? words : all).join(' ').slice(0, 200);
}

export function normalizePersonName(first: string, last: string): string {
  return foldGerman(`${first} ${last}`).replace(/[^a-z]+/g, ' ').trim();
}

export function isRoleAddress(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  return ROLE_LOCAL_PARTS.has(local) || ROLE_LOCAL_PARTS.has(local.replace(/[0-9]+$/, ''));
}

export interface ParsedName {
  firstName: string;
  lastName: string;
}

/**
 * Best guess from a mail header: "Muster, Max", "Max Muster | ACME",
 * "Dr. Max Muster (ACME GmbH)"; without a display name from "max.muster@…".
 */
export function parseDisplayName(displayName: string | undefined, email: string): ParsedName {
  let name = (displayName ?? '')
    .replace(/["']/g, '')
    .replace(/\(.*?\)|\[.*?]/g, ' ')
    .split(/\s[|–—-]\s|\s\/\s/)[0]
    .replace(/\b(dr|prof|dipl|ing|mag|herr|frau|mr|mrs|ms)\.?(?=\s)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.includes('@') || name.toLowerCase() === email.toLowerCase()) name = '';

  if (name.includes(',')) {
    const [last, first] = name.split(',').map((part) => part.trim());
    if (first && last) return { firstName: titleCase(first), lastName: titleCase(last) };
  }
  if (name) {
    const words = name.split(' ');
    if (words.length === 1) return { firstName: titleCase(words[0]), lastName: '' };
    return { firstName: titleCase(words.slice(0, -1).join(' ')), lastName: titleCase(words[words.length - 1]) };
  }

  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._]/).filter((p) => /^[a-zäöüß-]{2,}$/i.test(p));
  if (parts.length === 2 && !isRoleAddress(email)) {
    return { firstName: titleCase(parts[0]), lastName: titleCase(parts[1]) };
  }
  return { firstName: '', lastName: '' };
}

/** Only rewrites all-lower or all-upper names; "McDonald" and "van der Berg" stay as written. */
function titleCase(value: string): string {
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return value;
  return value.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function foldGerman(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}
