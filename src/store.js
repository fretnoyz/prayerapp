import { useEffect, useState } from 'preact/hooks';

// Tiny change bus: any mutation calls notify(); views reload their data.
// notify() also tells other open tabs (each Siri run opens a new Safari tab) to reload theirs.
let version = 0;
const subs = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('prayerapp-changes') : null;

function bump() {
  version++;
  subs.forEach((f) => f(version));
}
export function notify() {
  bump();
  try {
    channel && channel.postMessage('changed');
  } catch {}
}
// A message from another tab only refreshes this tab; it is never re-broadcast, so there are no loops.
// (BroadcastChannel never delivers a message back to the tab that sent it.)
if (channel) channel.onmessage = () => bump();

export function useVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    subs.add(setV);
    return () => subs.delete(setV);
  }, []);
  return v;
}

export function useData(loader, deps = []) {
  const v = useVersion();
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    loader().then((d) => alive && setData(d));
    return () => (alive = false);
  }, [v, ...deps]);
  return data;
}

// Small observable value: [get, set, useIt]
function signal(initial) {
  let value = initial;
  const listeners = new Set();
  const set = (v) => {
    value = v;
    listeners.forEach((f) => f(v));
  };
  const use = () => {
    const [v, setV] = useState(value);
    useEffect(() => {
      listeners.add(setV);
      setV(value);
      return () => listeners.delete(setV);
    }, []);
    return v;
  };
  return [() => value, set, use];
}

// "Updated — reload" offer: null, or { text, run } where run() applies the update.
const [, setUpdate, useUpdateSignal] = signal(null);
export const offerUpdate = setUpdate;
export const useUpdate = useUpdateSignal;

// Toasts: { text, action?: { label, run }, ms }
let toastSub = null;
let pending = null;
export function toast(text, action = null, ms = 3000) {
  const t = { id: Math.random(), text, action, ms };
  if (toastSub) toastSub(t);
  else pending = t;
}
export function useToast() {
  const [t, setT] = useState(pending);
  useEffect(() => {
    toastSub = setT;
    pending = null;
    const clear = () => setT(null); // a toast's action belongs to the screen that raised it
    addEventListener('hashchange', clear);
    return () => {
      toastSub = null;
      removeEventListener('hashchange', clear);
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => setT(null), t.ms);
    return () => clearTimeout(h);
  }, [t]);
  return [t, setT];
}

// Hash router
export function useRoute() {
  const get = () => (location.hash.replace(/^#\/?/, '') || 'today').split('/');
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path) => (location.hash = '#/' + path);
