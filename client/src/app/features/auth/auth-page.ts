import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import gsap from 'gsap';
import { Observable } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CurrentUser } from '../../core/auth/auth.models';
import { Icon } from '../../shared/icon';
import { MOCK_SUGGESTIONS } from '../today/mock-suggestions';
import { AuthMode, describeAuthError, passwordStrength } from './auth-errors';
import { CHERRY_LEFT_EDGE } from './cherry-anchor';
import type { LoginScene } from './login-scene';

type Status = 'idle' | 'submitting' | 'success';

/** Example outcomes cycling below the headline – what a morning with Cherrypick looks like. */
const TICKER = [
  ...MOCK_SUGGESTIONS.slice(0, 4).map((s) => ({ text: `${s.scheduledLabel} · ${s.scheduledTime}`, tone: 'approve' })),
  { text: 'Verworfen · Cherrypick lernt daraus', tone: 'reject' },
];

@Component({
  selector: 'app-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon],
  templateUrl: './auth-page.html',
  styleUrl: './auth-page.scss',
})
export class AuthPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly card = viewChild.required<ElementRef<HTMLFormElement>>('card');
  private readonly stamp = viewChild.required<ElementRef<HTMLElement>>('stamp');

  readonly mode = signal<AuthMode>(this.route.snapshot.data['mode'] === 'register' ? 'register' : 'login');
  readonly status = signal<Status>('idle');
  readonly error = signal<string | null>(null);
  readonly showPassword = signal(false);
  readonly sceneFailed = signal(false);
  readonly tickerIndex = signal(0);
  readonly ticker = computed(() => TICKER[this.tickerIndex()]);

  readonly form = new FormGroup({
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  private readonly password = toSignal(this.form.controls.password.valueChanges, { initialValue: '' });
  readonly strength = computed(() => passwordStrength(this.password()));
  readonly strengthBars = computed(() => Array.from({ length: 10 }, (_, i) => i < this.strength().bars));

  readonly greeting = (() => {
    const hour = new Date().getHours();
    return hour < 11 ? 'Guten Morgen.' : hour < 18 ? 'Guten Tag.' : 'Guten Abend.';
  })();

  private scene?: LoginScene;
  private gsapContext?: gsap.Context;
  private tickerTimer?: ReturnType<typeof setInterval>;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    this.applyModeValidators();

    afterNextRender(() => {
      this.gsapContext = gsap.context(() => this.playIntro(), this.host.nativeElement);
      void this.startScene();
      this.startTicker();
    });

    inject(DestroyRef).onDestroy(() => {
      clearInterval(this.tickerTimer);
      window.removeEventListener('resize', this.placeCherries);
      this.gsapContext?.revert();
      this.scene?.dispose();
    });
  }

  switchMode(mode: AuthMode): void {
    if (mode === this.mode() || this.status() !== 'idle') return;
    const card = this.card().nativeElement;
    const fromHeight = card.offsetHeight;

    this.mode.set(mode);
    this.error.set(null);
    this.applyModeValidators();
    this.form.markAsUntouched();
    const redirect = this.redirectTarget();
    this.location.replaceState(mode === 'login' ? '/login' : '/register', redirect !== '/' ? `redirect=${encodeURIComponent(redirect)}` : '');

    afterNextRender(
      () => {
        if (this.reducedMotion) return;
        this.gsapContext?.add(() => {
          gsap.fromTo(card, { height: fromHeight }, { height: card.offsetHeight, duration: 0.55, ease: 'power3.inOut', clearProps: 'height' });
          gsap.from(card.querySelectorAll('.reveal'), { opacity: 0, y: 14, duration: 0.45, stagger: 0.04, ease: 'power2.out', delay: 0.08 });
        });
      },
      { injector: this.injector },
    );
  }

  submit(): void {
    if (this.status() !== 'idle') return;
    this.error.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.shake();
      return;
    }

    const { firstName, lastName, email, password } = this.form.getRawValue();
    if (this.mode() === 'register' && password.trim().toLowerCase() === email.trim().toLowerCase()) {
      this.error.set('Dein Passwort darf nicht deine E-Mail-Adresse sein.');
      this.shake();
      return;
    }

    this.status.set('submitting');
    this.scene?.setMood('busy');

    const request$: Observable<CurrentUser> =
      this.mode() === 'login'
        ? this.auth.login(email, password)
        : this.auth.register({ email, password, firstName: firstName.trim(), lastName: lastName.trim() });

    request$.subscribe({
      next: () => void this.celebrateAndEnter(),
      error: (err: unknown) => {
        this.status.set('idle');
        this.error.set(describeAuthError(err, this.mode()));
        this.scene?.setMood('error');
        this.shake();
      },
    });
  }

  fieldInvalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  // ---------- Motion ----------

  private playIntro(): void {
    if (this.reducedMotion) return;
    gsap
      .timeline({ defaults: { ease: 'power3.out' } })
      .from('.top', { opacity: 0, y: -14, duration: 0.7 }, 0)
      .from('.hero .word', { yPercent: 115, duration: 1.1, stagger: 0.07, ease: 'power4.out' }, 0.15)
      .from('.hero__eyebrow, .hero__text, .ticker', { opacity: 0, y: 18, duration: 0.8, stagger: 0.1 }, 0.55)
      .from('.ghost', { opacity: 0, y: 70, rotate: 7, duration: 1, stagger: 0.08, ease: 'back.out(1.3)' }, 0.3)
      .from('.card', { opacity: 0, y: 110, rotate: 5, duration: 1.1, ease: 'back.out(1.2)' }, 0.42)
      .from('.card .reveal', { opacity: 0, y: 16, duration: 0.55, stagger: 0.045 }, 0.8);
  }

  private async startScene(): Promise<void> {
    try {
      const { LoginScene } = await import('./login-scene');
      this.scene = new LoginScene(this.canvas().nativeElement, this.reducedMotion);
      this.placeCherries();
      window.addEventListener('resize', this.placeCherries);
      this.scene.intro();
    } catch {
      this.sceneFailed.set(true);
    }
  }

  /**
   * Split layout: centre the cherries in the free space above the headline,
   * their left edge flush with it – wherever the content column ends up.
   */
  private readonly placeCherries = () => {
    if (!this.scene) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      this.scene.setAnchor(null);
      return;
    }
    const host = this.host.nativeElement;
    const top = host.querySelector<HTMLElement>('.top');
    const hero = host.querySelector('.hero')?.getBoundingClientRect();
    if (!top || !hero) return;

    // offset* ignores the intro's transform on the top bar
    const topBottom = top.offsetTop + top.offsetHeight;
    const space = hero.top - topBottom;
    const height = Math.max(160, Math.min(space * 0.78, 520));
    this.scene.setAnchor({ x: hero.left + height * CHERRY_LEFT_EDGE, y: topBottom + space / 2, height });
  };

  private startTicker(): void {
    this.tickerTimer = setInterval(() => {
      const el = this.host.nativeElement.querySelector('.ticker__line');
      if (!el || this.reducedMotion) {
        this.tickerIndex.update((i) => (i + 1) % TICKER.length);
        return;
      }
      this.gsapContext?.add(() =>
        gsap
          .timeline()
          .to(el, { yPercent: -120, opacity: 0, duration: 0.35, ease: 'power2.in' })
          .call(() => this.tickerIndex.update((i) => (i + 1) % TICKER.length))
          .fromTo(el, { yPercent: 120, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.6)' }),
      );
    }, 3200);
  }

  private shake(): void {
    if (this.reducedMotion) return;
    gsap.fromTo(this.card().nativeElement, { x: 0 }, { keyframes: { x: [-14, 11, -8, 5, -2, 0] }, duration: 0.5, ease: 'power1.out' });
  }

  /** The card gets stamped and flies off like an approved suggestion; the cherries rush in. */
  private async celebrateAndEnter(): Promise<void> {
    this.status.set('success');
    const target = this.redirectTarget();

    if (!this.reducedMotion) {
      const q = gsap.utils.selector(this.host.nativeElement);
      const tl = gsap.timeline();
      tl.fromTo(this.stamp().nativeElement, { opacity: 0, scale: 1.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2.5)' })
        .to(this.card().nativeElement, { x: () => window.innerWidth, y: -80, rotate: 26, opacity: 0, duration: 0.7, ease: 'power2.in' }, '+=0.35')
        .to(q('.ghost'), { opacity: 0, y: -30, duration: 0.5, stagger: 0.05, ease: 'power2.in' }, '<0.1')
        .to(q('.hero, .top'), { opacity: 0, y: -20, duration: 0.5, ease: 'power2.in' }, '<');
      if (this.scene) tl.add(this.scene.celebrate(), '<');
      tl.to(q('.curtain'), { opacity: 1, duration: 0.45, ease: 'power1.in' }, '-=0.4');
      await tl;
    }
    await this.router.navigateByUrl(target);
  }

  private applyModeValidators(): void {
    const { firstName, lastName, password } = this.form.controls;
    if (this.mode() === 'register') {
      firstName.enable();
      lastName.enable();
      password.setValidators([Validators.required, Validators.minLength(8), Validators.maxLength(128)]);
    } else {
      firstName.disable();
      lastName.disable();
      password.setValidators([Validators.required]);
    }
    password.updateValueAndValidity();
  }

  /** Only same-app paths, never an external URL. */
  private redirectTarget(): string {
    const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/';
    return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/';
  }
}
