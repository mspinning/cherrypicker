import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Task } from '../../core/tasks/task.models';
import { TasksApi } from '../../core/tasks/tasks-api.service';
import { Viewport } from '../../core/viewport';
import { Decision, QueueItem, QueueStatus, Suggestion, Toast, Verdict } from './suggestion.model';
import { toSuggestion } from './to-suggestion';

/** Drag distance (px) that counts as a decision. */
const SWIPE_THRESHOLD = { desktop: 120, mobile: 90 };
/** How far the card flies out when it leaves (px). */
const FLY_DISTANCE = { desktop: 1100, mobile: 560 };
/** Must match the card's leave transition. */
const LEAVE_MS = 380;
const TOAST_MS = 4500;

const STATUS_LABEL: Record<QueueStatus, string> = {
  approved: 'Freigegeben',
  edited: 'Bearbeitet',
  rejected: 'Verworfen',
  current: 'Jetzt',
  waiting: 'Wartet',
};

export type LoadState = 'loading' | 'ready' | 'failed';

/**
 * State of the "Heute" screen: the signed-in user's tasks as a card stack,
 * the swipe gesture, draft editing and today's decisions. Decisions show
 * right away and are saved on the server in the background. Every task opens
 * from the list: an open one comes to the top of the stack, a decided one is
 * shown to read only. An open task can be sent back to the AI with a hint,
 * which reworks it.
 */
@Injectable({ providedIn: 'root' })
export class TodayStore {
  private readonly api = inject(TasksApi);
  private readonly auth = inject(AuthService);
  private readonly viewport = inject(Viewport);

  readonly loadState = signal<LoadState>('loading');
  /**
   * As loaded: today's decided tasks first, in the order they were decided, then the open ones.
   * A task decided here keeps its place.
   */
  readonly suggestions = signal<Suggestion[]>([]);
  /** The open task on top of the stack; null or decided meanwhile: the first open one, see `current` */
  private readonly currentId = signal<string | null>(null);
  readonly decisions = signal<Decision[]>([]);
  readonly toast = signal<Toast | null>(null);

  // Gesture / transition state
  readonly dx = signal(0);
  readonly dragging = signal(false);
  readonly leaving = signal<Verdict | null>(null);
  /** true for one frame after a card change so nothing animates back into place */
  readonly snapping = signal(false);

  // Editing / mobile "why" panel
  readonly showReason = signal(false);
  private readonly drafts = signal<Record<string, string>>({});
  /** The open tasks whose draft is being edited, each with the text to go back to on cancel */
  private readonly editBackups = signal<Record<string, string>>({});

  // Hints to the AI
  /** What the user is telling the AI about a task; kept until the reworked task is there */
  private readonly hints = signal<Record<string, string>>({});
  /** Why the last hint on a task did not get through */
  private readonly hintErrors = signal<Record<string, string>>({});
  /** The tasks the AI is reworking right now */
  private readonly revisingIds = signal<ReadonlySet<string>>(new Set());

  /** The decided task that is open to read, see `view` */
  private readonly viewingId = signal<string | null>(null);
  /** The task that follows the card flying out */
  private afterLeave: string | null = null;

  private leaveTimer?: ReturnType<typeof setTimeout>;
  private snapTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  /** Requests run one after another: an undo never overtakes its decision, a reload sees every decision. */
  private requests: Promise<unknown> = Promise.resolve();
  /** Only the newest load may fill the screen. */
  private loadId = 0;

  constructor() {
    // The tasks belong to the signed-in user and never outlive the session
    effect(() => {
      if (!this.auth.session()) untracked(() => this.clear());
    });
  }

  readonly threshold = computed(() => (this.viewport.isDesktop() ? SWIPE_THRESHOLD.desktop : SWIPE_THRESHOLD.mobile));
  readonly flyDistance = computed(() => (this.viewport.isDesktop() ? FLY_DISTANCE.desktop : FLY_DISTANCE.mobile));

  readonly total = computed(() => this.suggestions().length);
  /** The tasks without a decision, in the order of the list */
  private readonly openTasks = computed(() => {
    const decided = new Set(this.decisions().map((d) => d.id));
    return this.suggestions().filter((s) => !decided.has(s.id));
  });
  readonly done = computed(() => this.openTasks().length === 0);
  /** The card on top of the stack; the last task once everything is decided. */
  readonly current = computed(() => {
    const open = this.openTasks();
    return open.find((s) => s.id === this.currentId()) ?? open[0] ?? this.suggestions()[this.total() - 1];
  });
  /**
   * The next two cards peeking out below the current one: the open tasks
   * after it in the list, then the ones skipped before it.
   */
  readonly upcoming = computed(() => {
    if (this.done()) return [];
    const open = this.openTasks();
    const at = open.indexOf(this.current());
    return [...open.slice(at + 1), ...open.slice(0, at)].slice(0, 2);
  });
  readonly currentDraft = computed(() => this.draftOf(this.current()));
  /** Belongs to the task: opening another one from the list leaves the edit as it is. */
  readonly editing = computed(() => !this.done() && this.current().id in this.editBackups());
  /** The card on top is with the AI: it waits for the new proposal and cannot be decided or edited. */
  readonly revising = computed(() => !this.done() && this.revisingIds().has(this.current().id));

