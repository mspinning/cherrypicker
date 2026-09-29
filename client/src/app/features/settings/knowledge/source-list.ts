import { DestroyRef, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { KnowledgeApi } from '../../../core/knowledge/knowledge-api.service';
import { KnowledgeSource, SourceQuery, SourceType, isPending } from '../../../core/knowledge/knowledge.models';
import { KnowledgeStore } from './knowledge.store';

const PAGE_SIZE = 50;
const POLL_MS = 3_000;
/** Only vectors missing: that can take a while (or wait for Bifrost), poll less often */
const SLOW_POLL_EVERY = 5;

export type SourceFilters = Pick<SourceQuery, 'category' | 'state' | 'q'>;

/**
 * Paged list of one source type of one company. Polls while sources are
 * still in the pipeline, so status chips update on their own.
 * Call in an injection context (component field initializer).
 */
export function createSourceList(type: SourceType, companyId: Signal<string>, reloadKey?: Signal<number>) {
  const api = inject(KnowledgeApi);
  const store = inject(KnowledgeStore);

  const items = signal<KnowledgeSource[]>([]);
  const total = signal(0);
  const loaded = signal(false);
  const loading = signal(false);
  const loadFailed = signal(false);
  const filters = signal<SourceFilters>({});

  let request: Subscription | undefined;
  let ticks = 0;

  const fetch = (offset: number, limit: number, append: boolean) => {
    request?.unsubscribe();
    loading.set(true);
    loadFailed.set(false);
    request = api.sources(companyId(), { type, ...filters(), offset, limit }).subscribe({
      next: (page) => {
        const before = new Map(items().map((s) => [s.id, s.status]));
        items.set(append ? [...items(), ...page.items.filter((s) => !before.has(s.id))] : page.items);
        total.set(page.total);
        loaded.set(true);
        loading.set(false);
        // A status change moves the company counts as well
        if (!append && page.items.some((s) => before.has(s.id) && before.get(s.id) !== s.status)) store.refresh();
      },
      error: () => {
        loading.set(false);
        loadFailed.set(true);
      },
    });
  };

  const load = () => fetch(0, PAGE_SIZE, false);
  const loadMore = () => fetch(items().length, PAGE_SIZE, true);
  /** Reloads what is shown, keeping the pages loaded so far */
  const refresh = () => fetch(0, Math.min(Math.max(items().length, PAGE_SIZE), 200), false);

  // New company or other filters: start over
  effect(() => {
    companyId();
    filters();
    untracked(() => {
      items.set([]);
      loaded.set(false);
      load();
    });
  });

  // Reload from outside: keep showing the list meanwhile
  let lastKey: number | undefined;
  effect(() => {
    const key = reloadKey?.();
    untracked(() => {
      if (lastKey !== undefined && key !== lastKey) refresh();
      lastKey = key;
    });
  });

  const timer = setInterval(() => {
    if (document.hidden || loading()) return;
    const pending = items().filter(isPending);
    if (!pending.length) return;
    ticks++;
    const onlyVectors = pending.every((s) => s.status === 'embedding');
    if (!onlyVectors || ticks % SLOW_POLL_EVERY === 0) refresh();
  }, POLL_MS);
  inject(DestroyRef).onDestroy(() => {
    clearInterval(timer);
    request?.unsubscribe();
  });

  return {
    items: items.asReadonly(),
    total: total.asReadonly(),
    loaded: loaded.asReadonly(),
    loading: loading.asReadonly(),
    loadFailed: loadFailed.asReadonly(),
    filters,
    hasMore: computed(() => items().length < total()),
    load,
    loadMore,
    refresh,
    replace(source: KnowledgeSource) {
      items.update((list) => list.map((s) => (s.id === source.id ? { ...s, ...source, content: undefined } : s)));
    },
    prepend(sources: KnowledgeSource[]) {
      const ids = new Set(sources.map((s) => s.id));
      items.update((list) => [...sources, ...list.filter((s) => !ids.has(s.id))]);
      total.update((n) => n + sources.length);
    },
    remove(id: string) {
      items.update((list) => list.filter((s) => s.id !== id));
      total.update((n) => Math.max(0, n - 1));
    },
  };
}

export type SourceList = ReturnType<typeof createSourceList>;
