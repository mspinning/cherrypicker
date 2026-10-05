import { DeepPartial } from 'typeorm';
import { User } from '../users/user.entity';
import { Task, TaskKind } from './entities/task.entity';

/** The times in the texts ("10:00 Uhr") are German office hours, whatever zone the server runs in. */
const TIME_ZONE = 'Europe/Berlin';
const DAY_MS = 86_400_000;

/**
 * Demo queue for one sales person, until real suggestions are generated from
 * the mailbox. Due times and last contacts are relative to `now`, the mails
 * are signed with the assignee's first name.
 */
export function demoTasks(assignee: Pick<User, 'id' | 'firstName'>, now = new Date()): DeepPartial<Task>[] {
  const name = assignee.firstName.trim();
  const signed = (greeting: string) => (name ? `${greeting}\n${name}` : greeting);
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const tasks: DeepPartial<Task>[] = [
    {
      kind: TaskKind.Mail,
      title: 'Lena eine kurze Follow-up-Mail zum Angebot schreiben',
      contactName: 'Lena Hoffmann',
      contactRole: 'Head of Operations',
      companyName: 'Nordwerk Logistik',
      dealValue: '48.000 €',
      stage: 'Verhandlung',
      lastContactAt: daysAgo(9),
      confidence: 91,
      dueAt: officeTime(now, 0, 10),
      subject: 'Kurz die Laufzeit klären?',
      draft: `Hallo Lena,\n\nich habe gesehen, dass ihr euch unser Angebot diese Woche noch einmal angeschaut habt. Sollen wir die offene Frage zur Vertragslaufzeit am Dienstag in 20 Minuten klären?\n\nIch hätte 10:00 oder 14:30 Uhr frei.\n\n${signed('Beste Grüße')}`,
      summary:
        'Lena ist aktiv interessiert, aber seit dem letzten Call blockiert eine einzige offene Frage. Ein kurzer, konkreter Terminvorschlag löst das am wahrscheinlichsten.',
      evidence: [
        { source: 'E-Mail-Tracking', text: 'Angebot seit Montag 3× geöffnet, zuletzt heute um 08:12 Uhr', weight: 92 },
        { source: 'Call-Notiz', text: 'Vertragslaufzeit als einziger offener Punkt genannt', weight: 81 },
        { source: 'Postfach', text: '9 Tage ohne Antwort – sonst antwortet sie im Schnitt nach 2 Tagen', weight: 70 },
        { source: 'Muster', text: 'Antwortet am häufigsten Di–Do zwischen 9 und 11 Uhr', weight: 46 },
      ],
      approvalNote: 'Bei Freigabe geht die Mail um 10:00 Uhr aus deinem Postfach raus und wird am Deal protokolliert.',
    },
    {
      kind: TaskKind.Call,
      title: 'Tobias anrufen, bevor der Vertrag ausläuft',
      contactName: 'Tobias Brandt',
      contactRole: 'CFO',
      companyName: 'Kessler & Söhne',
      dealValue: '126.000 €',
      stage: 'Verlängerung',
      lastContactAt: daysAgo(35),
      confidence: 78,
      dueAt: officeTime(now, 0, 15, 30),
      draft:
        '1. Danke für drei Jahre Zusammenarbeit – kurz auf die Erfolge im Einkauf verweisen.\n\n2. Nachfragen, wie der neue Standort in Leipzig anläuft und wer dort das Team führt.\n\n3. Rückgang der Nutzung offen ansprechen: Gibt es etwas, das fehlt?\n\n4. Ziel: Termin für das Verlängerungsgespräch noch in dieser Woche fixieren.',
      summary:
        'Der Vertrag läuft in drei Wochen aus und die Nutzung sinkt. Bei diesem Muster rettet ein persönlicher Anruf deutlich öfter die Verlängerung als eine Mail.',
      evidence: [
        { source: 'Vertrag', text: 'Laufzeit endet in 21 Tagen', weight: 94 },
        { source: 'Produktnutzung', text: 'Aktive Nutzer im Team seit sechs Wochen um 18 % gesunken', weight: 83 },
        { source: 'News', text: 'Pressemeldung: Kessler & Söhne eröffnet einen Standort in Leipzig', weight: 61 },
        { source: 'Deine Historie', text: 'Deine letzten zwei Verlängerungen mit Nutzungsrückgang hast du per Telefon gewonnen', weight: 55 },
      ],
      approvalNote: 'Bei Freigabe blockt Cherrypick 15:30 Uhr in deinem Kalender und legt den Leitfaden in die Anrufnotiz.',
    },
    {
      kind: TaskKind.Offer,
      title: 'Aylin das Upgrade auf „Team Pro“ anbieten',
      contactName: 'Aylin Demir',
      contactRole: 'Gründerin',
      companyName: 'Studio Parallax',
      dealValue: '14.400 € / Jahr',
      stage: 'Bestandskunde',
      lastContactAt: daysAgo(2),
      confidence: 84,
      dueAt: officeTime(now, 1, 9),
      subject: 'Mehr Platz für euer Team',
      draft: `Hallo Aylin,\n\neuer Team ist gewachsen – ihr nutzt inzwischen 4 von 5 Plätzen. Mit „Team Pro“ bekommt ihr unbegrenzte Plätze und genau die Freigabe-Workflows, nach denen du im Support gefragt hast.\n\nIch habe dir ein Angebot angehängt, gültig bis Monatsende.\n\n${signed('Viele Grüße')}`,
      summary:
        'Studio Parallax stößt an die Grenze des aktuellen Plans und hat selbst nach einer Pro-Funktion gefragt. Das Timing für ein Upgrade ist ideal.',
      evidence: [
        { source: 'Lizenzen', text: '4 von 5 Plätzen belegt, zwei neue Einladungen ausstehend', weight: 88 },
        { source: 'Support-Ticket', text: 'Frage nach Freigabe-Workflows – nur in „Team Pro“ enthalten', weight: 86 },
        { source: 'Vergleichbare Kunden', text: 'Kunden mit diesem Muster haben in 2 von 3 Fällen innerhalb von 30 Tagen upgegradet', weight: 58 },
      ],
      approvalNote: 'Bei Freigabe erstellt Cherrypick das Angebot als PDF, hängt es an und sendet morgen um 09:00 Uhr.',
    },
    {
      kind: TaskKind.Meeting,
      title: 'Jonas eine Live-Demo für nächste Woche vorschlagen',
      contactName: 'Jonas Weber',
      contactRole: 'CTO',
      companyName: 'Flux Robotics',
      dealValue: '62.000 €',
      stage: 'Qualifizierung',
      lastContactAt: daysAgo(3),
      confidence: 73,
      dueAt: officeTime(now, 0, 11, 30),
      subject: '30 Minuten Demo – API & Integrationen',
      draft: `Hallo Jonas,\n\ndanke für deine Fragen zur API. Am schnellsten lässt sich das live zeigen – ich schlage eine 30-minütige Demo vor, gern zusammen mit eurem Lead Developer.\n\nVorschläge: nächsten Mittwoch um 10:00 Uhr oder Donnerstag um 16:00 Uhr.\n\n${signed('Viele Grüße')}`,
      summary:
        'Jonas prüft gerade technisch, ob ihr zusammenpasst. Eine Live-Demo mit seinem Entwickler bringt den Deal aus der Evaluierung in die nächste Phase.',
      evidence: [
        { source: 'Website', text: 'API-Dokumentation 5× besucht, zweimal gemeinsam mit einem Kollegen', weight: 84 },
        { source: 'E-Mail', text: 'Hat drei technische Fragen zu Webhooks gestellt', weight: 77 },
        { source: 'Kalender', text: 'Du hast Mittwoch und Donnerstag noch passende Slots frei', weight: 40 },
      ],
      approvalNote:
        'Bei Freigabe verschickt Cherrypick die Einladung mit zwei Terminvorschlägen und reserviert beide vorläufig in deinem Kalender.',
    },
    {
      kind: TaskKind.Mail,
      title: 'Sarah zum Abschluss gratulieren und das Onboarding anstoßen',
      contactName: 'Sarah Klein',
      contactRole: 'Leitung Einkauf',
      companyName: 'Brightline Medical',
      dealValue: '89.000 €',
      stage: 'Gewonnen',
      lastContactAt: daysAgo(1),
      confidence: 95,
      dueAt: now,
      subject: 'Willkommen an Bord!',
      draft: `Hallo Sarah,\n\nvielen Dank für euer Vertrauen – wir freuen uns sehr auf die Zusammenarbeit!\n\nDamit euer Team schnell startklar ist, würde ich gern ein Kick-off mit unserer Onboarding-Managerin Julia vereinbaren. Passt dir kommende Woche?\n\n${signed('Herzliche Grüße')}`,
      summary:
        'Der Vertrag wurde gestern unterschrieben. Wer in den ersten 48 Stunden ein Kick-off terminiert, startet schneller und bleibt länger Kunde.',
      evidence: [
        { source: 'E-Signatur', text: 'Vertrag gestern um 17:40 Uhr unterschrieben', weight: 96 },
        { source: 'Onboarding', text: 'Noch kein Kick-off-Termin angelegt', weight: 80 },
        { source: 'Muster', text: 'Kunden mit Kick-off innerhalb von 2 Tagen sind im Schnitt 3 Wochen früher produktiv', weight: 62 },
      ],
      approvalNote: 'Bei Freigabe geht die Mail sofort raus, Julia wird in Kopie gesetzt.',
    },
    {
      kind: TaskKind.Call,
      title: 'Mehmet nach vier Monaten Funkstille wieder anrufen',
      contactName: 'Mehmet Yılmaz',
      contactRole: 'Geschäftsführer',
      companyName: 'Yılmaz Bau',
      dealValue: '35.000 €',
      stage: 'Pausiert',
      lastContactAt: daysAgo(125),
      confidence: 66,
      dueAt: officeTime(now, 1, 8),
      draft:
        '1. Kurz anknüpfen: Vor vier Monaten habt ihr das Projekt wegen der Bausaison verschoben.\n\n2. Nachfragen, ob die Planung für die nächste Saison schon läuft.\n\n3. Das neue Modul für Baustellen-Dokumentation erwähnen – das hatte er sich damals gewünscht.\n\n4. Ziel: Okay, ein aktualisiertes Angebot zu schicken.',
      summary:
        'Mehmet hat das Projekt damals nur aufgeschoben, nicht abgesagt. Die Bausaison endet, und die Funktion, die ihm gefehlt hat, gibt es jetzt.',
      evidence: [
        { source: 'CRM-Notiz', text: '„Nach der Saison gern wieder melden“', weight: 82 },
        { source: 'Produkt-Update', text: 'Modul Baustellen-Dokumentation ist inzwischen verfügbar', weight: 74 },
        { source: 'Muster', text: 'Meist früh morgens vor 8:30 Uhr erreichbar', weight: 44 },
      ],
      approvalNote: 'Bei Freigabe legt Cherrypick den Anruf für morgen 08:00 Uhr in deinen Kalender.',
    },
    {
      kind: TaskKind.Offer,
      title: 'Clara das Angebot für den zweiten Standort schicken',
      contactName: 'Clara Neumann',
      contactRole: 'Operations Managerin',
      companyName: 'Hafenküche Gruppe',
      dealValue: '22.800 €',
      stage: 'Expansion',
      lastContactAt: daysAgo(6),
      confidence: 81,
      dueAt: officeTime(now, 0, 14),
      subject: 'Angebot für den Standort Altona',
      draft: `Hallo Clara,\n\nwie besprochen schicke ich dir das Angebot für euren neuen Standort in Altona. Ich habe die Konditionen eures ersten Standorts übernommen und die Einrichtung kostenfrei eingerechnet.\n\nMeld dich gern, wenn du Fragen hast.\n\n${signed('Beste Grüße')}`,
      summary:
        'Clara hat im letzten Gespräch um ein Angebot gebeten, das noch nicht verschickt wurde. Jeder weitere Tag Verzögerung kostet Abschlusschance.',
      evidence: [
        { source: 'Call-Notiz', text: 'Clara hat ausdrücklich um ein Angebot bis Ende der Woche gebeten', weight: 93 },
        { source: 'CRM', text: 'Aufgabe „Angebot erstellen“ ist seit 6 Tagen offen', weight: 78 },
        { source: 'Bestandskunde', text: 'Der erste Standort nutzt das Produkt täglich, ohne Support-Tickets', weight: 57 },
      ],
      approvalNote: 'Bei Freigabe erstellt Cherrypick das Angebot als PDF und sendet es heute um 14:00 Uhr.',
    },
  ];

  return tasks.map((task) => ({ ...task, assigneeId: assignee.id }));
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
