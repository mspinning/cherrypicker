import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, output, signal } from '@angular/core';
import { EXTENSION_FOLDER, packageExtension } from '../core/linkedin/extension-package';
import { LINKEDIN_STEPS, LINKEDIN_URL, LinkedInStep } from '../core/linkedin/linkedin.models';
import { LinkedInStore } from '../core/linkedin/linkedin.store';
import { Icon } from '../shared/icon';
import { formatTime, saveBlob } from '../shared/format';

const STEP_LABELS: Record<LinkedInStep, string> = {
  detect: 'Erweiterung suchen',
  open: 'LinkedIn öffnen',
  session: 'Anmeldung prüfen',
  read: 'Nachrichten lesen',
};
const MAX_CONVERSATIONS = 8;
const EXTENSIONS_PAGE = 'chrome://extensions';

/** Chrome, Edge, Brave … on a computer: the browsers that can load the extension. */
const CAN_INSTALL = 'chrome' in window && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

/** Popover under the header's LinkedIn button: installation, progress of a check and the inbox. */
@Component({
  selector: 'app-linkedin-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './linkedin-panel.html',
  styleUrl: './linkedin-panel.scss',
  host: {
    role: 'dialog',
    'aria-labelledby': 'linkedin-title',
    tabindex: '-1',
    '(keydown.escape)': 'closed.emit()',
  },
})
export class LinkedInPanel {
  readonly closed = output<void>();

  protected readonly store = inject(LinkedInStore);
  protected readonly steps = LINKEDIN_STEPS.map((id) => ({ id, label: STEP_LABELS[id] }));
  protected readonly canInstall = CAN_INSTALL;
  protected readonly folder = EXTENSION_FOLDER;
  protected readonly extensionsPage = EXTENSIONS_PAGE;
  protected readonly inboxUrl = `${LINKEDIN_URL}messaging/`;
  protected readonly time = formatTime;

  readonly downloading = signal(false);
  readonly downloadFailed = signal(false);
  readonly copied = signal(false);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  protected readonly stepIndex = computed(() => {
    const run = this.store.run();
    return run.state === 'running' ? LINKEDIN_STEPS.indexOf(run.step) : 0;
  });
  protected readonly failure = computed(() => {
    const run = this.store.run();
    return run.state === 'failed' ? run.message : '';
  });
  /** Unread first, otherwise in LinkedIn's order (newest first) */
  protected readonly conversations = computed(() => {
    const all = this.store.inbox()?.conversations ?? [];
    return [...all.filter((c) => c.unread), ...all.filter((c) => !c.unread)].slice(0, MAX_CONVERSATIONS);
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => host.nativeElement.focus());
  }

  download(): void {
    if (this.downloading()) return;
    this.downloading.set(true);
    this.downloadFailed.set(false);
    packageExtension()
      .then(
        (zip) => saveBlob(zip, `${EXTENSION_FOLDER}.zip`),
        () => this.downloadFailed.set(true),
      )
      .finally(() => this.downloading.set(false));
  }

  /** Web pages may not link to chrome:// pages, so the address goes to the clipboard. */
  async copyExtensionsPage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(EXTENSIONS_PAGE);
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 1800);
    } catch {
      // clipboard blocked – the address is still selectable
    }
  }
}
