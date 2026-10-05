import { DeepPartial } from 'typeorm';
import { RecentPerson } from '../crm/crm-lookup.service';
import { User } from '../users/user.entity';
import { Task, TaskKind } from './entities/task.entity';

/** The times in the texts ("10:00 Uhr") are German office hours, whatever zone the server runs in. */
const TIME_ZONE = 'Europe/Berlin';
const DAY_MS = 86_400_000;

/** Whom a story is told about and when */
interface Cast {
  /** First name of the contact */
  first: string;
  company: string;
  /** What the CRM says the company is talking to us about */
  topic: string;
  /** A closing with the assignee's first name below */
  signed: (greeting: string) => string;
  now: Date;
}

/**
 * Made-up occasions, each told about a person from the CRM. The texts go
 * without "sie" and "er": the CRM does not know a person's gender.
 */
const STORIES: ((cast: Cast) => DeepPartial<Task>)[] = [
  ({ first, company, topic, signed, now }) => ({
    kind: TaskKind.Mail,
    title: `${first} eine kurze Follow-up-Mail zum Angebot „${topic}“ schreiben`,
    dealValue: '48.000 €',
    stage: 'Verhandlung',
    lastContactAt: daysAgo(now, 9),
    confidence: 91,
    dueAt: officeTime(now, 0, 10),
    subject: 'Kurz die Laufzeit klären?',
    draft: `Hallo ${first},\n\nich habe gesehen, dass ihr euch unser Angebot zu „${topic}“ diese Woche noch einmal angeschaut habt. Sollen wir die offene Frage zur Vertragslaufzeit am Dienstag in 20 Minuten klären?\n\nIch hätte 10:00 oder 14:30 Uhr frei.\n\n${signed('Beste Grüße')}`,
    summary: `${first} ist aktiv interessiert, aber seit dem letzten Call blockiert eine einzige offene Frage. Ein kurzer, konkreter Terminvorschlag löst das am wahrscheinlichsten.`,
    evidence: [
      { source: 'E-Mail-Tracking', text: 'Angebot seit Montag 3× geöffnet, zuletzt heute um 08:12 Uhr', weight: 92 },
      { source: 'Call-Notiz', text: 'Vertragslaufzeit als einziger offener Punkt genannt', weight: 81 },
      { source: 'Postfach', text: '9 Tage ohne Antwort – sonst dauert es im Schnitt 2 Tage', weight: 70 },
      { source: 'CRM', text: `„${topic}“ ist bei ${company} als Thema hinterlegt`, weight: 46 },
    ],
    approvalNote: 'Bei Freigabe geht die Mail um 10:00 Uhr aus deinem Postfach raus und wird am Deal protokolliert.',
  }),
  ({ first, company, topic, now }) => ({
    kind: TaskKind.Call,
    title: `${first} wegen „${topic}“ zurückrufen`,
    dealValue: '126.000 €',
    stage: 'Angebot',
    lastContactAt: daysAgo(now, 1),
    confidence: 86,
    dueAt: officeTime(now, 0, 15, 30),
    draft: `1. Für die Rückmeldung zum Angebot „${topic}“ bedanken und fragen, was intern dazu besprochen wurde.\n\n2. Den offenen Punkt klären: Wer entscheidet bei ${company} mit, und bis wann?\n\n3. Den Starttermin nennen, den wir noch halten können, wenn der Auftrag in diesem Monat kommt.\n\n4. Ziel: einen festen Termin für die Entscheidung vereinbaren.`,
    summary: `${first} hat gestern um einen Rückruf gebeten. Bei einem offenen Angebot dieser Größe bringt ein Gespräch die Entscheidung deutlich schneller als eine weitere Mail.`,
    evidence: [
      { source: 'Postfach', text: '„Können wir dazu kurz telefonieren?“ – Mail von gestern, 16:42 Uhr', weight: 94 },
      { source: 'CRM', text: `Das Angebot zu „${topic}“ ist seit zwei Wochen offen`, weight: 83 },
      { source: 'Kalender', text: 'Du hast heute zwischen 15:00 und 16:30 Uhr keinen Termin', weight: 61 },
      { source: 'Deine Historie', text: 'Deine letzten zwei Angebote dieser Größe hast du am Telefon gewonnen', weight: 55 },
    ],
    approvalNote: 'Bei Freigabe blockt Cherrypick 15:30 Uhr in deinem Kalender und legt den Leitfaden in die Anrufnotiz.',
  }),
  ({ first, topic, signed, now }) => ({
    kind: TaskKind.Offer,
    title: `${first} das Angebot zu „${topic}“ in zwei Phasen schicken`,
    dealValue: '24.800 €',
    stage: 'Verhandlung',
    lastContactAt: daysAgo(now, 2),
    confidence: 84,
    dueAt: officeTime(now, 1, 9),
    subject: `Angepasstes Angebot „${topic}“`,
    draft: `Hallo ${first},\n\ndanke für dein offenes Feedback zum Budget. Ich habe das Angebot zu „${topic}“ in zwei Phasen aufgeteilt: Phase 1 bleibt im Rahmen für dieses Jahr, Phase 2 könnt ihr im neuen Geschäftsjahr abrufen.\n\nDas angepasste Angebot hängt an, gültig bis Monatsende.\n\n${signed('Viele Grüße')}`,
    summary: `${first} will das Projekt, aber das Budget für dieses Jahr reicht nicht für den vollen Umfang. Ein Angebot in zwei Phasen hält den Auftrag im Haus.`,
    evidence: [
      { source: 'Postfach', text: '„Für dieses Jahr sind maximal 15.000 € frei“', weight: 88 },
      { source: 'Call-Notiz', text: 'Eine zweite Phase im neuen Geschäftsjahr wäre denkbar', weight: 86 },
      { source: 'Vergleichbare Kunden', text: 'Nach einer Aufteilung in Phasen wurde in 2 von 3 Fällen innerhalb von 30 Tagen beauftragt', weight: 58 },
    ],
    approvalNote: 'Bei Freigabe erstellt Cherrypick das Angebot als PDF, hängt es an und sendet morgen um 09:00 Uhr.',
  }),
  ({ first, company, topic, signed, now }) => ({
    kind: TaskKind.Meeting,
    title: `${first} einen Workshop zu „${topic}“ für nächste Woche vorschlagen`,
    dealValue: '62.000 €',
    stage: 'Qualifizierung',
    lastContactAt: daysAgo(now, 3),
    confidence: 73,
    dueAt: officeTime(now, 0, 11, 30),
    subject: `60 Minuten Workshop – ${topic}`,
    draft: `Hallo ${first},\n\ndanke für deine Fragen zu „${topic}“. Am schnellsten klären wir das gemeinsam – ich schlage einen 60-minütigen Workshop vor, gern zusammen mit eurer IT.\n\nVorschläge: nächsten Mittwoch um 10:00 Uhr oder Donnerstag um 16:00 Uhr.\n\n${signed('Viele Grüße')}`,
    summary: `${company} prüft gerade, ob wir für „${topic}“ der richtige Partner sind. Ein gemeinsamer Workshop bringt die Anfrage aus der Evaluierung in die nächste Phase.`,
    evidence: [
      { source: 'E-Mail', text: `${first} hat drei Fragen zum Vorgehen und zum Zeitplan gestellt`, weight: 84 },
      { source: 'Website', text: 'Referenzen 5× besucht, zweimal aus der IT-Abteilung', weight: 77 },
      { source: 'Kalender', text: 'Du hast Mittwoch und Donnerstag noch passende Slots frei', weight: 40 },
    ],
    approvalNote:
      'Bei Freigabe verschickt Cherrypick die Einladung mit zwei Terminvorschlägen und reserviert beide vorläufig in deinem Kalender.',
  }),
  ({ first, company, topic, signed, now }) => ({
    kind: TaskKind.Mail,
    title: `${first} für den Auftrag danken und das Kick-off anstoßen`,
    dealValue: '89.000 €',
    stage: 'Gewonnen',
    lastContactAt: daysAgo(now, 1),
    confidence: 95,
    dueAt: now,
    subject: 'Danke für euer Vertrauen!',
    draft: `Hallo ${first},\n\nvielen Dank für euren Auftrag zu „${topic}“ – wir freuen uns sehr auf die Zusammenarbeit!\n\nDamit wir schnell starten können, würde ich gern ein Kick-off mit unserem Projektteam vereinbaren. Passt dir kommende Woche?\n\n${signed('Herzliche Grüße')}`,
    summary: `${company} hat gestern unterschrieben. Projekte mit einem Kick-off in den ersten 48 Stunden starten schneller und laufen ruhiger.`,
    evidence: [
      { source: 'E-Signatur', text: 'Auftrag gestern um 17:40 Uhr unterschrieben', weight: 96 },
      { source: 'CRM', text: 'Noch kein Kick-off-Termin angelegt', weight: 80 },
      { source: 'Muster', text: 'Projekte mit Kick-off innerhalb von 2 Tagen sind im Schnitt 3 Wochen früher fertig', weight: 62 },
    ],
    approvalNote: 'Bei Freigabe geht die Mail sofort raus, das Projektteam wird in Kopie gesetzt.',
  }),
  ({ first, company, topic, now }) => ({
    kind: TaskKind.Call,
    title: `${first} nach vier Monaten Funkstille wieder anrufen`,
    dealValue: '35.000 €',
    stage: 'Pausiert',
    lastContactAt: daysAgo(now, 125),
    confidence: 66,
    dueAt: officeTime(now, 1, 8),
    draft: `1. Kurz anknüpfen: Vor vier Monaten hat ${company} „${topic}“ wegen der Budgetrunde verschoben.\n\n2. Nachfragen, ob die Planung für das nächste Jahr schon läuft.\n\n3. Die neue Referenz aus derselben Branche erwähnen – danach wurde damals gefragt.\n\n4. Ziel: Okay, ein aktualisiertes Angebot zu schicken.`,
    summary: `${company} hat „${topic}“ damals nur aufgeschoben, nicht abgesagt. Die Budgetrunde ist durch, und die Referenz, die gefehlt hat, gibt es jetzt.`,
    evidence: [
      { source: 'CRM-Notiz', text: '„Nach der Budgetrunde gern wieder melden“', weight: 82 },
      { source: 'Wissensbasis', text: 'Neue Referenz aus derselben Branche ist seit letztem Monat freigegeben', weight: 74 },
      { source: 'Muster', text: 'Meist früh morgens vor 8:30 Uhr erreichbar', weight: 44 },
    ],
    approvalNote: 'Bei Freigabe legt Cherrypick den Anruf für morgen 08:00 Uhr in deinen Kalender.',
  }),
  ({ first, topic, signed, now }) => ({
    kind: TaskKind.Offer,
    title: `${first} das zugesagte Angebot zu „${topic}“ schicken`,
    dealValue: '22.800 €',
    stage: 'Angebot',
    lastContactAt: daysAgo(now, 6),
    confidence: 81,
    dueAt: officeTime(now, 0, 14),
    subject: `Unser Angebot zu „${topic}“`,
    draft: `Hallo ${first},\n\nwie besprochen schicke ich dir unser Angebot zu „${topic}“. Ich habe den Umfang aus unserem Gespräch übernommen und die Einrichtung kostenfrei eingerechnet.\n\nMeld dich gern, wenn du Fragen hast.\n\n${signed('Beste Grüße')}`,
    summary: `${first} hat im letzten Gespräch um ein Angebot gebeten, das noch nicht verschickt wurde. Jeder weitere Tag Verzögerung kostet Abschlusschance.`,
    evidence: [
      { source: 'Call-Notiz', text: `${first} hat ausdrücklich um ein Angebot bis Ende der Woche gebeten`, weight: 93 },
      { source: 'CRM', text: 'Aufgabe „Angebot erstellen“ ist seit 6 Tagen offen', weight: 78 },
      { source: 'Wissensbasis', text: `Leistungsbeschreibung zu „${topic}“ liegt vor`, weight: 57 },
    ],
    approvalNote: 'Bei Freigabe erstellt Cherrypick das Angebot als PDF und sendet es heute um 14:00 Uhr.',
  }),
];

