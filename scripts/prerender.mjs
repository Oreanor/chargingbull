// SSG prerender: render the longread to HTML at build time and inject it into
// dist/index.html, so the page ships at its correct height (sections + text) and
// hydrates on the client. Heavy WebGL chapters are client-only, so the server HTML
// is the text + section shells with their fixed heights. Runs after both the client
// build (dist/) and the SSR build (dist/server/entry-server.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');

const { render } = await import(
  pathToFileURL(resolve(dist, 'server/entry-server.js')).href
);

const template = readFileSync(resolve(dist, 'index.html'), 'utf-8');
const appHtml = render();
if (!template.includes('<!--app-html-->')) {
  throw new Error('prerender: marker <!--app-html--> not found in dist/index.html');
}
writeFileSync(resolve(dist, 'index.html'), template.replace('<!--app-html-->', appHtml));
console.log(`[prerender] injected ${appHtml.length} chars of SSR HTML into dist/index.html`);
