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

## Using it on Android

Open the link in Chrome. "Add to Home screen" is fine on Android because Chrome shares storage. Tap **+**, then the keyboard mic to dictate.

## Back up your list

Your list lives only on this phone, and Safari can clear data for sites you haven't used in a while. Go to **Settings → Export backup** now and then, and save the file to iCloud Drive or Files. **Import backup** restores it, on this phone or a new one.

## Development

```sh
npm install
npm run dev        # local dev server
npm run build      # production build to dist/
npm test           # end-to-end tests in an iPhone viewport (needs a build first)
```

- Vite + Preact + Dexie (IndexedDB). Hash routing. Network-first service worker.
- Pushing to `main` deploys to GitHub Pages (Settings → Pages → Source: **GitHub Actions**).
- `CLAUDE.md` holds the build brief and requirements.
- Testing expiry: set `localStorage['prayer.now']` to an ISO date to fake the clock.
