import { PartyEvidence } from '../crm/crm-merge.service';
import { GraphAddress, GraphMessage } from '../integrations/microsoft/graph-client.service';
import { cleanAddress, domainOf, isAutomatedAddress, isFreemail, registrableDomain } from './addresses';

/** Kept per counterpart: enough for the timeline and to pick mails for the LLM */
const MAX_MESSAGES = 150;
const MAX_PARTICIPANTS = 50;
const PREVIEW_CHARS = 300;

type Participant = PartyEvidence['participants'][number];
type Message = PartyEvidence['messages'][number];

export interface ScanContext {
  /** All addresses of the mailbox owner */
  ownAddresses: Set<string>;
  /** Registrable domains of the own group (colleagues are never customers) */
  internalDomains: Set<string>;
}

/** All mails with one counterpart. */
export interface MailGroup {
  key: string;
  domain: string | null;
  label: string;
  participants: Map<string, Participant>;
  messages: Message[];
  messageCount: number;
  inbound: number;
  outbound: number;
  /** Inbound mails Outlook sorted into "Other" (newsletters, notifications) */
  otherInbound: number;
  firstAt: string;
  lastAt: string;
}

/**
 * Groups mail headers by counterpart. A mail from the outside counts for the
 * sender's group (and for other external people on it); a mail from us or a
 * colleague counts for every external recipient's group.
 */
export class MailAggregator {
  private readonly groups = new Map<string, MailGroup>();

  constructor(private readonly ctx: ScanContext) {}

  /** Returns whether the mail involved anyone outside the group. */
  add(msg: GraphMessage): boolean {
    const from = cleanAddress(msg.from?.emailAddress?.address);
    const at = msg.receivedDateTime ?? msg.sentDateTime;
    if (!from || !at) return false;

    const fromUs = this.isOurs(from);
    const recipients = [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])]
      .map((r) => ({ address: cleanAddress(r.emailAddress?.address), name: nameOf(r) }))
      .filter((r): r is { address: string; name: string } => r.address !== null);

    const people = new Map<string, { address: string; name: string; sender: boolean }>();
    for (const person of [
      ...(fromUs ? [] : [{ address: from, name: nameOf(msg.from), sender: true }]),
      ...recipients.map((r) => ({ ...r, sender: false })),
    ]) {
      // The same address in to and cc counts once
      if (!people.has(person.address) && !this.isOurs(person.address) && !isAutomatedAddress(person.address)) {
        people.set(person.address, person);
      }
    }
    const external = [...people.values()];
    if (!external.length) return false;

    const message: Message = {
      id: msg.id,
      conversationId: msg.conversationId ?? null,
      subject: (msg.subject ?? '').slice(0, 500),
      preview: (msg.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS),
      at,
      direction: fromUs ? 'out' : 'in',
      from,
      to: recipients.map((r) => r.address),
      webLink: msg.webLink ?? null,
    };

    const touched = new Set<MailGroup>();
    for (const person of external) {
      const group = this.groupOf(person.address, at);
      const participant = group.participants.get(person.address) ?? {
        email: person.address,
        name: '',
        inbound: 0,
        outbound: 0,
        firstAt: at,
        lastAt: at,
      };
      // The most complete display name wins; the sender's own header is the most reliable
      if (person.name.length > participant.name.length || (person.sender && person.name)) participant.name = person.name;
      if (person.sender) participant.inbound++;
      if (fromUs) participant.outbound++;
      if (at < participant.firstAt) participant.firstAt = at;
      if (at > participant.lastAt) participant.lastAt = at;
      group.participants.set(person.address, participant);
      touched.add(group);
    }

    for (const group of touched) {
      group.messageCount++;
      if (fromUs) group.outbound++;
      else {
        group.inbound++;
        if (msg.inferenceClassification === 'other') group.otherInbound++;
      }
      if (at < group.firstAt) group.firstAt = at;
      if (at > group.lastAt) group.lastAt = at;
      // Mails arrive newest first: the cap keeps the most recent ones
      if (group.messages.length < MAX_MESSAGES) group.messages.push(message);
    }
    return true;
  }

  /** Participants sorted by how much they write, capped. */
  result(): MailGroup[] {
    return [...this.groups.values()].map((group) => ({
      ...group,
      participants: new Map(
        [...group.participants.values()]
          .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound))
          .slice(0, MAX_PARTICIPANTS)
          .map((p) => [p.email, p]),
      ),
    }));
  }

  private groupOf(address: string, at: string): MailGroup {
    const { key, domain } = partyOf(address);
    let group = this.groups.get(key);
    if (!group) {
      group = {
        key,
        domain,
        label: domain ?? address,
        participants: new Map(),
        messages: [],
        messageCount: 0,
        inbound: 0,
        outbound: 0,
        otherInbound: 0,
        firstAt: at,
        lastAt: at,
      };
      this.groups.set(key, group);
    }
    return group;
  }

  private isOurs(address: string): boolean {
    return this.ctx.ownAddresses.has(address) || this.ctx.internalDomains.has(registrableDomain(domainOf(address)));
  }
}

/**
 * The counterpart an address belongs to: its business domain, or the address
 * itself for freemail. The key is the one of crm_party_decisions.
 */
export function partyOf(address: string): { key: string; domain: string | null } {
  const domain = registrableDomain(domainOf(address));
  return isFreemail(domain) ? { key: `email:${address}`, domain: null } : { key: `domain:${domain}`, domain };
}

function nameOf(address: GraphAddress | undefined): string {
  return (address?.emailAddress?.name ?? '').trim().slice(0, 200);
}
