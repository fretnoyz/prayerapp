// Ask the browser not to evict our IndexedDB data under storage pressure.
// Safari and Chrome decide without prompting; asking again on later visits is harmless
// (Chrome grants it more readily once the site has been used for a while).

const api = () => (typeof navigator !== 'undefined' && navigator.storage) || null;

export async function requestPersistence() {
  const s = api();
  if (!s || !s.persist || !s.persisted) return;
  try {
    if (!(await s.persisted())) await s.persist();
  } catch {}
}

/** 'protected' | 'not protected' | 'unknown' */
export async function persistenceStatus() {
  const s = api();
  if (!s || !s.persisted) return 'unknown';
  try {
    return (await s.persisted()) ? 'protected' : 'not protected';
  } catch {
    return 'unknown';
  }
}
