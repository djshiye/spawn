#!/usr/bin/env node
// README pictures (docs/screenshots/: hero, answers and gallery, dark and light) from the docs-shots screenshots.
// Usage: SPAWN_MONITOR=3200x1800 tools/dev-shell.sh docs-shots, then node tools/dev/docs-compose.cjs [.dev/shots]
// Needs Playwright with Chromium (npx playwright install chromium). Not part of the build or the tests.
/* global __dirname, process, console */
const path = require('path');
const {chromium} = require('playwright');

const root = path.resolve(__dirname, '../..');
const shots = path.resolve(process.argv[2] ?? path.join(root, '.dev/shots'));
const out = path.join(root, 'docs/screenshots');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({viewport: {width: 1400, height: 800}, deviceScaleFactor: 1.3});
    for (const kind of ['hero', 'answers', 'gallery']) {
        for (const [theme, name] of [['d', 'dark'], ['l', 'light']]) {
            await page.goto(`file://${__dirname}/docs-compose.html?kind=${kind}&theme=${theme}&shots=file://${shots}`);
            await page.waitForLoadState('networkidle');
            await page.locator('.stage').screenshot({path: path.join(out, `${kind}-${name}.png`), omitBackground: true});
        }
    }
    await browser.close();
    console.log(`README pictures written to ${out}`);
})();
