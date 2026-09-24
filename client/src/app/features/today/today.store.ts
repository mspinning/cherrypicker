import { Injectable, computed, inject, signal } from '@angular/core';
import { Viewport } from '../../core/viewport';
import { MOCK_SUGGESTIONS } from './mock-suggestions';
import { Decision, QueueItem, QueueStatus, Suggestion, Toast, Verdict } from './suggestion.model';

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

/**
 * State of the "Heute" screen: the suggestion stack, swipe gesture,
 * draft editing and today's decisions. Purely client-side for now.
 */
@Injectable({ providedIn: 'root' })
export class TodayStore {
  private readonly viewport = inject(Viewport);

  readonly suggestions = signal<Suggestion[]>(MOCK_SUGGESTIONS);
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

  decide(verdict: Verdict, edited = false): void {
    if (this.leaving() || this.done()) return;
    const suggestion = this.current();

    this.dragging.set(false);
    this.editing.set(false);
    this.leaving.set(verdict);

    clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => {
      this.decisions.update((list) => [...list, { id: suggestion.id, verdict, edited }]);
      this.index.update((i) => i + 1);
      this.leaving.set(null);
      this.dx.set(0);
      this.showReason.set(false);
      this.snap();
      this.showToast({ text: this.toastText(suggestion, verdict, edited), verdict });
    }, LEAVE_MS);
  }

  undo(): void {
    if (!this.decisions().length || this.leaving()) return;
    clearTimeout(this.toastTimer);
    this.decisions.update((list) => list.slice(0, -1));
    this.index.update((i) => i - 1);
    this.toast.set(null);
    this.dx.set(0);
    this.editing.set(false);
    this.showReason.set(false);
    this.snap();
  }

  reset(): void {
    clearTimeout(this.leaveTimer);
    clearTimeout(this.toastTimer);
    this.index.set(0);
    this.decisions.set([]);
    this.drafts.set({});
    this.toast.set(null);
    this.dx.set(0);
    this.dragging.set(false);
    this.leaving.set(null);
    this.editing.set(false);
    this.showReason.set(false);
    this.snap();
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
    const suggestion = this.current();
    this.decide('approve', this.draftOf(suggestion) !== suggestion.draft);
  }

  toggleReason(): void {
    this.showReason.update((v) => !v);
  }

  // ---- Helpers ----

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
