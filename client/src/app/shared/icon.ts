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
  | 'copy'
  | 'settings'
  | 'users'
  | 'trash'
  | 'knowledge'
  | 'building'
  | 'link'
  | 'file'
  | 'upload'
  | 'text'
  | 'refresh'
  | 'download'
  | 'search'
  | 'plus'
  | 'external';

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
        @case ('settings') {
          <svg:path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <svg:circle cx="15" cy="7" r="2.2" />
          <svg:circle cx="9" cy="17" r="2.2" />
        }
        @case ('trash') {
          <svg:path d="M4.5 7h15M10 4h4M6.5 7l.8 11.5A2 2 0 0 0 9.3 20.5h5.4a2 2 0 0 0 2-1.9L17.5 7" />
          <svg:path d="M10 11v5.5M14 11v5.5" />
        }
        @case ('knowledge') {
          <svg:path d="M12 6.5C10.3 5.2 7.8 4.5 4 4.5v13c3.8 0 6.3.7 8 2 1.7-1.3 4.2-2 8-2v-13c-3.8 0-6.3.7-8 2z" />
          <svg:path d="M12 6.5v13" />
        }
        @case ('building') {
          <svg:path d="M4.5 20.5v-14l7-3v17M11.5 8.5h8v12" />
          <svg:path d="M3 20.5h18M8 9v.01M8 12.5v.01M8 16v.01M15.5 12.5v.01M15.5 16v.01" />
        }
        @case ('link') {
          <svg:path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
          <svg:path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
        }
        @case ('file') {
          <svg:path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <svg:path d="M14 3v5h5" />
        }
        @case ('upload') {
          <svg:path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5" />
          <svg:path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3" />
        }
        @case ('text') {
          <svg:path d="M4.5 6h15M4.5 10.5h15M4.5 15h10M4.5 19.5h7" />
        }
        @case ('refresh') {
          <svg:path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
          <svg:path d="M19.5 4.5v4h-4" />
        }
        @case ('download') {
          <svg:path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5" />
          <svg:path d="M4.5 19.5h15" />
        }
        @case ('search') {
          <svg:circle cx="11" cy="11" r="6.5" />
          <svg:path d="m20 20-4.2-4.2" />
        }
        @case ('plus') {
          <svg:path d="M12 5v14M5 12h14" />
        }
        @case ('external') {
          <svg:path d="M14 4.5h5.5V10M19.5 4.5 11 13" />
          <svg:path d="M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" />
        }
        @case ('users') {
          <svg:circle cx="9" cy="8.5" r="3.5" />
          <svg:path d="M2.5 19.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" />
          <svg:path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 14.4c2 .7 3.4 2.5 4 5.1" />
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
