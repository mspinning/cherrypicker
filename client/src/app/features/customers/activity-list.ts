import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Activity } from '../../core/crm/crm.models';
import { Icon } from '../../shared/icon';
import { formatDateTime } from '../../shared/format';

/** Mails with a customer from the own mailbox, newest first. */
@Component({
  selector: 'app-activity-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    @if (activities().length) {
      <ul class="list">
        @for (a of activities(); track a.id) {
          <li class="item" [attr.data-dir]="a.direction">
            <span class="dir" [attr.aria-label]="a.direction === 'in' ? 'Eingang' : 'Ausgang'">
              <app-icon [name]="a.direction === 'in' ? 'inbound' : 'outbound'" [size]="16" />
            </span>
            <div class="main">
              <div class="line">
                @if (a.webLink) {
                  <a class="subject" [href]="a.webLink" target="_blank" rel="noopener" title="In Outlook öffnen">{{ a.subject || '(ohne Betreff)' }}</a>
                } @else {
                  <span class="subject">{{ a.subject || '(ohne Betreff)' }}</span>
                }
                <span class="date">{{ date(a.occurredAt) }}</span>
              </div>
              @if (showContact() && a.contact) {
                <a class="who" routerLink="." [queryParams]="{ contact: a.contact.id }" queryParamsHandling="merge">
                  {{ a.direction === 'in' ? 'von' : 'an' }} {{ a.contact.fullName }}
                </a>
              }
              @if (a.preview) {
                <p class="preview">{{ a.preview }}</p>
              }
            </div>
          </li>
        }
      </ul>
    } @else {
      <p class="empty">Keine Mails aus deinem Postfach.</p>
    }
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

    .dir {
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

    [data-dir='out'] .dir {
      color: var(--ink-soft);
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

    .subject {
      min-width: 0;
      color: var(--ink);
      font-size: 14.5px;
      font-weight: 500;
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    a.subject:hover {
      color: var(--lime-hover);
    }

    .date {
      flex-shrink: 0;
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--ink-muted);
    }

    .who {
      align-self: flex-start;
      font-size: 12.5px;
      text-decoration: none;
    }

    .preview {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: var(--ink-muted);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .empty {
      margin: 0;
      font-size: 13.5px;
      color: var(--ink-muted);
    }
  `,
})
export class ActivityList {
  readonly activities = input.required<Activity[]>();
  /** Off on a contact's own page */
  readonly showContact = input(true);

  protected readonly date = formatDateTime;
}
