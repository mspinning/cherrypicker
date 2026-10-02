/** Steps of a check, in this order ('detect' happens in the CRM, the rest in the extension). */
export const LINKEDIN_STEPS = ['detect', 'open', 'session', 'read'] as const;
export type LinkedInStep = (typeof LINKEDIN_STEPS)[number];

export interface LinkedInConversation {
  name: string;
  snippet: string;
  /** As LinkedIn shows it ("11:42", "Mo", "28. Sep.") */
  time: string;
  unread: boolean;
  unreadCount: number;
  /** Link to the conversation on linkedin.com, if the list had one */
  url: string | null;
}

export interface LinkedInInbox {
  /** Unread conversations, including those further down than the list we read */
  unread: number;
  conversations: LinkedInConversation[];
  checkedAt: string;
}

export type LinkedInRun =
  | { state: 'idle' }
  | { state: 'running'; step: LinkedInStep }
  /** No extension answered on this page */
  | { state: 'missing' }
  /** The browser has no LinkedIn session */
  | { state: 'signed-out' }
  /** LinkedIn wants a security check before it shows anything */
  | { state: 'challenge' }
  | { state: 'failed'; message: string }
  | { state: 'done' };

export const LINKEDIN_URL = 'https://www.linkedin.com/';
