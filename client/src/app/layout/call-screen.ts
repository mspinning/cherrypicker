import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { pastelOf } from '../core/auth/user-display';
import { CallStore } from '../core/voice/call.store';
import { CallResult } from '../core/voice/voice.models';
import { formatDay, formatTime } from '../shared/format';
import { Icon } from '../shared/icon';

type Customer = CallResult['customers'][number];

/**
 * A voice call with the assistant, shown like a phone call: full screen on
 * phones, a phone-sized card on larger screens. After hanging up it turns
 * into the list of what the call left behind.
 */
@Component({
  selector: 'app-call-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  host: {
    '[attr.data-phase]': 'call.phase()',
    '[class.is-typing]': 'call.typing()',
    '(keydown.escape)': 'onEscape()',
  },
  templateUrl: './call-screen.html',
  styleUrl: './call-screen.scss',
})
export class CallScreen {
  protected readonly call = inject(CallStore);
  private readonly router = inject(Router);

  private readonly phone = viewChild.required<ElementRef<HTMLElement>>('phone');
  private readonly captions = viewChild<ElementRef<HTMLElement>>('captions');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly time = computed(() => {
    const seconds = this.call.seconds();
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  });

  protected readonly status = computed(() => {
    switch (this.call.phase()) {
      case 'connecting':
        return 'Verbinde …';
      case 'thinking':
        return this.call.step() || 'Einen Moment …';
      case 'speaking':
        return 'Cherry spricht';
      case 'listening':
        if (this.call.micProblem()) return 'Schreib, was es Neues gibt';
        if (!this.call.micOn()) return 'Mikrofon ist aus';
        return this.call.hearing() ? 'Ich höre zu …' : 'Sprich einfach los';
      default:
        return '';
    }
  });

  /** What a tap on Cherry does right now */
  protected readonly hint = computed(() => {
    if (this.call.phase() === 'speaking' && this.call.speakerOn() && this.call.canSpeak) return 'Antippen zum Unterbrechen';
    if (this.call.phase() === 'listening' && this.call.hearing()) return 'Antippen, wenn du fertig bist';
    return '';
  });

  protected readonly nothing = computed(() => {
    const result = this.call.result();
    return !!result && !result.tasks.length && !result.customers.length;
  });

  constructor() {
    this.fitVisibleViewport();
    // Keyboard users land in the call, not behind it
    effect(() => this.phone().nativeElement.focus());
    // The newest line stays in view
    afterRenderEffect(() => {
      this.call.lines();
      const list = this.captions()?.nativeElement;
      list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    });
    afterRenderEffect(() => {
      if (this.call.typing()) this.field()?.nativeElement.focus();
    });
  }

  /** iOS lays its keyboard over the page instead of resizing it: the call shrinks to what is still visible. */
  private fitVisibleViewport(): void {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const fit = () => host.style.setProperty('--visible-height', `${viewport.height}px`);
    fit();
    viewport.addEventListener('resize', fit);
    inject(DestroyRef).onDestroy(() => viewport.removeEventListener('resize', fit));
  }

  protected send(event: Event, field: HTMLInputElement): void {
    event.preventDefault();
    this.call.sendText(field.value);
    field.value = '';
  }

  protected toToday(): void {
    this.call.close();
    void this.router.navigateByUrl('/');
  }

  /** Never hangs up by accident: Escape only closes what is already over. */
  protected onEscape(): void {
    if (['summary', 'failed'].includes(this.call.phase())) this.call.close();
  }

  protected nameOf(customer: Customer): string {
    return customer.contact?.fullName ?? customer.company?.name ?? '';
  }

  protected initials(name: string): string {
    const words = name.trim().split(/\s+/);
    return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  }

  protected colorOf(customer: Customer): string {
    return pastelOf(customer.contact?.id ?? customer.company?.id ?? '');
  }

  /** "neu angelegt bei Nordwerk Logistik" / "ergänzt" */
  protected detail(customer: Customer): string {
    const created = customer.contact ? customer.contact.created : customer.company?.created;
    const company = customer.contact && customer.company ? ` · ${customer.company.name}` : '';
    return `${created ? 'Neu angelegt' : 'Ergänzt'}${company}`;
  }

  protected linkOf(customer: Customer): Record<string, string> {
    return customer.contact ? { tab: 'people', contact: customer.contact.id } : { company: customer.company!.id };
  }

  /** "Heute, 12:00 Uhr" / "Fr., 9. Okt., 17:00 Uhr" */
  protected due(value: string): string {
    const date = new Date(value);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return `${sameDay ? 'Heute' : formatDay(value)}, ${formatTime(value)} Uhr`;
  }
}
