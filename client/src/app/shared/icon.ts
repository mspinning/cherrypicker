import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'mail'
  | 'call'
  | 'offer'
  | 'meeting'
  | 'check'
  | 'close'
  | 'edit'
  | 'undo'
  | 'clock'
  | 'help'
  | 'back'
  | 'arrow'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'alert'
  | 'logout'
  | 'copy';

/** Inline stroke icons (24px grid, currentColor). */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: ':host { display: inline-flex; flex-shrink: 0; }',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      @switch (name()) {
        @case ('mail') {
          <svg:rect x="3" y="5" width="18" height="14" rx="2.5" />
          <svg:path d="m3.5 7.5 8.5 6 8.5-6" />
        }
        @case ('call') {
          <svg:path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
        }
        @case ('offer') {
          <svg:path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <svg:path d="M14 3v5h5" />
          <svg:path d="M9 13h6M9 17h4" />
        }
        @case ('meeting') {
          <svg:rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <svg:path d="M3.5 10h17M8 3v4M16 3v4" />
        }
        @case ('check') {
          <svg:path d="m5 12.5 4.5 4.5L19 7.5" />
        }
        @case ('close') {
          <svg:path d="M6 6l12 12M18 6 6 18" />
        }
        @case ('edit') {
          <svg:path d="M4 20h4L19 9l-4-4L4 16z" />
          <svg:path d="m13.5 6.5 4 4" />
        }
        @case ('undo') {
          <svg:path d="M9 14 4 9l5-5" />
          <svg:path d="M4 9h11a5 5 0 0 1 0 10h-3" />
        }
        @case ('clock') {
          <svg:circle cx="12" cy="12" r="9" />
          <svg:path d="M12 7v5l3 2" />
        }
        @case ('help') {
          <svg:circle cx="12" cy="12" r="9" />
          <svg:path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3" />
          <svg:path d="M12 17h.01" />
        }
        @case ('back') {
          <svg:path d="M15 18 9 12l6-6" />
        }
        @case ('arrow') {
          <svg:path d="M5 12h14M13 6l6 6-6 6" />
        }
        @case ('eye') {
          <svg:path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
          <svg:circle cx="12" cy="12" r="3" />
        }
        @case ('eye-off') {
          <svg:path d="M4 4l16 16" />
          <svg:path d="M10.6 5.6A9.9 9.9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.6 6.7A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.5 4.6-1.3" />
          <svg:path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        }
        @case ('lock') {
          <svg:rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
          <svg:path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
        }
        @case ('alert') {
          <svg:circle cx="12" cy="12" r="9" />
          <svg:path d="M12 7.5v5.5M12 16.5h.01" />
        }
        @case ('logout') {
          <svg:path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" />
          <svg:path d="M10 16l-4-4 4-4M6 12h10" />
        }
        @case ('copy') {
          <svg:rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
          <svg:path d="M15.5 8.5V6.5A2 2 0 0 0 13.5 4.5h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly strokeWidth = input(1.8);
}
