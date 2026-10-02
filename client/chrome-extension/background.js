import { readInbox } from './inbox-reader.js';

const LINKEDIN = 'https://www.linkedin.com';
// The compose view lists the conversations without opening one. Plain /messaging/
// opens the newest conversation, and LinkedIn would mark it as read.
const INBOX_URL = `${LINKEDIN}/messaging/thread/new/`;
const MAX_CONVERSATIONS = 12;
const LOAD_TIMEOUT_MS = 30_000;

let running = false;

chrome.runtime.onConnect.addListener((port) => {
  const crmTab = port.sender?.tab;
  if (port.name !== 'cherrypick' || crmTab?.id === undefined) {
    port.disconnect();
    return;
  }
  port.onMessage.addListener((message) => {
    if (message?.type === 'check') void check(port, crmTab);
    else if (message?.type === 'focus') void focus(port, crmTab);
    // 'keepalive' only resets the service worker's idle timer
  });
});

// Content scripts only reach pages loaded after the install: connect the CRM tabs that are already open
chrome.runtime.onInstalled.addListener(async () => {
  const [{ matches, js }] = chrome.runtime.getManifest().content_scripts;
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.allSettled(tabs.map((tab) => chrome.scripting.executeScript({ target: { tabId: tab.id }, files: js })));
});

/**
 * Opens LinkedIn with the browser's own session, checks that it is signed in and
 * reads the newest conversations. Never signs in, never clicks or types anything.
 */
async function check(port, crmTab) {
  const send = (message) => {
    try {
      port.postMessage(message);
    } catch {
      // CRM tab closed or navigated away meanwhile
    }
  };
  if (running) {
    send({ kind: 'error', code: 'busy' });
    return;
  }
  running = true;
  let linkedInTab = null;
  try {
    send({ kind: 'progress', step: 'open' });
    linkedInTab = await openInbox(crmTab);
    await loaded(linkedInTab.id);

    send({ kind: 'progress', step: 'session' });
    const session = sessionOf((await chrome.tabs.get(linkedInTab.id)).url);
    if (session !== 'ok') {
      send({ kind: 'result', result: { status: session } });
      return;
    }

    send({ kind: 'progress', step: 'read' });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: linkedInTab.id },
      func: readInbox,
      args: [MAX_CONVERSATIONS],
    });
    send({ kind: 'result', result: injection?.result ?? { status: 'layout' } });
  } catch (err) {
    send({ kind: 'error', code: err?.code ?? 'failed', message: String(err?.message ?? err) });
  } finally {
    running = false;
    if (linkedInTab) await show(crmTab);
  }
}

/** Brings LinkedIn to the front: the most recently used LinkedIn tab, otherwise a new one. */
async function focus(port, crmTab) {
  try {
    const [tab] = await linkedInTabs(`${LINKEDIN}/*`);
    if (tab) await show(tab);
    else await chrome.tabs.create({ url: `${LINKEDIN}/messaging/`, ...nextTo(crmTab) });
    port.postMessage({ kind: 'result', result: { ok: true } });
  } catch (err) {
    port.postMessage({ kind: 'error', code: 'failed', message: String(err?.message ?? err) });
  }
}

/**
 * The tab stays in the foreground while reading: Chrome pauses rendering in
 * background tabs, and LinkedIn would not build the list there.
 */
async function openInbox(crmTab) {
  // An open messaging tab already shows the list; reloading it could cost the user a draft
  const [existing] = await linkedInTabs(`${LINKEDIN}/messaging/*`);
  if (existing) {
    await show(existing);
    return existing;
  }
  return chrome.tabs.create({ url: INBOX_URL, ...nextTo(crmTab) });
}

async function linkedInTabs(pattern) {
  const tabs = await chrome.tabs.query({ url: pattern });
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

function nextTo(tab) {
  return { windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id, active: true };
}

async function show(tab) {
  try {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  } catch {
    // Tab or window closed meanwhile
  }
}

function loaded(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(failure('timeout')), LOAD_TIMEOUT_MS);
    const onUpdated = (id, change) => {
      if (id === tabId && change.status === 'complete') done();
    };
    const onRemoved = (id) => {
      if (id === tabId) done(failure('tab_closed'));
    };
    function done(error) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error);
      else resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // A reused tab may have finished loading long ago
    chrome.tabs.get(tabId).then(
      (tab) => tab.status === 'complete' && !tab.discarded && done(),
      () => done(failure('tab_closed')),
    );
  });
}

/** Where LinkedIn sent us tells whether the browser has a session. */
function sessionOf(url) {
  let page;
  try {
    page = new URL(url);
  } catch {
    // No URL: the tab left linkedin.com (no host permission there)
    return 'signed_out';
  }
  if (page.hostname !== 'www.linkedin.com') return 'signed_out';
  if (page.pathname.startsWith('/checkpoint/challenge')) return 'challenge';
  if (/^\/(login|uas\/|authwall|checkpoint\/|signup|start\/)/.test(page.pathname)) return 'signed_out';
  return 'ok';
}

function failure(code) {
  return Object.assign(new Error(code), { code });
}
