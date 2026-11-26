import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Content Security Policy, added to the built index.html only (the dev server injects <style>
// tags for hot reload, which this policy would block).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function cspMeta() {
  return {
    name: 'csp-meta',
    apply: 'build',
    // Right after <meta charset>, before any script or stylesheet it must govern.
    transformIndexHtml: (html) =>
      html.replace(/(<meta charset="UTF-8" \/>)/, `$1\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// After the build, write the list of built files (and a version hash of their contents) into
// sw.js so the service worker can precache the whole app for offline use.
function precacheManifest() {
  let outDir;
  return {
    name: 'precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle: { order: "post", sequential: true, handler() {
      const swPath = path.join(outDir, 'sw.js');
      if (!fs.existsSync(swPath)) return;
      const files = [];
      const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else files.push(path.relative(outDir, full).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map') && f !== 'index.html').sort();
      const hash = createHash('sha256');
      for (const f of ['index.html', ...precache]) {
        hash.update(f);
        hash.update(fs.readFileSync(path.join(outDir, f)));
      }
      const version = hash.digest('hex').slice(0, 12);
      // './' is the app shell (index.html); every other file by its relative path.
      const list = ['./', ...precache];
      const sw = fs
        .readFileSync(swPath, 'utf8')
        .replace("'__PRECACHE_VERSION__'", JSON.stringify(version))
        .replace('self.__PRECACHE_FILES__', JSON.stringify(list));
      fs.writeFileSync(swPath, sw);
    } },
  };
}

export default defineConfig({
  base: '/prayerapp/',
  plugins: [preact(), cspMeta(), precacheManifest()],
});