  /** A decided task opened from the list: shown instead of the stack, its decision stays as it is. */
  readonly viewing = computed(() => {
    const id = this.viewingId();
    return id === null ? null : (this.suggestions().find((s) => s.id === id) ?? null);
  });
  /** The text as it was decided, so with the edits of an edited approval. */
  readonly viewingDraft = computed(() => {
    const suggestion = this.viewing();
    return suggestion ? this.draftOf(suggestion) : '';
  });
  readonly viewingItem = computed(() => this.queue().find((q) => q.id === this.viewingId()) ?? null);

  /** 0 → 1 while dragging towards the threshold */
  readonly progress = computed(() => (this.leaving() ? 1 : Math.min(Math.abs(this.dx()) / this.threshold(), 1)));
  readonly approveStrength = computed(() =>
    this.leaving() === 'approve' ? 1 : Math.max(0, Math.min(this.dx() / this.threshold(), 1)),
  );
  readonly rejectStrength = computed(() =>
    this.leaving() === 'reject' ? 1 : Math.max(0, Math.min(-this.dx() / this.threshold(), 1)),
  );

  readonly approvedCount = computed(() => this.decisions().filter((d) => d.verdict === 'approve').length);
  readonly rejectedCount = computed(() => this.decisions().length - this.approvedCount());
  readonly openLabel = computed(
    () => `${this.total() - this.decisions().length} offen · ${this.decisions().length} erledigt`,
  );

  readonly queue = computed<QueueItem[]>(() => {
    const decisions = new Map(this.decisions().map((d) => [d.id, d]));
    const viewingId = this.viewingId();
    const current = this.current();
    return this.suggestions().map((s, i) => {
      const d = decisions.get(s.id);
      let status: QueueStatus;
      if (d) status = d.verdict === 'reject' ? 'rejected' : d.edited ? 'edited' : 'approved';
      else status = s === current ? 'current' : 'waiting';
      return {
        id: s.id,
        position: String(i + 1).padStart(2, '0'),
        name: s.contact.name,
        company: s.contact.company,
        kindLabel: s.kindLabel,
        status,
        statusLabel: STATUS_LABEL[status],
        decided: !!d,
        shown: viewingId === null ? status === 'current' : s.id === viewingId,
      };
    });
  });

  // ---- Loading ----

  /** Fetches the signed-in user's tasks; whatever was on screen before is dropped. */
  load(): void {
    this.clear();
    const id = this.loadId;
    this.enqueue(this.api.list(startOfToday())).then(
      (tasks) => {
        if (id === this.loadId) this.show(tasks);
      },
      () => {
        if (id === this.loadId) this.loadState.set('failed');
      },
    );
  }

  /**
   * Picks up tasks created meanwhile, e.g. from a mail that just arrived.
   * They join the end of the stack, so nothing on screen moves.
   */
  refresh(): void {
    if (this.loadState() !== 'ready') return;
    const id = this.loadId;
    this.enqueue(this.api.list(startOfToday())).then(
      (tasks) => {
        if (id !== this.loadId) return;
        const known = new Set(this.suggestions().map((s) => s.id));
        const added = tasks.filter((task) => task.status === 'open' && !known.has(task.id));
        if (!added.length) return;
        this.suggestions.update((list) => [...list, ...added.map((task) => toSuggestion(task))]);
        // The undo of a decision just made is worth more than the news
        if (this.toast()?.undoable) return;
        this.showToast({
          text: added.length === 1 ? `Neue Aufgabe · ${added[0].contactName}` : `${added.length} neue Aufgaben`,
          verdict: 'approve',
          undoable: false,
        });
      },
      () => undefined,
    );
  }

  // ---- Gesture ----

  canDrag(): boolean {
    return !this.editing() && !this.revising() && !this.leaving() && !this.done() && !this.viewing();
  }

  beginDrag(): void {
    this.dragging.set(true);
    this.dx.set(0);
  }

  dragTo(dx: number): void {
    if (this.dragging()) this.dx.set(dx);
  }

  endDrag(): void {
    if (!this.dragging()) return;
    const dx = this.dx();
    if (dx > this.threshold()) this.decide('approve');
    else if (dx < -this.threshold()) this.decide('reject');
    else {
      this.dragging.set(false);
      this.dx.set(0);
    }
  }

