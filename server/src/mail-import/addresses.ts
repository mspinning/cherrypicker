/**
 * Cheap decisions about mail addresses, before anything goes to the LLM:
 * which domain an address belongs to, freemail providers, automated senders
 * and services everybody uses but nobody sells to.
 */

/** Second-level registries where a company domain has three labels (acme.co.uk) */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk',
  'co.at', 'or.at', 'ac.at', 'gv.at',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'co.jp', 'co.kr', 'co.in', 'com.br', 'com.mx', 'com.ar', 'com.tr',
  'com.cn', 'com.hk', 'com.sg', 'com.pl', 'com.es', 'com.pt', 'co.il',
]);

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com', 'web.de', 't-online.de', 'freenet.de',
  'yahoo.com', 'yahoo.de', 'ymail.com', 'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.de', 'posteo.de', 'posteo.net', 'mailbox.org',
  'protonmail.com', 'proton.me', 'pm.me', 'arcor.de', 'online.de', 'vodafone.de', 'kabelmail.de', 'mail.de', 'mail.com',
  'email.de', 'tutanota.com', 'tutanota.de', 'tuta.io', 'yandex.com', 'yandex.ru', 'zoho.com', 'bluewin.ch', 'gmx.li',
]);

/**
 * Tools, platforms and suppliers: they write to us, we do not sell to them.
 * The LLM catches everything else, this list just saves the calls.
 */
const KNOWN_SERVICES = new Set([
  // Developer and AI platforms
  'github.com', 'gitlab.com', 'bitbucket.org', 'atlassian.com', 'atlassian.net', 'openai.com', 'anthropic.com',
  'mistral.ai', 'huggingface.co', 'npmjs.com', 'docker.com', 'jetbrains.com', 'sentry.io', 'vercel.com', 'netlify.com',
  'heroku.com', 'cloudflare.com', 'digitalocean.com', 'hetzner.com', 'hetzner.de', 'ionos.de', 'ionos.com', 'strato.de',
  'godaddy.com', 'namecheap.com', 'datadoghq.com', 'postman.com', 'stackoverflow.email', 'figma.com', 'canva.com',
  'miro.com', 'notion.so', 'mail.notion.so', 'slack.com', 'zoom.us', 'calendly.com', 'typeform.com', 'airtable.com',
  'asana.com', 'trello.com', 'monday.com', 'clickup.com', 'linear.app', 'loom.com', 'dropbox.com', 'box.com',
  'docusign.net', 'docusign.com', 'adobe.com', 'adobesign.com', 'hubspot.com', 'hubspotemail.net', 'salesforce.com',
  'pipedrive.com', 'mailchimp.com', 'mcsv.net', 'sendgrid.net', 'sendinblue.com', 'brevo.com', 'intercom.io',
  'intercom-mail.com', 'zendesk.com', 'freshdesk.com', 'stripe.com', 'paypal.com', 'paypal.de', 'klarna.com',
  'wise.com', 'revolut.com', 'qonto.com', 'n26.com', 'datev.de', 'lexoffice.de', 'sevdesk.de', 'personio.de',
  'personio.com',
  // Big tech accounts and notifications
  'google.com', 'accounts.google.com', 'youtube.com', 'microsoft.com', 'microsoftonline.com', 'office.com',
  'office365.com', 'azure.com', 'apple.com', 'amazon.com', 'amazon.de', 'amazonaws.com', 'aws.amazon.com',
  'linkedin.com', 'xing.com', 'facebookmail.com', 'meta.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com',
  'medium.com', 'substack.com', 'eventbrite.com', 'meetup.com',
  // Travel and everyday suppliers
  'booking.com', 'airbnb.com', 'uber.com', 'lufthansa.com', 'bahn.de', 'deutschebahn.com', 'sixt.de', 'hotel.de',
]);

/** Local parts of machines, not people */
const AUTOMATED_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|bounces?|notifications?|notify|newsletters?|alerts?|automated|auto[-_.]?(reply|confirm)|system|daemon|calendar[-_.]?notification|msonlineservicesteam|invitations?|updates?|digest)([-_.+].*)?$/i;
const AUTOMATED_ANYWHERE = /(^|[-_.+])(no-?reply|noreply|donotreply|bounce)([-_.+]|$)/i;

export function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** "mail.eu.acme.de" → "acme.de", "shop.acme.co.uk" → "acme.co.uk" */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

export function isFreemail(domain: string): boolean {
  return FREEMAIL.has(domain) || FREEMAIL.has(registrableDomain(domain));
}

export function isKnownService(domain: string): boolean {
  return KNOWN_SERVICES.has(domain) || KNOWN_SERVICES.has(registrableDomain(domain));
}

export function isAutomatedAddress(email: string): boolean {
  const local = email.slice(0, email.lastIndexOf('@'));
  return AUTOMATED_LOCAL.test(local) || AUTOMATED_ANYWHERE.test(local);
}

const EMAIL = /^[^\s@"<>]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Lower-cased address, or null for X.500 paths and other non-SMTP values Exchange puts into headers. */
export function cleanAddress(raw: string | undefined | null): string | null {
  const address = (raw ?? '').trim().toLowerCase();
  return EMAIL.test(address) && address.length <= 320 ? address : null;
}
