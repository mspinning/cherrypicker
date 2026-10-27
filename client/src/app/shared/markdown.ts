import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';
import { marked } from 'marked';

/**
 * Renders Markdown. Angular's sanitizer strips scripts, event handlers and
 * javascript: links from the HTML before it reaches the DOM.
 */
@Component({
  selector: 'app-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: '',
  host: { '[innerHTML]': 'html()' },
  styleUrl: './markdown.scss',
})
export class Markdown {
  readonly text = input.required<string>();

  readonly html = computed(() => marked.parse(this.text(), { gfm: true, breaks: true, async: false }));
}
