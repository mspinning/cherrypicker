import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { KnowledgeSource } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { KnowledgeStore } from './knowledge.store';
import { createSourceList } from './source-list';
import { SourceItem } from './source-item';
import { TextEditor } from './text-editor';

/** Texts written directly in the CRM: service descriptions, pitch, conditions. */
@Component({
  selector: 'app-text-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, SourceItem, TextEditor],
  template: `
    <div class="section__head">
      <p class="section__hint">
        Beschreibe Leistungen, Zielgruppen, Preise und Besonderheiten so, wie du es einer neuen Kollegin erklären würdest.
      </p>
      @if (editing() === null) {
        <button type="button" class="pill pill--primary pill--small" (click)="editing.set('new')">
          <app-icon name="plus" [size]="16" [strokeWidth]="2.2" />
          Text hinzufügen
        </button>
      }
    </div>

    @if (editing() === 'new') {
      <app-text-editor [companyId]="companyId()" (saved)="created($event)" (cancelled)="editing.set(null)" />
    }

    @if (list.loaded()) {
      <div class="list" role="list" aria-label="Texte">
        @for (s of list.items(); track s.id) {
          @if (editing() === s.id) {
            <app-text-editor [companyId]="companyId()" [source]="s" (saved)="updated($event)" (cancelled)="editing.set(null)" />
          } @else {
            <app-source-item
              role="listitem"
              [source]="s"
              [contentEditable]="true"
              (editContent)="editing.set($event.id)"
              (changed)="list.replace($event)"
              (removed)="list.remove($event)"
            />
          }
        } @empty {
          @if (editing() !== 'new') {
            <div class="empty">
              <app-icon name="text" [size]="22" />
              <span><strong>Noch keine Texte.</strong><br />Ein kurzer Text pro Leistung reicht für den Anfang.</span>
            </div>
          }
        }
      </div>
      @if (list.hasMore()) {
        <button type="button" class="pill more" [disabled]="list.loading()" (click)="list.loadMore()">Weitere laden</button>
      }
    } @else if (list.loadFailed()) {
      <div class="state" role="alert">
        <p>Die Texte konnten nicht geladen werden.</p>
        <button type="button" class="pill" (click)="list.load()">Erneut versuchen</button>
      </div>
    } @else {
      <div class="state" aria-live="polite"><span class="loader" aria-hidden="true"></span></div>
    }
  `,
  styleUrl: './sources.scss',
})
export class TextSources {
  private readonly store = inject(KnowledgeStore);

  readonly companyId = input.required<string>();
  /** Changes when the list has to reload (e.g. after retrying all failed sources) */
  readonly reloadKey = input(0);
  /** 'new', the id of the text being edited, or null */
  readonly editing = signal<string | null>(null);
  readonly list = createSourceList('text', this.companyId, this.reloadKey);

  created(source: KnowledgeSource): void {
    this.editing.set(null);
    this.list.prepend([source]);
    this.store.refresh();
  }

  updated(source: KnowledgeSource): void {
    this.editing.set(null);
    this.list.replace(source);
  }
}
