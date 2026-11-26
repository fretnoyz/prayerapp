import { useEffect, useRef, useState } from 'preact/hooks';
import * as db from './db.js';
import { notify, toast, useData, useRoute, useToast, go } from './store.js';

// ---------- helpers ----------

const run = (fn) => async (...a) => {
  await fn(...a);
  notify();
};

function ago(iso) {
  if (!iso) return '';
  const days = Math.round((db.startOfDay(db.now()) - db.startOfDay(new Date(iso).getTime())) / db.DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 0) return '';
  return `${days} days ago`;
}
function until(iso) {
  const days = Math.round((db.startOfDay(new Date(iso).getTime()) - db.startOfDay(db.now())) / db.DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const isToday = (iso) => iso && db.startOfDay(new Date(iso).getTime()) === db.startOfDay(db.now());

// ---------- shell ----------

export function App() {
  const route = useRoute();
  const [page, id] = route;
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef();

  const openAdd = () => {
    setAddOpen(true);
    addRef.current && addRef.current.focus(); // synchronous focus so iOS raises the keyboard
  };

  useEffect(() => {
    if (page === 'add') {
      openAdd();
      history.replaceState(null, '', '#/today');
    }
  }, [page]);

  let view;
  if (page === 'request' && id) view = <Detail id={id} />;
  else if (page === 'archive') view = <Archive />;
  else if (page === 'settings') view = <Settings />;
  else view = <Today />;

  const tab = page === 'archive' || page === 'settings' ? page : page === 'request' ? '' : 'today';

  return (
    <>
      <main>{view}</main>
      {tab === 'today' && (
        <button class="fab" aria-label="Add prayer request" onClick={openAdd}>
          +
        </button>
      )}
      <nav class="tabs">
        <a href="#/today" class={tab === 'today' ? 'on' : ''}>Today</a>
        <a href="#/archive" class={tab === 'archive' ? 'on' : ''}>Archive</a>
        <a href="#/settings" class={tab === 'settings' ? 'on' : ''}>Settings</a>
      </nav>
      <QuickAdd open={addOpen} inputRef={addRef} onClose={() => setAddOpen(false)} />
      <Toast />
    </>
  );
}

function Toast() {
  const [t, setT] = useToast();
  if (!t) return null;
  return (
    <div class="toast" role="status" key={t.id} style={{ animationDuration: t.ms + 'ms' }}>
      <span>{t.text}</span>
      {t.action && (
        <button
          class="link"
          onClick={() => {
            setT(null);
            t.action.run();
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Text prompt sheet (used for notes and answer notes)
function PromptSheet({ title, placeholder, okLabel = 'Save', onOk, onClose, allowEmpty = false }) {
  const [text, setText] = useState('');
  const ref = useRef();
  useEffect(() => ref.current && ref.current.focus(), []);
  const ok = async () => {
    if (!allowEmpty && !text.trim()) return;
    await onOk(text);
    onClose();
  };
  return (
    <Sheet title={title} onClose={onClose}>
      <textarea ref={ref} rows={3} placeholder={placeholder} value={text} onInput={(e) => setText(e.target.value)} />
      <div class="row-btns">
        <button class="ghost" onClick={onClose}>Cancel</button>
        <button class="primary" onClick={ok}>{okLabel}</button>
      </div>
    </Sheet>
  );
}

function ConfirmSheet({ title, body, okLabel, onOk, onClose, danger }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {body && <p>{body}</p>}
      <div class="row-btns">
        <button class="ghost" onClick={onClose}>Cancel</button>
        <button
          class={danger ? 'danger' : 'primary'}
          onClick={async () => {
            await onOk();
            onClose();
          }}
        >
          {okLabel}
        </button>
      </div>
    </Sheet>
  );
}

// ---------- Quick Add (always mounted so focus() can raise the keyboard) ----------

function QuickAdd({ open, inputRef, onClose }) {
  const [text, setText] = useState('');
  const [sectionId, setSectionId] = useState(null);
  const sections = useData(db.listSections) || [];

  const close = () => {
    setText('');
    setSectionId(null);
    inputRef.current && inputRef.current.blur();
    onClose();
  };
  const save = async (e) => {
    e && e.preventDefault();
    if (!text.trim()) return;
    await db.addRequest(text, sectionId);
    notify();
    toast('Added to prayer list');
    close();
  };

  return (
    <div class={'backdrop quickadd' + (open ? ' open' : '')} aria-hidden={!open} onClick={(e) => e.target === e.currentTarget && close()}>
      <form class="sheet" onSubmit={save}>
        <h2>New prayer request</h2>
        <input
          ref={inputRef}
          type="text"
          enterkeyhint="done"
          placeholder="Who and what? (tap the mic to speak)"
          value={text}
          tabIndex={open ? 0 : -1}
          onInput={(e) => setText(e.target.value)}
        />
        <div class="chips">
          <button type="button" class={'chip' + (sectionId === null ? ' on' : '')} onClick={() => setSectionId(null)}>
            Unsorted
          </button>
          {sections.map((s) => (
            <button type="button" key={s.id} class={'chip' + (sectionId === s.id ? ' on' : '')} onClick={() => setSectionId(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
        <div class="row-btns">
          <button type="button" class="ghost" onClick={close}>Cancel</button>
          <button type="submit" class="primary" disabled={!text.trim()}>Save</button>
        </div>
      </form>
    </div>
  );
}

// ---------- Today ----------

async function loadToday() {
  const [sections, active, stats, settings] = await Promise.all([
    db.listSections(),
    db.listByStatus(['active']),
    db.prayerStats(),
    db.getSettings(),
  ]);
  active.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const prayedToday = {};
  for (const p of await db.db.prayers.where('prayedAt').aboveOrEqual(new Date(db.startOfDay(db.now())).toISOString()).toArray()) {
    if (!p.deletedAt) prayedToday[p.requestId] = p.id;
  }
  const soonCutoff = new Date(db.now() + settings.alertLeadDays * db.DAY).toISOString();
  const expiring = active.filter((r) => r.expiresAt && r.expiresAt <= soonCutoff);
  const known = new Set(sections.map((s) => s.id));
  const groups = [];
  const unsorted = active.filter((r) => !r.sectionId || !known.has(r.sectionId));
  if (unsorted.length) groups.push({ id: 'unsorted', name: 'Unsorted', items: unsorted });
  for (const s of sections) {
    const items = active.filter((r) => r.sectionId === s.id);
    if (items.length) groups.push({ id: s.id, name: s.name, items });
  }
  return { groups, stats, prayedToday, expiring, total: active.length, settings };
}

function Today() {
  const data = useData(loadToday);
  const [showExpiring, setShowExpiring] = useState(false);
  const [noteFor, setNoteFor] = useState(null);
  const [answerFor, setAnswerFor] = useState(null);
  if (!data) return null;
  const { groups, stats, prayedToday, expiring, total } = data;
  const doneCount = Object.keys(prayedToday).filter((id) => groups.some((g) => g.items.some((r) => r.id === id))).length;

  const pray = async (r) => {
    const existing = prayedToday[r.id];
    if (existing) {
      await db.undoPrayer(existing);
      notify();
      return;
    }
    const p = await db.logPrayer(r.id);
    notify();
    toast('Prayed', { label: 'Add note', run: () => setNoteFor({ req: r, prayerId: p.id }) }, 5000);
  };

  return (
    <section class="today">
      <header class="page-head">
        <h1>Prayer List</h1>
        <p class="sub">
          {new Date(db.now()).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          {total > 0 && <span class="no-print"> · {doneCount} of {total} prayed</span>}
        </p>
      </header>

      {expiring.length > 0 && (
        <div class="banner no-print">
          <button class="banner-head" onClick={() => setShowExpiring(!showExpiring)}>
            {expiring.length} {expiring.length === 1 ? 'request' : 'requests'} expiring soon
            <span class="chev">{showExpiring ? '▴' : '▾'}</span>
          </button>
          {showExpiring && (
            <ul class="expiring">
              {expiring.map((r) => (
                <li key={r.id}>
                  <div class="exp-text">
                    {r.text}
                    <span class="meta">expires {until(r.expiresAt)}</span>
                  </div>
                  <div class="row-btns tight">
                    <button class="ghost" onClick={run(() => db.extendRequest(r.id))}>Extend</button>
                    <button class="primary" onClick={() => setAnswerFor(r)}>Answered</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {total === 0 && (
        <div class="empty">
          <p>No requests yet.</p>
          <p class="meta">Tap + to add one, or use the Siri Shortcut.</p>
        </div>
      )}

      {groups.map((g) => (
        <div class="group" key={g.id}>
          <h3>{g.name}</h3>
          <ul class="list">
            {g.items.map((r) => {
              const s = stats[r.id];
              const done = !!prayedToday[r.id];
              return (
                <li key={r.id} class={done ? 'done' : ''}>
                  <button
                    class="check"
                    aria-label={done ? 'Prayed today (tap to undo)' : 'Mark prayed'}
                    aria-pressed={done}
                    onClick={() => pray(r)}
                  >
                    <span>{done ? '✓' : ''}</span>
                  </button>
                  <a class="item" href={'#/request/' + r.id}>
                    <span class="text">{r.text}</span>
                    <span class="meta no-print">{s ? `${s.count}× · ${ago(s.last)}` : 'not yet prayed'}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {total > 0 && (
        <p class="print-link no-print">
          <button class="link" onClick={() => window.print()}>Print this list</button>
        </p>
      )}

      {noteFor && (
        <PromptSheet
          title="Note"
          placeholder={noteFor.req.text}
          onOk={(t) => db.addNote(noteFor.req.id, t, noteFor.prayerId).then(notify)}
          onClose={() => setNoteFor(null)}
        />
      )}
      {answerFor && (
        <PromptSheet
          title="How did God answer?"
          placeholder="Optional"
          okLabel="Mark answered"
          allowEmpty
          onOk={(t) => db.markAnswered(answerFor.id, t).then(notify)}
          onClose={() => setAnswerFor(null)}
        />
      )}
    </section>
  );
}

// ---------- Detail ----------

function Detail({ id }) {
  const data = useData(async () => ({ bundle: await db.getRequestBundle(id), sections: await db.listSections() }), [id]);
  const [sheet, setSheet] = useState(null);
  const [text, setText] = useState(null);
  if (!data) return null;
  if (!data.bundle) {
    return (
      <section>
        <p class="empty">This request no longer exists.</p>
        <a href="#/today">Back to list</a>
      </section>
    );
  }
  const { req, prayers, notes } = data.bundle;
  const value = text ?? req.text;
  const saveText = run(async () => {
    if (value.trim() && value.trim() !== req.text) await db.updateRequest(id, { text: value.trim() });
    setText(null);
  });

  return (
    <section class="detail">
      <button class="back link" onClick={() => history.back()}>‹ Back</button>
      <textarea class="title-edit" rows={Math.max(1, Math.ceil(value.length / 28))} value={value} onInput={(e) => setText(e.target.value)} onBlur={saveText} />

      <div class="facts">
        <span class={'pill ' + req.status}>{req.status}</span>
        <span>Added {fmtDate(req.createdAt)}</span>
        {req.status === 'active' && (req.expiresAt ? <span>Expires {until(req.expiresAt)}</span> : <span>Never expires</span>)}
        {req.answeredAt && <span>Answered {fmtDate(req.answeredAt)}</span>}
      </div>

      {req.answerNote && (
        <blockquote class="answer">
          <strong>How God answered</strong>
          <p>{req.answerNote}</p>
        </blockquote>
      )}

      {req.status === 'active' && (
        <label class="field">
          Section
          <select value={req.sectionId || ''} onChange={run((e) => db.updateRequest(id, { sectionId: e.target.value || null }))}>
            <option value="">Unsorted</option>
            {data.sections.map((s) => (
              <option value={s.id} key={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      )}

      <div class="row-btns wrap">
        {req.status === 'active' ? (
          <>
            <button class="ghost" onClick={run(async () => { await db.logPrayer(id); toast('Prayed'); })}>Prayed</button>
            <button class="ghost" onClick={run(async () => { await db.extendRequest(id); toast('Extended'); })}>Extend</button>
            <button class="primary" onClick={() => setSheet('answer')}>Mark answered</button>
          </>
        ) : (
          <button class="ghost" onClick={run(async () => { await db.reactivate(id); toast('Back on the list'); })}>
            Return to list
          </button>
        )}
      </div>

      <h3>Notes</h3>
      {notes.length === 0 && <p class="meta">No notes yet.</p>}
      <ul class="notes">
        {notes.map((n) => (
          <li key={n.id}>
            <span class="meta">{fmtDateTime(n.createdAt)}{n.prayerId ? ' · after prayer' : ''}</span>
            <p>{n.text}</p>
          </li>
        ))}
      </ul>
      <button class="ghost" onClick={() => setSheet('note')}>Add note</button>

      <h3>Prayed {prayers.length} {prayers.length === 1 ? 'time' : 'times'}</h3>
      <ul class="history">
        {prayers.map((p) => (
          <li key={p.id}>{fmtDateTime(p.prayedAt)}</li>
        ))}
      </ul>

      <p class="delete">
        <button class="link danger-text" onClick={() => setSheet('delete')}>Delete request</button>
      </p>

      {sheet === 'note' && (
        <PromptSheet title="Note" placeholder={req.text} onOk={(t) => db.addNote(id, t).then(notify)} onClose={() => setSheet(null)} />
      )}
      {sheet === 'answer' && (
        <PromptSheet
          title="How did God answer?"
          placeholder="Optional"
          okLabel="Mark answered"
          allowEmpty
          onOk={(t) => db.markAnswered(id, t).then(notify)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'delete' && (
        <ConfirmSheet
          title="Delete this request?"
          body="It will be removed from your list and archive. To keep a record, mark it answered instead."
          okLabel="Delete"
          danger
          onOk={async () => {
            await db.deleteRequest(id);
            notify();
            go('today');
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}

// ---------- Archive ----------

function Archive() {
  const [filter, setFilter] = useState('all');
  const data = useData(async () => {
    const items = await db.listByStatus(['answered', 'expired']);
    const key = (r) => r.answeredAt || r.expiresAt || r.updatedAt;
    items.sort((a, b) => (key(a) < key(b) ? 1 : -1));
    return { items, stats: await db.prayerStats() };
  });
  if (!data) return null;
  const items = data.items.filter((r) => filter === 'all' || r.status === filter);
  const answered = data.items.filter((r) => r.status === 'answered').length;

  return (
    <section class="archive">
      <header class="page-head">
        <h1>Archive</h1>
        <p class="sub">{answered} answered · a record of God's faithfulness</p>
      </header>
      <div class="chips">
        {['all', 'answered', 'expired'].map((f) => (
          <button key={f} class={'chip' + (filter === f ? ' on' : '')} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {items.length === 0 && <p class="empty meta">Nothing here yet.</p>}
      <ul class="list archive-list">
        {items.map((r) => {
          const s = data.stats[r.id];
          return (
            <li key={r.id}>
              <a class="item" href={'#/request/' + r.id}>
                <span class="text">{r.text}</span>
                {r.answerNote && <span class="answer-inline">{r.answerNote}</span>}
                <span class="meta">
                  {r.status === 'answered' ? `Answered ${fmtDate(r.answeredAt)}` : `Expired ${fmtDate(r.expiresAt)}`}
                  {s ? ` · prayed ${s.count}×` : ''}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- Settings ----------

function Settings() {
  const data = useData(async () => ({ sections: await db.listSections(), settings: await db.getSettings() }));
  const [newName, setNewName] = useState('');
  const [sheet, setSheet] = useState(null);
  const fileRef = useRef();
  if (!data) return null;
  const { sections, settings } = data;

  const doExport = async () => {
    const payload = await db.exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prayer-list-${payload.exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    notify();
    toast('Backup saved');
  };

  const onFile = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (parsed.app !== 'prayerapp') throw new Error();
      setSheet({ kind: 'import', data: parsed });
    } catch {
      toast('That file is not a Prayer List backup.');
    }
  };

  const stale = !settings.lastExportedAt || db.now() - new Date(settings.lastExportedAt).getTime() > 30 * db.DAY;

  return (
    <section class="settings">
      <header class="page-head">
        <h1>Settings</h1>
      </header>

      <h3>Sections</h3>
      <ul class="sections">
        {sections.map((s, i) => (
          <li key={s.id}>
            <input
              class="sec-name"
              aria-label="Section name"
              value={s.name}
              onBlur={run((e) => e.target.value.trim() && e.target.value.trim() !== s.name && db.updateSection(s.id, { name: e.target.value.trim() }))}
            />
            <label class="never">
              <input type="checkbox" checked={s.neverExpires} onChange={run((e) => db.updateSection(s.id, { neverExpires: e.target.checked }))} />
              Never expires
            </label>
            <div class="sec-btns">
              <button class="icon" aria-label={`Move ${s.name} up`} disabled={i === 0} onClick={run(() => db.moveSection(s.id, -1))}>↑</button>
              <button class="icon" aria-label={`Move ${s.name} down`} disabled={i === sections.length - 1} onClick={run(() => db.moveSection(s.id, 1))}>↓</button>
              <button class="icon" aria-label={`Delete ${s.name}`} onClick={() => setSheet({ kind: 'delsec', section: s })}>✕</button>
            </div>
          </li>
        ))}
      </ul>
      <form
        class="add-sec"
        onSubmit={run(async (e) => {
          e.preventDefault();
          await db.addSection(newName);
          setNewName('');
        })}
      >
        <input placeholder="New section" value={newName} onInput={(e) => setNewName(e.target.value)} />
        <button class="ghost" type="submit" disabled={!newName.trim()}>Add</button>
      </form>

      <h3>Expiry</h3>
      <label class="field inline">
        Requests expire after
        <input
          type="number"
          min="1"
          inputMode="numeric"
          aria-label="Default expiry days"
          value={settings.defaultExpiryDays}
          onChange={run((e) => +e.target.value > 0 && db.saveSettings({ defaultExpiryDays: Math.round(+e.target.value) }))}
        />
        days
      </label>
      <label class="field inline">
        Remind me
        <input
          type="number"
          min="0"
          inputMode="numeric"
          aria-label="Alert lead days"
          value={settings.alertLeadDays}
          onChange={run((e) => +e.target.value >= 0 && db.saveSettings({ alertLeadDays: Math.round(+e.target.value) }))}
        />
        days before
      </label>
      <p class="meta">New and extended requests use these. Sections marked “Never expires” are left alone.</p>

      <h3>Backup</h3>
      <p class={stale ? 'warn' : 'meta'}>
        {settings.lastExportedAt ? `Last backup ${fmtDate(settings.lastExportedAt)}.` : 'No backup yet.'}
        {stale && ' Your list lives only on this phone — consider saving a backup.'}
      </p>
      <div class="row-btns wrap">
        <button class="primary" onClick={doExport}>Export backup</button>
        <button class="ghost" onClick={() => fileRef.current.click()}>Import backup</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </div>

      <p class="meta about">
        iPhone: keep using this page in Safari (bookmark it). A Home Screen copy keeps separate data from Safari and the Siri Shortcut.
      </p>

      {sheet?.kind === 'delsec' && (
        <ConfirmSheet
          title={`Delete “${sheet.section.name}”?`}
          body="Its requests move to Unsorted."
          okLabel="Delete"
          danger
          onOk={run(() => db.deleteSection(sheet.section.id))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'import' && (
        <ConfirmSheet
          title="Replace everything with this backup?"
          body={`Backup from ${fmtDate(sheet.data.exportedAt)} with ${sheet.data.requests.filter((r) => !r.deletedAt).length} requests. Everything currently on this phone will be replaced.`}
          okLabel="Replace"
          danger
          onOk={run(async () => {
            await db.importData(sheet.data);
            toast('Backup restored');
          })}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