/** How many people `demoTasks` has a story for */
export const DEMO_TASK_COUNT = STORIES.length;

/**
 * Demo queue for one sales person: one task per person, as far as the stories
 * reach. Contact and company are the ones in the CRM, so the card opens them;
 * occasion, deal and evidence are made up. Due times and last contacts are
 * relative to `now`, the mails are signed with the assignee's first name.
 */
export function demoTasks(assignee: Pick<User, 'id' | 'firstName'>, people: RecentPerson[], now = new Date()): DeepPartial<Task>[] {
  const name = assignee.firstName.trim();
  const signed = (greeting: string) => (name ? `${greeting}\n${name}` : greeting);

  return people.slice(0, STORIES.length).map((person, i) => ({
    ...STORIES[i]({ first: person.firstName, company: person.company.name, topic: person.company.topics[0], signed, now }),
    contactName: person.fullName,
    contactRole: person.jobTitle,
    companyName: person.company.name,
    assigneeId: assignee.id,
  }));
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** `hour:minute` German time, `dayOffset` days from today. */
function officeTime(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'longOffset',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  // "GMT+02:00" → "+02:00"
  const offset = part('timeZoneName').replace('GMT', '') || '+00:00';
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const today = new Date(`${part('year')}-${part('month')}-${part('day')}T${time}${offset}`);
  return new Date(today.getTime() + dayOffset * DAY_MS);
}
