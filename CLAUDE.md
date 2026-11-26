# Prayer App — Build Brief

## Purpose
When someone asks me to pray for them, I capture the request on my phone in two or three movements, even mid-conversation. I pray through the whole active list daily, see how often I've prayed for each request, keep notes, and keep a lasting record of how God answered.

Perspective: Reformed Christian, informed first by Scripture and then by the example of the worthies (e.g., Müller's record of requests and answers). Keep copy plain and reverent; no gamification (no streaks, badges, or scores).

## MVP scope
- One user, one phone. No server, no accounts.
- Static PWA on GitHub Pages (public repo). All data stays on the device in IndexedDB.
- Works on iPhone (Safari) and Android (Chrome).
- **iPhone: used in Safari as a bookmark, not installed to home screen.** iOS isolates home-screen app storage from Safari, and the Siri Shortcut opens links in Safari. Don't push users to "Add to Home Screen" on iOS.

## Stack
- Vite + Preact (or Svelte) + Dexie.js. Keep the bundle small; first paint must be near-instant on a phone.
- Hash routing (`#/today`, `#/add`, `#/request/<id>`, `#/archive`, `#/settings`).
- Service worker caching the app shell (works with no signal).
- Vite `base` set for the GitHub Pages subpath.
- GitHub Actions workflow to build and deploy to Pages on push to main.
- Mobile-first CSS, large tap targets, light and dark mode, print stylesheet for Today.

## Data model
Every record: UUID `id`, `createdAt`, `updatedAt`, `deletedAt` (soft delete). Designed for a later shared/synced backend.

- **sections**: id, name, sortOrder, neverExpires (bool)
- **requests**: id, text, sectionId (null = Unsorted), status (`active` | `answered` | `expired`), expiresAt (null if section never expires), answeredAt, answerNote, author (reserved, null)
- **prayers**: id, requestId, prayedAt — one row per time prayed; count and last-prayed are derived
- **notes**: id, requestId, prayerId (optional, when added right after praying), text, createdAt, author (reserved, null)
- **settings** (single record): defaultExpiryDays (default 30), alertLeadDays (default 7)

## Behavior rules
- **Expiry sweep on app open:** active requests with expiresAt < now → `expired`.
- **Expiring soon:** active and expiresAt within alertLeadDays → banner on Today.
- **Extend:** expiresAt = today + defaultExpiryDays.
- **Mark answered:** status `answered`, answeredAt = now, optional answerNote ("How did God answer?").
- **Moving a request into a neverExpires section** clears expiresAt; moving out sets it from today.
- **Siri capture:** on load, if `?add=<text>` is present: trim, save to Unsorted, show "Added to prayer list" toast, then remove the param with `history.replaceState` so refresh doesn't duplicate. Ignore empty text.

## Screens
1. **Today** (home)
   - "Expiring soon" banner → list with Extend / Answered per item.
   - Unsorted at top when non-empty, then sections in user order.
   - Row: text, prayed count, last prayed (e.g., "12× · 2 days ago").
   - One tap on the check → logs a prayer. An "Add note" link appears for ~5 seconds, then fades. It must never block or slow the next tap.
   - Prayed-today state visible on each row.
   - Floating "+" → Quick Add.
2. **Quick Add**
   - Single autofocused text field (keyboard opens so the mic is one tap away), Save. Optional section picker, default Unsorted. Enter saves.
3. **Request detail**
   - Edit text, move section, prayer history (dates), notes thread (dated), add note, Extend, Mark answered, Delete (soft, with confirm).
4. **Archive**
   - Answered and expired, newest first; filter All / Answered / Expired. Answered items show the answer note prominently. Option to reactivate.
5. **Settings**
   - Sections: add, rename, reorder, toggle never-expires, delete (requests move to Unsorted).
   - Default expiry days, alert lead days.
   - **Export** all data to a dated JSON file; **Import** from JSON (replace, with confirm). Show "last exported" date and a gentle reminder if > 30 days.

## Siri Shortcut (document in README)
iPhone Shortcuts app → new shortcut named "Prayer request":
1. Ask for Input (Text), prompt "What's the request?"
2. URL Encode the input
3. Open URL `https://<user>.github.io/<repo>/?add=<encoded>`
Then "Hey Siri, prayer request."

## Seed data
Sections on first run: Family, Church, Friends, Missions, Work. (User will rename/reorder.)

## Backlog (do not build now, but don't paint into a corner)
- Shared list for husband and wife (backend TBD: managed vs self-hosted), with author on notes and "prayed together" marking.
- Computer entry, offline capture with sync, push notifications, one-breath native Siri, native app if PWA limits bite.

## Definition of done
- Builds and deploys to GitHub Pages via Actions.
- Tested in a mobile viewport: add, `?add=` capture (no duplicate on refresh), mark prayed + note, extend, answer, expiry sweep (fake the clock), archive, section reorder, export → wipe → import round-trip.
- README with setup, Siri Shortcut steps, and the iPhone Safari-not-home-screen note.
