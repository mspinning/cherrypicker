// Runs on the CRM pages (content_scripts in manifest.json). Relays requests from
// the page to the background worker and its answers back, both via window.postMessage.
(() => {
  const CHANNEL = 'cherrypick-linkedin';
  // Messages on the port keep the service worker awake during a longer run
  const KEEPALIVE_MS = 10_000;

  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  // background.js injects the bridge again after an install or update; one live copy is enough
  if (globalThis.cherrypickBridge?.alive()) return;
  globalThis.cherrypickBridge = { alive };

  const version = chrome.runtime.getManifest().version;
  const reply = (message) => window.postMessage({ channel: CHANNEL, from: 'extension', ...message }, location.origin);

  function relay(id, type) {
    let port;
    try {
      port = chrome.runtime.connect({ name: 'cherrypick' });
    } catch {
      reply({ id, kind: 'error', code: 'stale' });
      return;
    }
    let settled = false;
    const keepalive = setInterval(() => {
      try {
        port.postMessage({ type: 'keepalive' });
      } catch {
        clearInterval(keepalive);
      }
    }, KEEPALIVE_MS);

    port.onMessage.addListener((message) => {
      if (message.kind !== 'progress') {
        settled = true;
        clearInterval(keepalive);
        port.disconnect();
      }
      reply({ id, ...message });
    });
    port.onDisconnect.addListener(() => {
      clearInterval(keepalive);
      if (!settled) reply({ id, kind: 'error', code: 'disconnected' });
    });
    port.postMessage({ type });
  }

  function onMessage(event) {
    if (event.source !== window || event.origin !== location.origin) return;
    const { channel, from, id, type } = event.data ?? {};
    if (channel !== CHANNEL || from !== 'page' || typeof id !== 'string') return;
    // The extension was updated or removed: this copy is orphaned and stays silent,
    // a fresh copy answers (or none, then the page offers the installation)
    if (!alive()) {
      window.removeEventListener('message', onMessage);
      return;
    }
    if (type === 'hello') reply({ id, kind: 'result', result: { version } });
    else if (type === 'check' || type === 'focus') relay(id, type);
  }

  window.addEventListener('message', onMessage);
  reply({ kind: 'ready', version });
})();
