import { useEffect, useState } from 'preact/hooks';

// Tiny change bus: any mutation calls notify(); views reload their data.
let version = 0;
const subs = new Set();
export function notify() {
  version++;
  subs.forEach((f) => f(version));
}
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
