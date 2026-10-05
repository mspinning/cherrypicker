import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Note } from '../../core/crm/crm.models';
import { formatDateTime } from '../../shared/format';
import { Icon } from '../../shared/icon';

/** What colleagues reported about conversations with a customer, newest first. */
@Component({
  selector: 'app-note-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <ul class="list">
      @for (n of notes(); track n.id) {
        <li class="item">
          <span class="mark" aria-hidden="true"><app-icon name="note" [size]="16" /></span>
          <div class="main">
            <div class="line">
              <span class="title">{{ n.title }}</span>
              <span class="date">{{ date(n.occurredAt) }}</span>
            </div>
            <div class="who">
              @if (n.author) {
                <span>von {{ n.author }}</span>
              }
              @if (showContact() && n.contact) {
                <a routerLink="." [queryParams]="{ contact: n.contact.id }" queryParamsHandling="merge">mit {{ n.contact.fullName }}</a>
              }
            </div>
            <p class="text">{{ n.text }}</p>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    @use 'mixins' as *;

    .list {
      @include reset-list;
      display: flex;
      flex-direction: column;
    }

    .item {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--surface-border);

      &:last-child {
        border-bottom: 0;
      }
    }

    .mark {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      background-color: var(--surface-raised);
      border: 1px solid var(--border-strong);
      color: var(--lime);
    }

    .main {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
    }

    .line {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    .title {
      min-width: 0;
      color: var(--ink);
      font-size: 14.5px;
      font-weight: 500;
    }

    .date {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--ink-muted);
    }

    .who {
      display: flex;
      flex-wrap: wrap;
      gap: 0 8px;
      font-size: 12.5px;
      color: var(--ink-muted);

      a {
        text-decoration: none;
      }
    }

    .text {
      margin: 2px 0 0;
      font-size: 13.5px;
      line-height: 1.5;
      color: var(--ink-soft);
      white-space: pre-line;
    }
  `,
})
export class NoteList {
  readonly notes = input.required<Note[]>();
  /** Off on a contact's own page */
  readonly showContact = input(true);

  protected readonly date = formatDateTime;
}
