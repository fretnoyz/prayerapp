import { render } from 'preact';
import { App, BootError } from './app.jsx';
import { db, init, addRequest, sweepExpired } from './db.js';
import { notify, toast, offerUpdate } from './store.js';
import { requestPersistence } from './storage.js';
import './style.css';

const root = document.getElementById('app');

async function boot() {
  try {
    await init();
  } catch (err) {
    console.warn('Could not open the prayer list database', err);
    render(<BootError error={err} />, root);
    return;
  }
  requestPersistence();

  // Siri Shortcut capture: ?add=<text>
  const params = new URLSearchParams(location.search);
  if (params.has('add')) {
    const text = params.get('add');
    params.delete('add');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
    const r = await addRequest(text);
    if (r) toast('Added to prayer list');
  }

  render(<App />, root);
  notify();

  // Safari may keep the page open for days: re-run the expiry sweep and refresh "today" on return.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      try {
        await sweepExpired();
      } catch {}
      notify();
    }
  });

  // A newer version of the app opened in another tab and upgraded the database.
  db.on('versionchange', (e) => {
    if (e.newVersion > db.verno) offerUpdate({ text: 'Updated in another tab', run: () => location.reload() });
  });
}

boot();

// ---------- service worker ----------

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let userAskedReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAskedReload) location.reload();
  });

  navigator.serviceWorker
    .register(import.meta.env.BASE_URL + 'sw.js')
    .then((reg) => {
      const offer = (worker) => {
        // No controller means this is the first install, not an update.
        if (!worker || !navigator.serviceWorker.controller) return;
        offerUpdate({
          text: 'Updated',
          run: () => {
            userAskedReload = true;
            worker.postMessage('skipWaiting');
            // If the worker already took over (another tab applied it), just reload.
            setTimeout(() => location.reload(), 1500);
          },
        });
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w &&
          w.addEventListener('statechange', () => {
            if (w.state === 'installed') offer(w);
          });
      });
      // Pages left open for days still pick up new versions.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