  // ---- Decisions ----

  approve(): void {
    this.decide('approve');
  }

  reject(): void {
    this.decide('reject');
  }

  decide(verdict: Verdict): void {
    if (this.leaving() || this.done() || this.viewing() || this.revising()) return;
    const suggestion = this.current();
    const draft = this.draftOf(suggestion);
    const edited = verdict === 'approve' && draft !== suggestion.draft;

    this.dragging.set(false);
    this.endEdit(suggestion.id);
    this.afterLeave = this.upcoming()[0]?.id ?? null;
    this.leaving.set(verdict);
    this.save(
      verdict === 'approve' ? this.api.approve(suggestion.id, edited ? draft : undefined) : this.api.reject(suggestion.id),
    );

    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => {
      this.decisions.update((list) => [...list, { id: suggestion.id, verdict, edited }]);
      this.currentId.set(this.afterLeave);
      this.leaving.set(null);
      this.dx.set(0);
      this.showReason.set(false);
      this.snap();
      // Opened a decided task while the card was leaving: no undo next to it
      if (!this.viewing()) this.showToast({ text: this.toastText(suggestion, verdict, edited), verdict, undoable: true });
    }, LEAVE_MS);
  }

  undo(): void {
    const last = this.decisions().at(-1);
    if (!last || this.leaving() || this.viewing()) return;
    this.save(this.api.reopen(last.id));
    clearTimeout(this.toastTimer);
    this.decisions.update((list) => list.slice(0, -1));
    this.currentId.set(last.id);
    this.toast.set(null);
    this.dx.set(0);
    this.showReason.set(false);
    this.snap();
  }

  /** Takes back every decision, also those of earlier days. */
  reset(): void {
    this.save(this.api.reopenAll());
    this.load();
  }

  // ---- Opening a task from the list ----

  /**
   * Puts an open task on top of the stack, to decide it now; decided ones are
   * ignored. The list keeps its order, after the decision the stack goes on
   * with the open task below it.
   */
  pick(id: string): void {
    if (!this.openTasks().some((s) => s.id === id)) return;
    this.closeView();
    if (id === this.current().id) return;
    this.showReason.set(false);
    // The card flying out stays the one it is, the picked task follows it
    if (this.leaving()) this.afterLeave = id;
    else this.currentId.set(id);
  }

  /**
   * Opens a decided task to read; tasks without a decision are ignored.
   * The undo offer of the last decision ends here, nothing next to the open
   * task changes a decision.
   */
  view(id: string): void {
    if (!this.decisions().some((d) => d.id === id)) return;
    clearTimeout(this.toastTimer);
    this.toast.set(null);
    this.showReason.set(false);
    this.viewingId.set(id);
  }

  /** Back to the stack, or to the summary once everything is decided. */
  closeView(): void {
    if (this.viewingId() === null) return;
    this.showReason.set(false);
    this.viewingId.set(null);
  }

  // ---- Editing ----

  startEdit(): void {
    if (this.leaving() || this.done() || this.viewing() || this.editing() || this.revising()) return;
    const id = this.current().id;
    const backup = this.currentDraft();
    this.showReason.set(false);
    this.editBackups.update((backups) => ({ ...backups, [id]: backup }));
  }

  updateDraft(value: string): void {
    const id = this.current().id;
    this.drafts.update((d) => ({ ...d, [id]: value }));
  }

  cancelEdit(): void {
    if (!this.editing()) return;
    const id = this.current().id;
    this.updateDraft(this.editBackups()[id]);
    this.endEdit(id);
  }

  saveEdit(): void {
    this.decide('approve');
  }

  toggleReason(): void {
    this.showReason.update((v) => !v);
  }

  // ---- Hints to the AI ----

  hintOf(id: string): string {
    return this.hints()[id] ?? '';
  }

  hintErrorOf(id: string): string | null {
    return this.hintErrors()[id] ?? null;
  }

  isRevising(id: string): boolean {
    return this.revisingIds().has(id);
  }

  /** Only a task that still waits for a decision and is not being edited by hand. */
  canRevise(id: string): boolean {
    return this.openTasks().some((s) => s.id === id) && !(id in this.editBackups()) && !(this.leaving() && this.current().id === id);
  }

  updateHint(id: string, value: string): void {
    this.hints.update((hints) => ({ ...hints, [id]: value }));
    this.hintErrors.update(({ [id]: _, ...rest }) => rest);
  }

  /**
   * Sends the hint typed for a task to the AI, which reworks the task with it
   * and notes in the CRM what the hint says about the customer. The task keeps
   * its place and waits; the other tasks can be decided in the meantime.
   */
  revise(id: string): void {
    const hint = this.hintOf(id).trim();
    if (!hint || this.isRevising(id) || !this.canRevise(id)) return;
    const loadId = this.loadId;
    this.setRevising(id, true);
    this.hintErrors.update(({ [id]: _, ...rest }) => rest);
    // After the decisions on their way, but not in their queue: a new draft takes the model a while
    this.requests
      .then(() => firstValueFrom(this.api.revise(id, hint)))
      .then(
        ({ task, crmNote }) => {
          if (loadId !== this.loadId) return;
          this.setRevising(id, false);
          this.suggestions.update((list) => list.map((s) => (s.id === id ? toSuggestion(task) : s)));
          this.hints.update(({ [id]: _, ...rest }) => rest);
          this.drafts.update(({ [id]: _, ...rest }) => rest);
          // Mobile: back from the reasoning to the draft, which is what changed
          if (!this.done() && this.current().id === id) this.showReason.set(false);
          // The undo of a decision just made is worth more than the news
          if (this.toast()?.undoable) return;
          this.showToast({ text: crmNote ? 'Vorschlag angepasst · im CRM notiert' : 'Vorschlag angepasst', verdict: 'approve', undoable: false });
        },
        (err: unknown) => {
          if (loadId !== this.loadId) return;
          this.setRevising(id, false);
          this.hintErrors.update((errors) => ({ ...errors, [id]: revisionError(err) }));
        },
      );
  }

  // ---- Helpers ----

  /** Back to "nothing loaded"; a load still on its way is ignored. */
  private clear(): void {
    this.loadId++;
    clearTimeout(this.leaveTimer);
    clearTimeout(this.toastTimer);
    this.loadState.set('loading');
    this.suggestions.set([]);
    this.currentId.set(null);
    this.afterLeave = null;
    this.decisions.set([]);
    this.drafts.set({});
    this.editBackups.set({});
    this.hints.set({});
    this.hintErrors.set({});
    this.revisingIds.set(new Set());
    this.viewingId.set(null);
    this.toast.set(null);
    this.dx.set(0);
    this.dragging.set(false);
    this.leaving.set(null);
    this.showReason.set(false);
  }

  private show(tasks: Task[]): void {
    const decided = tasks.filter((task) => task.status !== 'open');
    this.suggestions.set(tasks.map((task) => toSuggestion(task)));
    this.decisions.set(
      decided.map((task) => ({
        id: task.id,
        verdict: task.status === 'rejected' ? 'reject' : 'approve',
        edited: task.finalDraft !== null,
      })),
    );
    this.drafts.set(
      Object.fromEntries(decided.flatMap((task) => (task.finalDraft === null ? [] : [[task.id, task.finalDraft]]))),
    );
    this.loadState.set('ready');
    this.snap();
  }

  /** If the server did not take a change, its state replaces what the screen assumed. */
  private save(request: Observable<unknown>): void {
    this.enqueue(request).catch(() => {
      if (!this.auth.session()) return;
      this.load();
      this.showToast({ text: 'Nicht gespeichert · bitte erneut versuchen', verdict: 'reject', undoable: false });
    });
  }

  private enqueue<T>(request: Observable<T>): Promise<T> {
    const result = this.requests.then(() => firstValueFrom(request));
    this.requests = result.catch(() => undefined);
    return result;
  }

  private setRevising(id: string, revising: boolean): void {
    this.revisingIds.update((ids) => {
      const next = new Set(ids);
      if (revising) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private endEdit(id: string): void {
    this.editBackups.update(({ [id]: _, ...rest }) => rest);
  }

  private draftOf(suggestion: Suggestion): string {
    return this.drafts()[suggestion.id] ?? suggestion.draft;
  }

  private toastText(s: Suggestion, verdict: Verdict, edited: boolean): string {
    if (verdict === 'reject') return 'Verworfen · Cherrypick lernt daraus';
    return edited ? `Bearbeitet & freigegeben · ${s.scheduledTime}` : `${s.scheduledLabel} · ${s.scheduledTime}`;
  }

  private showToast(toast: Toast): void {
    clearTimeout(this.toastTimer);
    this.toast.set(toast);
    this.toastTimer = setTimeout(() => this.toast.set(null), TOAST_MS);
  }

  private snap(): void {
    this.snapping.set(true);
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snapping.set(false), 50);
  }
}

/** Why a hint did not get through, in the server's words where they are meant for the user. */
function revisionError(err: unknown): string {
  const fallback = 'Das hat nicht geklappt. Dein Hinweis steht noch da, versuch es noch einmal.';
  if (!(err instanceof HttpErrorResponse)) return fallback;
  if (err.status === 0) return 'Keine Verbindung zum Server.';
  const message = (err.error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && [409, 502, 503].includes(err.status) ? message : fallback;
}

/** Start of the local day, as the server expects it (ISO 8601 in UTC). */
function startOfToday(): string {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}
