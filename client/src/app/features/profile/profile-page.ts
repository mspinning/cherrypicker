import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import gsap from 'gsap';
import { AuthService } from '../../core/auth/auth.service';
import { avatarColorOf, initialsOf, visibleRoles } from '../../core/auth/user-display';
import { Icon } from '../../shared/icon';
import { TodayStore } from '../today/today.store';

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

@Component({
  selector: 'app-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  templateUrl: './profile-page.html',
  styleUrl: './profile-page.scss',
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  protected readonly today = inject(TodayStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly user = this.auth.user;
  readonly loadFailed = signal(false);
  readonly copied = signal(false);

  readonly initials = computed(() => initialsOf(this.user()));
  readonly avatarColor = computed(() => avatarColorOf(this.user()));
  readonly roles = computed(() => {
    const u = this.user();
    return u ? visibleRoles(u) : [];
  });
  readonly memberSince = computed(() => {
    const u = this.user();
    return u ? DATE.format(new Date(u.createdAt)) : '';
  });
  readonly memberSinceShort = computed(() => {
    const u = this.user();
    return u ? MONTH.format(new Date(u.createdAt)) : '';
  });
  readonly sessionUntil = computed(() => {
    const s = this.auth.session();
    return s ? TIME.format(new Date(s.refreshExpiresAt)) : '';
  });
  readonly openCount = computed(() => this.today.total() - this.today.decisions().length);

  private gsapContext?: gsap.Context;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    if (!this.user()) this.reload();

    // Animate in once the profile is there (it may still be loading)
    const injector = inject(Injector);
    let played = false;
    effect(() => {
      if (!this.user() || played) return;
      played = true;
      afterNextRender(() => this.playIntro(), { injector });
    });

    inject(DestroyRef).onDestroy(() => {
      this.gsapContext?.revert();
      clearTimeout(this.copiedTimer);
    });
  }

  private playIntro(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.gsapContext = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: 'power3.out' } })
        .from('.id-ghost', { opacity: 0, y: 50, rotate: 6, duration: 0.9, ease: 'back.out(1.3)' }, 0)
        .from('.id-card', { opacity: 0, y: 80, rotate: 6, duration: 1, ease: 'back.out(1.2)' }, 0.05)
        .from('.id-card .person, .id-card .facts, .id-card__foot', { opacity: 0, y: 14, duration: 0.5, stagger: 0.07 }, 0.4)
        .from('.tally__seg', { scaleY: 0, duration: 0.4, stagger: 0.04, ease: 'back.out(3)' }, 0.7)
        .from('.panel', { opacity: 0, y: 30, duration: 0.7, stagger: 0.09 }, 0.2);
    }, this.host.nativeElement);
  }

  reload(): void {
    this.loadFailed.set(false);
    this.auth.loadMe().subscribe({ error: () => this.loadFailed.set(true) });
  }

  async copyId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 1800);
    } catch {
      // clipboard blocked – the id is still selectable
    }
  }

  logout(): void {
    this.today.reset();
    this.auth.logout();
  }
}
