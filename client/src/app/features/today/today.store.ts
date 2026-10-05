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
 * right away and are saved on the server in the background.
 */
@Injectable({ providedIn: 'root' })
export class TodayStore {
  private readonly api = inject(TasksApi);
  private readonly auth = inject(AuthService);
  private readonly viewport = inject(Viewport);

  readonly loadState = signal<LoadState>('loading');
  /** Today's decided tasks first, in the order they were decided, then the open ones. */
  readonly suggestions = signal<Suggestion[]>([]);
  readonly index = signal(0);
  readonly decisions = signal<Decision[]>([]);
  readonly toast = signal<Toast | null>(null);

  // Gesture / transition state
  readonly dx = signal(0);
  readonly dragging = signal(false);
  readonly leaving = signal<Verdict | null>(null);
  /** true for one frame after a card change so nothing animates back into place */
  readonly snapping = signal(false);

  // Editing / mobile "why" panel
  readonly editing = signal(false);
  readonly showReason = signal(false);
  private readonly drafts = signal<Record<string, string>>({});
  private draftBackup = '';

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
  readonly done = computed(() => this.index() >= this.total());
  readonly current = computed(() => this.suggestions()[Math.min(this.index(), this.total() - 1)]);
  /** The next two cards peeking out below the current one. */
  readonly upcoming = computed(() => (this.done() ? [] : this.suggestions().slice(this.index() + 1, this.index() + 3)));
  readonly currentDraft = computed(() => this.draftOf(this.current()));

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
    return this.suggestions().map((s, i) => {
      const d = decisions.get(s.id);
      let status: QueueStatus;
      if (d) status = d.verdict === 'reject' ? 'rejected' : d.edited ? 'edited' : 'approved';
      else status = i === this.index() ? 'current' : 'waiting';
      return {
        id: s.id,
        position: String(i + 1).padStart(2, '0'),
        name: s.contact.name,
        company: s.contact.company,
        kindLabel: s.kindLabel,
        status,
        statusLabel: STATUS_LABEL[status],
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

  // ---- Gesture ----

  canDrag(): boolean {
    return !this.editing() && !this.leaving() && !this.done();
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
    if (this.leaving() || this.done()) return;
    const suggestion = this.current();
    const draft = this.draftOf(suggestion);
    const edited = verdict === 'approve' && draft !== suggestion.draft;

    this.dragging.set(false);
    this.editing.set(false);
    this.leaving.set(verdict);
    this.save(
      verdict === 'approve' ? this.api.approve(suggestion.id, edited ? draft : undefined) : this.api.reject(suggestion.id),
    );

    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => {
      this.decisions.update((list) => [...list, { id: suggestion.id, verdict, edited }]);
      this.index.update((i) => i + 1);
      this.leaving.set(null);
      this.dx.set(0);
      this.showReason.set(false);
      this.snap();
      this.showToast({ text: this.toastText(suggestion, verdict, edited), verdict, undoable: true });
    }, LEAVE_MS);
  }

  undo(): void {
    const last = this.decisions().at(-1);
    if (!last || this.leaving()) return;
    this.save(this.api.reopen(last.id));
    clearTimeout(this.toastTimer);
    this.decisions.update((list) => list.slice(0, -1));
    this.index.update((i) => i - 1);
    this.toast.set(null);
    this.dx.set(0);
    this.editing.set(false);
    this.showReason.set(false);
    this.snap();
  }

  /** Takes back every decision, also those of earlier days. */
  reset(): void {
    this.save(this.api.reopenAll());
    this.load();
  }

  // ---- Editing ----

  startEdit(): void {
    if (this.leaving() || this.done()) return;
    this.draftBackup = this.currentDraft();
    this.showReason.set(false);
    this.editing.set(true);
  }

  updateDraft(value: string): void {
    const id = this.current().id;
    this.drafts.update((d) => ({ ...d, [id]: value }));
  }

  cancelEdit(): void {
    this.updateDraft(this.draftBackup);
    this.editing.set(false);
  }

  saveEdit(): void {
    this.decide('approve');
  }

  toggleReason(): void {
    this.showReason.update((v) => !v);
  }

  // ---- Helpers ----

  /** Back to "nothing loaded"; a load still on its way is ignored. */
  private clear(): void {
    this.loadId++;
    clearTimeout(this.leaveTimer);
    clearTimeout(this.toastTimer);
    this.loadState.set('loading');
    this.suggestions.set([]);
    this.index.set(0);
    this.decisions.set([]);
    this.drafts.set({});
    this.toast.set(null);
    this.dx.set(0);
    this.dragging.set(false);
    this.leaving.set(null);
    this.editing.set(false);
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
    this.index.set(decided.length);
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

/** Start of the local day, as the server expects it (ISO 8601 in UTC). */
function startOfToday(): string {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}
