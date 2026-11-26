# Prayer List

A simple prayer request list for your phone. Capture a request in a few seconds, pray through the whole list daily, keep notes, and keep a record of how God answered.

**App:** https://fretnoyz.github.io/prayerapp/

Everything is stored on your phone only. There's no account and no server.

## Using it on iPhone

1. Open the app link in **Safari** and **bookmark it** (or add it to Favorites).
2. **Don't use "Add to Home Screen."** On iPhone, a Home Screen copy keeps its data separate from Safari, and the Siri Shortcut below opens in Safari. Stick with Safari so everything stays in one list.

### Siri Shortcut: "Hey Siri, prayer request"

In the **Shortcuts** app, tap **+** and build:

1. **Ask for Input**, Input Type: Text, Prompt: `What's the request?`
2. **URL Encode** → *Provided Input*
3. **Open URLs** → `https://fretnoyz.github.io/prayerapp/?add=` followed by the *URL Encoded Text* variable

Name the shortcut **Prayer request**. Then say *"Hey Siri, prayer request,"* speak the request, and it lands in **Unsorted**.

Each time the shortcut runs, Safari opens a new tab. Close the extra tabs now and then (tap and hold the tabs button → **Close All Tabs**, then open your bookmark again). Nothing is lost: every tab shows the same list, and open tabs stay in step with each other.

## Using it on Android

Open the link in Chrome. "Add to Home screen" is fine on Android because Chrome shares storage. Tap **+**, then the keyboard mic to dictate.

## Back up your list

Your list lives only on this phone, and Safari can clear data for sites you haven't used in a while. Go to **Settings → Export backup** now and then, and save the file to iCloud Drive or Files. **Import backup** restores it, on this phone or a new one. If you import the wrong file, **Undo import** (in Settings, for 7 days) puts back the list as it was.

Settings also shows **Storage: protected / not protected / unknown**. "Protected" means the browser has agreed not to clear the list to free up space. Either way, keep a recent backup.

## Works without a signal

After your first visit the whole app is stored on the phone, so it opens instantly even with a weak signal or none (including the Siri Shortcut). When a new version is published, a small **Updated — Reload** note appears at the top; tap it when convenient.

## Development

```sh
npm install
npx playwright install chromium   # once, for the end-to-end tests
npm run dev        # local dev server
npm run build      # production build to dist/
npm run test:unit  # data rules (Node test runner + fake-indexeddb)
npm test           # builds dist-test/ (fake clock on) and runs the end-to-end tests in an iPhone viewport
```

- Vite + Preact + Dexie (IndexedDB). Hash routing.
- Service worker (`public/sw.js`): cache-first. The build writes the list of built files and a content hash into `dist/sw.js`, so every release precaches the whole app under a new cache name and deletes the old one on activate. A new version waits until the user taps **Reload**.
- Content Security Policy: added to the built `index.html` by `vite.config.js` (not in dev, where Vite injects inline styles).
- Pushing to `main` runs unit and end-to-end tests, then deploys to GitHub Pages (Settings → Pages → Source: **GitHub Actions**). Pull requests run the tests only.
- `CLAUDE.md` holds the build brief and requirements.
- Testing expiry: only in the test build (`npm run build:test`, which sets `VITE_TEST_CLOCK=1` via `.env.test`), `localStorage['prayer.now']` set to an ISO date fakes the clock. Production builds ignore it.
- Bundle size (v0.2.0): JS 143 kB (46 kB gzipped), CSS 8 kB (2.5 kB gzipped). Dexie is about 31 kB of the gzipped JS; replacing it with raw IndexedDB was considered and deferred.
