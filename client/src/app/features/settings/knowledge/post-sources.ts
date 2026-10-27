import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { KnowledgeSource } from '../../../core/knowledge/knowledge.models';
import { Icon } from '../../../shared/icon';
import { KnowledgeStore } from './knowledge.store';
import { PostEditor } from './post-editor';
import { createSourceList } from './source-list';
import { SourceItem } from './source-item';

/** Newest first by the date of the news, like the server lists them */
const byDate = (a: KnowledgeSource, b: KnowledgeSource) =>
  (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || b.createdAt.localeCompare(a.createdAt);

/** Blog: dated news about the company and its products, written in Markdown. */
@Component({
  selector: 'app-post-sources',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, SourceItem, PostEditor],
  template: `
    <div class="section__head">
      <p class="section__hint">
        Neuigkeiten zur Firma und ihren Produkten: neue Versionen, Partnerschaften, Auszeichnungen. Das Datum sagt Agenten, wie aktuell
        eine Nachricht ist.
      </p>
      @if (editing() === null) {
        <button type="button" class="pill pill--primary pill--small" (click)="editing.set('new')">
          <app-icon name="plus" [size]="16" [strokeWidth]="2.2" />
          Beitrag schreiben
        </button>
      }
    </div>

    @if (editing() === 'new') {
      <app-post-editor [companyId]="companyId()" (saved)="created($event)" (cancelled)="editing.set(null)" />
    }

    @if (list.loaded()) {
      <div class="list" role="list" aria-label="Blog-Beiträge">
        @for (s of list.items(); track s.id) {
          @if (editing() === s.id) {
            <app-post-editor [companyId]="companyId()" [source]="s" (saved)="updated($event)" (cancelled)="editing.set(null)" />
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
              <app-icon name="news" [size]="22" />
              <span><strong>Noch keine Beiträge.</strong><br />Halte hier fest, was es Neues gibt, mit Datum.</span>
            </div>
          }
        }
      </div>
      @if (list.hasMore()) {
        <button type="button" class="pill more" [disabled]="list.loading()" (click)="list.loadMore()">Weitere laden</button>
      }
    } @else if (list.loadFailed()) {
      <div class="state" role="alert">
        <p>Die Beiträge konnten nicht geladen werden.</p>
        <button type="button" class="pill" (click)="list.load()">Erneut versuchen</button>
      </div>
    } @else {
      <div class="state" aria-live="polite"><span class="loader" aria-hidden="true"></span></div>
    }
  `,
  styleUrl: './sources.scss',
})
export class PostSources {
  private readonly store = inject(KnowledgeStore);

  readonly companyId = input.required<string>();
  /** Changes when the list has to reload (e.g. after retrying all failed sources) */
  readonly reloadKey = input(0);
  /** 'new', the id of the post being edited, or null */
  readonly editing = signal<string | null>(null);
  readonly list = createSourceList('post', this.companyId, this.reloadKey, byDate);

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
