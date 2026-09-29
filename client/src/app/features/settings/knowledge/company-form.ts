import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { GroupCompany } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { errorMessage } from './knowledge-format';

/** Creates a group company, or renames / re-describes an existing one. */
@Component({
  selector: 'app-company-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, Icon],
  template: `
    <form class="form" [formGroup]="form" (ngSubmit)="save()" (keydown.escape)="cancelled.emit()">
      <label class="field">
        <span class="field__label">Name</span>
        <input class="input js-name" formControlName="name" maxlength="120" autocomplete="organization" placeholder="z. B. JAAI Cloud GmbH" />
      </label>
      <label class="field">
        <span class="field__label">Kurzbeschreibung</span>
        <textarea
          class="textarea form__desc"
          formControlName="description"
          maxlength="2000"
          rows="3"
          placeholder="Was macht die Firma, für wen? Ein, zwei Sätze helfen Agenten, die richtige Firma zu wählen."
        ></textarea>
      </label>

      @if (error(); as message) {
        <div class="alert" role="alert">
          <app-icon name="alert" [size]="18" />
          <span>{{ message }}</span>
        </div>
      }

      <div class="form__actions">
        <button type="button" class="pill" (click)="cancelled.emit()">Abbrechen</button>
        <button type="submit" class="pill pill--primary" [disabled]="busy() || form.invalid">
          @if (busy()) {
            <span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
          }
          {{ company() ? 'Speichern' : 'Firma anlegen' }}
        </button>
      </div>
    </form>
  `,
  styles: `
    @use '../settings-ui' as ui;
    @include ui.buttons;
    @include ui.feedback;
    @include ui.forms;

    :host {
      display: block;
    }

    .form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .form__desc {
      min-height: 88px;
    }

    .form__actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class CompanyForm {
  private readonly api = inject(KnowledgeApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Set when editing */
  readonly company = input<GroupCompany | null>(null);
  /** The full company after creating, only the edited fields after an update */
  readonly saved = output<Pick<GroupCompany, 'id' | 'name' | 'description'> & Partial<GroupCompany>>();
  readonly cancelled = output<void>();

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    description: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] }),
  });

  constructor() {
    afterNextRender(() => {
      const c = this.company();
      if (c) this.form.reset({ name: c.name, description: c.description });
      this.host.nativeElement.querySelector<HTMLInputElement>('.js-name')?.focus();
    });
  }

  save(): void {
    if (this.form.invalid || this.busy()) return;
    const body = { name: this.form.controls.name.value.trim(), description: this.form.controls.description.value.trim() };
    if (!body.name) return;
    const existing = this.company();
    const request$ = existing ? this.api.updateCompany(existing.id, body) : this.api.createCompany(body);

    this.busy.set(true);
    this.error.set(null);
    request$.subscribe({
      next: (company) => {
        this.busy.set(false);
        this.saved.emit(company);
      },
      error: (err: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(err, 'Die Firma konnte nicht gespeichert werden.'));
      },
    });
  }
}
