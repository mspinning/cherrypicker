import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Icon } from '../../../shared/icon';
import { TodayStore } from '../today.store';
import { DecisionList } from './decision-list';

@Component({
  selector: 'app-done-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, DecisionList],
  host: { '[class.compact]': 'compact()' },
  template: `
    <svg class="badge" viewBox="0 0 84 84" fill="none" aria-hidden="true">
      <circle cx="42" cy="42" r="40" stroke="currentColor" stroke-width="2" />
      <path d="m27 43 10 10 21-22" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <h2 class="title">Das war's <em>für heute.</em></h2>
    <p class="text">
      {{ store.approvedCount() }} freigegeben, {{ store.rejectedCount() }} verworfen.
      Cherrypick meldet sich wieder, sobald etwas passiert, das deine Aufmerksamkeit wirklich verdient.
    </p>
    @if (compact()) {
      <app-decision-list [compact]="true" />
    }
    <button type="button" class="restart" (click)="store.reset()">
      @if (!compact()) {
        <app-icon name="undo" />
      }
      Demo neu starten
    </button>
  `,
  styles: `
    :host {
      position: relative;
      width: 540px;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 26px;
      text-align: center;
      animation: rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    :host(.compact) {
      width: 100%;
      max-width: 480px;
      flex-grow: 1;
      min-height: 0;
      overflow: auto;
      align-items: stretch;
      gap: 20px;
      padding: 16px 8px 40px;
      text-align: left;
    }

    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(14px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    .badge {
      width: 84px;
      height: 84px;
      flex-shrink: 0;
      color: var(--lime);
    }

    .title {
      margin: 0;
      font-family: var(--font-serif);
      font-weight: 400;
      font-size: 76px;
      line-height: 0.92;
      letter-spacing: -0.03em;

      em {
        color: var(--lime);
      }
    }

    .text {
      margin: 0;
      max-width: 400px;
      font-size: 16px;
      line-height: 1.55;
      color: var(--ink-muted);
      text-wrap: pretty;
    }

    .restart {
      flex-shrink: 0;
      height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 24px;
      border-radius: 99px;
      border: 1.5px solid var(--border-button);
      background-color: var(--surface-raised);
      font-size: 15px;
      font-weight: 500;
      transition: background-color 0.2s;

      &:hover {
        background-color: var(--line);
      }
    }

    :host(.compact) {
      .badge {
        width: 64px;
        height: 64px;
      }

      .title {
        font-size: 54px;
      }

      .text {
        max-width: none;
        font-size: 15px;
      }
    }
  `,
})
export class DonePanel {
  protected readonly store = inject(TodayStore);
  readonly compact = input(false);
}
