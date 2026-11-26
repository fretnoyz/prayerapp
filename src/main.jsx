import { render } from 'preact';
import { App } from './app.jsx';
import { init, addRequest, sweepExpired } from './db.js';
import { notify, toast } from './store.js';
import './style.css';

async function boot() {
  await init();

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

  render(<App />, document.getElementById('app'));
  notify();

  // Safari may keep the page open for days: re-run the expiry sweep and refresh "today" on return.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await sweepExpired();
      notify();
    }
  });
}

boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
}
