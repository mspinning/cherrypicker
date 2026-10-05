export type Relationship = 'customer' | 'prospect';

export interface CompanyListItem {
  id: string;
  name: string;
  relationship: Relationship;
  domains: string[];
  industry: string | null;
  city: string | null;
  contactCount: number;
  lastContactAt: string | null;
  createdAt: string;
}

export interface ContactListItem {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  /** null for people nobody has an address of yet */
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
  mobile: string | null;
  company: { id: string; name: string } | null;
  lastContactAt: string | null;
}

export interface Activity {
  id: string;
  direction: 'in' | 'out';
  subject: string;
  preview: string;
  occurredAt: string;
  webLink: string | null;
  contact: { id: string; fullName: string } | null;
}

/** What a CRM user reported about a conversation, e.g. in a call with the assistant; everybody sees it */
export interface Note {
  id: string;
  title: string;
  text: string;
  occurredAt: string;
  /** null if the account no longer exists */
  author: string | null;
  contact: { id: string; fullName: string } | null;
}

/** A CRM user who has mail contact with the company */
export interface KnownBy {
  userId: string;
  name: string;
  mails: number;
  lastContactAt: string | null;
}

export interface CompanyDetail {
  id: string;
  name: string;
  relationship: Relationship;
  source: 'mail_import' | 'manual';
  domains: string[];
  website: string | null;
  industry: string | null;
  description: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  summary: string | null;
  topics: string[];
  firstContactAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  contacts: ContactListItem[];
  notes: Note[];
  /** Only mails of the own mailbox */
  activities: Activity[];
  knownBy: KnownBy[];
}

export interface ContactDetail extends ContactListItem {
  otherEmails: string[];
  department: string | null;
  linkedinUrl: string | null;
  source: 'mail_import' | 'manual';
  firstContactAt: string | null;
  createdAt: string;
  notes: Note[];
  activities: Activity[];
}

export interface CrmSummary {
  companies: number;
  customers: number;
  prospects: number;
  contacts: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  customer: 'Kunde',
  prospect: 'Interessent',
};
