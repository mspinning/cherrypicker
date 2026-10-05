import { pastelOf } from '../../core/auth/user-display';
import { Task, TaskKind } from '../../core/tasks/task.models';
import { formatAgo, formatDay, formatTime } from '../../shared/format';
import { Suggestion } from './suggestion.model';

const KINDS: Record<TaskKind, { label: string; draftLabel: string; scheduled: (firstName: string) => string }> = {
  mail: { label: 'E-Mail', draftLabel: 'E-Mail-Entwurf', scheduled: (name) => `Mail an ${name} geplant` },
  call: { label: 'Anruf', draftLabel: 'Gesprächsleitfaden', scheduled: (name) => `Anruf mit ${name} eingeplant` },
  offer: { label: 'Angebot', draftLabel: 'E-Mail mit Angebot', scheduled: (name) => `Angebot an ${name} geplant` },
  meeting: { label: 'Termin', draftLabel: 'Termineinladung', scheduled: (name) => `Einladung an ${name} geplant` },
};

/** The card for a task, with labels and relative times as of `now`. */
export function toSuggestion(task: Task, now = new Date()): Suggestion {
  const kind = KINDS[task.kind];
  const due = new Date(task.dueAt);
  // 0 = today, 1 = tomorrow; -1 = due now or overdue
  const dueInDays = due <= now ? -1 : dayDistance(now, due);
  const time = formatTime(task.dueAt);

  return {
    id: task.id,
    kind: task.kind,
    kindLabel: kind.label,
    title: task.title,
    contact: {
      name: task.contactName,
      role: task.contactRole ?? '',
      company: task.companyName ?? 'Privat',
      initials: initialsOf(task.contactName),
      avatarColor: pastelOf(task.contactName),
    },
    dealValue: task.dealValue ?? '–',
    stage: task.stage ?? '–',
    lastContact: formatAgo(task.lastContactAt),
    confidence: task.confidence,
    bestTime:
      dueInDays < 0
        ? 'Jetzt'
        : dueInDays === 0
          ? `Heute, ${time} Uhr`
          : dueInDays === 1
            ? `Morgen, ${time} Uhr`
            : `${formatDay(task.dueAt)}, ${time} Uhr`,
    draftLabel: kind.draftLabel,
    subject: task.subject ? `Betreff: ${task.subject}` : undefined,
    draft: task.draft,
    summary: task.summary,
    evidence: task.evidence,
    onApprove: task.approvalNote,
    scheduledLabel: kind.scheduled(task.contactName.split(' ')[0]),
    scheduledTime:
      dueInDays < 0
        ? 'jetzt'
        : dueInDays === 0
          ? `${time} Uhr`
          : dueInDays === 1
            ? `morgen ${time}`
            : `${formatDay(task.dueAt)} ${time}`,
  };
}

/** Whole local calendar days from `from` to `to`. */
function dayDistance(from: Date, to: Date): number {
  const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((midnight(to) - midnight(from)) / 86_400_000);
}

/** "Lena Hoffmann" → "LH" */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}
