import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { CATEGORIES, CreateUrlsResult, SourceCategory } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { KnowledgeStore } from './knowledge.store';
import { errorMessage, plural } from './knowledge-format';
import { createSourceList } from './source-list';
import { SourceItem } from './source-item';

const MAX_URLS = 200;

/** Web pages of the company; the server fetches and reads them in the background. */
@Component({
  selector: 'app-url-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon, SourceItem],
  template: `
    <form class="add" [formGroup]="form" (ngSubmit)="add()">
      <label class="field add__urls">
        <span class="field__label">Webseiten</span>
        <textarea
          class="textarea"
          formControlName="urls"
          rows="3"
          spellcheck="false"
          autocomplete="off"
          placeholder="https://www.beispiel.de/leistungen&#10;https://www.beispiel.de/referenzen"
        ></textarea>
        <span class="field__hint">
          Eine Adresse pro Zeile, bis zu {{ maxUrls }} auf einmal. Gelesen wird genau diese Seite, keine Unterseiten.
        </span>
      </label>
      <div class="add__row">
        <label class="field add__category">
          <span class="field__label">Kategorie</span>
          <select class="select" formControlName="category">
            @for (c of categories; track c.value) {
              <option [value]="c.value">{{ c.label }}</option>
            }
          </select>
        </label>
        <button type="submit" class="pill pill--primary" [disabled]="busy() || !lines().length || lines().length > maxUrls">
          @if (busy()) {
            <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
          } @else {
            <app-icon name="plus" [size]="16" [strokeWidth]="2.2" />
          }
          {{ lines().length > 1 ? lines().length + ' Seiten hinzufügen' : 'Seite hinzufügen' }}
        </button>
      </div>
    </form>

    @if (error(); as message) {
      <div class="alert" role="alert">
        <app-icon name="alert" [size]="18" />
        <span>{{ message }}</span>
      </div>
    }
    @if (result(); as r) {
      <div class="result" role="status">
        @if (r.created.length) {
          <span class="result__ok"><app-icon name="check" [size]="16" [strokeWidth]="2.2" />{{ plural(r.created.length, 'Seite', 'Seiten') }} hinzugefügt</span>
        }
        @if (r.duplicates.length) {
          <span>{{ r.duplicates.length }} schon vorhanden</span>
        }
        @if (r.invalid.length) {
          <span class="result__bad">{{ r.invalid.length }} ungültig: {{ r.invalid.join(', ') }}</span>
        }
      </div>
    }

    @if (list.loaded()) {
      <div class="list" role="list" aria-label="Webseiten">
        @for (s of list.items(); track s.id) {
          <app-source-item role="listitem" [source]="s" (changed)="list.replace($event)" (removed)="list.remove($event)" />
        } @empty {
          <div class="empty">
            <app-icon name="link" [size]="22" />
            <span><strong>Noch keine Webseiten.</strong><br />Leistungs-, Referenz- und Über-uns-Seiten sind ein guter Start.</span>
          </div>
        }
      </div>
      @if (list.hasMore()) {
        <button type="button" class="pill more" [disabled]="list.loading()" (click)="list.loadMore()">Weitere laden</button>
      }
    } @else if (list.loadFailed()) {
      <div class="state" role="alert">
        <p>Die Webseiten konnten nicht geladen werden.</p>
        <button type="button" class="pill" (click)="list.load()">Erneut versuchen</button>
      </div>
    } @else {
      <div class="state" aria-live="polite"><span class="loader" aria-hidden="true"></span></div>
    }
  `,
  styleUrl: './url-sources.scss',
})
export class UrlSources {
  private readonly api = inject(KnowledgeApi);
  private readonly store = inject(KnowledgeStore);

  readonly companyId = input.required<string>();
  /** Changes when the list has to reload (e.g. after retrying all failed sources) */
  readonly reloadKey = input(0);
  readonly list = createSourceList('url', this.companyId, this.reloadKey);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<CreateUrlsResult | null>(null);

  readonly form = new FormGroup({
    urls: new FormControl('', { nonNullable: true }),
    category: new FormControl<SourceCategory>('service', { nonNullable: true }),
  });
  private readonly urls = toSignal(this.form.controls.urls.valueChanges, { initialValue: '' });
  readonly lines = computed(() =>
    this.urls()
      .split(/\s+/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  protected readonly categories = CATEGORIES;
  protected readonly maxUrls = MAX_URLS;
  protected readonly plural = plural;

  add(): void {
    const urls = this.lines();
    if (!urls.length || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    this.api.createUrls(this.companyId(), { urls, category: this.form.controls.category.value }).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.result.set(result);
        // Keep what was not accepted, so it can be fixed
        this.form.controls.urls.setValue(result.invalid.join('\n'));
        if (result.created.length) {
          this.list.prepend(result.created);
          this.store.refresh();
        }
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Die Seiten konnten nicht hinzugefügt werden.'));
      },
    });
  }
}
