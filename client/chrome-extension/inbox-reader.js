/**
 * Runs inside the LinkedIn tab: waits for the conversation list and reads the
 * newest conversations. chrome.scripting.executeScript serializes the function,
 * so it must not use anything from outside its own body. Only reads the page,
 * never clicks or types.
 */
export async function readInbox(limit) {
  const LIST_TIMEOUT_MS = 20_000;
  // The list container is there, but no entry shows up: an empty inbox
  const EMPTY_AFTER_MS = 10_000;
  const ITEM = 'li.msg-conversation-listitem, li.msg-conversations-container__convo-item';
  const LIST = '.msg-conversations-container__conversations-list, .msg-conversations-container';
  const LOGIN_FORM = 'input[name="session_key"], form.login__form, .authwall-join-form';
  // "11:42", "28. Sep.", "Mo", "Gestern" – for the fallback without LinkedIn's classes
  const TIME_LIKE = /^(\d{1,2}:\d{2}( ?[ap]m)?|\d{1,2}\.? ?[a-zäöü]{3,4}\.?|(mo|di|mi|do|fr|sa|so|mon|tue|wed|thu|fri|sat|sun)\.?|gestern|heute|yesterday|today)$/i;
  const NAV_BADGE ='a.global-nav__primary-link[href*="/messaging"] .notification-badge--show .notification-badge__count';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value, max = 240) => {
    const text = (value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  // Text as shown, without LinkedIn's screen reader hints ("Status: online", …)
  const shown = (element) => {
    if (!element) return '';
    const copy = element.cloneNode(true);
    copy.querySelectorAll('.visually-hidden, .a11y-text, script, style').forEach((node) => node.remove());
    return copy.textContent ?? '';
  };
  const firstText = (root, selectors) => {
    for (const selector of selectors) {
      const text = clean(shown(root.querySelector(selector)));
      if (text) return text;
    }
    return '';
  };
  const number = (element) => {
    const n = parseInt((element?.textContent ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  const entries = () => {
    let found = [...document.querySelectorAll(ITEM)];
    if (!found.length) {
      // Fallback if LinkedIn renamed its classes: every entry that links to a conversation
      const links = [...document.querySelectorAll('a[href*="/messaging/thread/"]')].filter(
        (link) => !/\/thread\/new\b/.test(link.getAttribute('href') ?? ''),
      );
      found = [...new Set(links.map((link) => link.closest('li') ?? link))];
    }
    // Placeholder rows have no text yet
    return found.filter((entry) => clean(entry.innerText));
  };

  const started = Date.now();
  let found = [];
  while (Date.now() - started < LIST_TIMEOUT_MS) {
    if (document.querySelector(LOGIN_FORM)) return { status: 'signed_out' };
    found = entries();
    if (found.length) break;
    if (document.querySelector(LIST) && Date.now() - started > EMPTY_AFTER_MS) break;
    await sleep(400);
  }
  if (!found.length && !document.querySelector(LIST)) return { status: 'layout', page: location.pathname };
  if (found.length) {
    // Let the rest of the first batch render
    await sleep(700);
    found = entries();
  }

  const conversations = found.slice(0, limit).map((entry) => {
    const lines = (entry.innerText ?? '')
      .split('\n')
      .map((line) => clean(line))
      .filter(Boolean);
    const name =
      firstText(entry, ['.msg-conversation-listitem__participant-names', '.msg-conversation-card__participant-names', 'h3']) ||
      lines[0] ||
      '';
    const time =
      firstText(entry, ['time', '.msg-conversation-listitem__time-stamp', '.msg-conversation-card__time-stamp']) ||
      lines.find((line) => TIME_LIKE.test(line)) ||
      '';
    const snippet =
      firstText(entry, [
        '.msg-conversation-card__message-snippet',
        '.msg-conversation-card__message-snippet-body',
        '[class*="message-snippet"]',
      ]) ||
      lines.filter((line) => line !== name && line !== time).sort((a, b) => b.length - a.length)[0] ||
      '';
    const unread = entry.matches('[class*="unread"]') || Boolean(entry.querySelector('[class*="--unread"], .notification-badge--show'));
    const badge = number(entry.querySelector('.notification-badge--show .notification-badge__count, [class*="unread-count"]'));
    const link = entry.matches('a[href]') ? entry : entry.querySelector('a[href*="/messaging/thread/"]');
    const href = link?.getAttribute('href');
    return {
      name: clean(name, 120),
      snippet: clean(snippet),
      time: clean(time, 40),
      unread,
      unreadCount: unread ? Math.max(1, badge ?? 1) : 0,
      url: href ? new URL(href, location.origin).href : null,
    };
  });

  // The badge in LinkedIn's top bar also counts unread conversations further down the list
  const listed = conversations.filter((c) => c.unread).length;
  return {
    status: 'ok',
    unread: Math.max(number(document.querySelector(NAV_BADGE)) ?? 0, listed),
    conversations,
    checkedAt: new Date().toISOString(),
  };
}
