/*
 * Drives apps/crime-predictors.html in a real browser against envelopes captured from live
 * view runs (tests/fixtures/). curl cannot click, and the defects this catches are only
 * visible once the page runs: a toggle that does not refit, a residual table that renders
 * the wrong sign, an error state that looks like an answer.
 *
 * The stub answers /api/v1/tools/view_run with the UNWRAPPED shape — the browser shim returns
 * `body.result`, so the app sees `{rows: […]}`. Stubbing the wrapped shape would test a
 * contract the app never meets.
 *
 *   npx playwright install chromium     # once
 *   node --test tests/crime-predictors.spec.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appHtml = readFileSync(join(here, '..', 'apps', 'crime-predictors.html'), 'utf8');
const fx = (n) => JSON.parse(readFileSync(join(here, 'fixtures', n + '.json'), 'utf8'));

const ALONE = fx('crimepredictorsonebyone');
const MODELS = {
  'density,deprivation,diversity,pay,population,youngAdults': fx('crimemodelwithpredictors-all'),
  'diversity': fx('crimemodelwithpredictors-diversity-alone'),
  'density,diversity': fx('crimemodelwithpredictors-div-den'),
  'density,deprivation,diversity': fx('crimemodelwithpredictors-div-den-dep'),
};

/** Serve the app with the runtime stubbed; `fail` forces the model call to error. */
async function open(browser, { fail = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // The app is SERVED and navigated to, never setContent'd: init scripts run on navigation
  // only, so setContent leaves the page with no stubbed gateway at all — which looks exactly
  // like a broken app and is really a broken harness.
  await page.route('**/app-under-test.html', (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: appHtml }));
  await page.route('**/api/v1/apps-runtime/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));

  // The browser shim, reduced to what the app uses, returning the unwrapped envelope.
  await page.addInitScript(({ alone, models, fail }) => {
    window.gateway = {
      view: {
        run: async ({ name, params }) => {
          if (name === 'CrimePredictorsOneByOne') return alone;
          if (fail) throw new Error('source unavailable');
          const on = Object.keys(params || {}).filter((k) => params[k]).sort().join(',');
          const m = models[on];
          if (!m) throw new Error('no fixture for predictor set: ' + on);
          return m;
        },
      },
    };
  }, { alone: ALONE, models: MODELS, fail });

  await page.goto('http://app.invalid/app-under-test.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('preds').hidden, { timeout: 5000 })
    .catch(() => {});
  return { page, errors };
}

const rowFor = (page, name) =>
  page.locator('#predbody tr').filter({ hasText: name }).first();

test('all six predictors render, with alone AND in-model always side by side', async () => {
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser);
    assert.equal(await page.locator('#predbody tr').count(), 6, 'six predictor rows');

    // The safety property: no row shows an alone figure without its in-model figure.
    for (const nm of ['Deprivation', 'Population density', 'Young adults', 'Median pay',
                      'Ethnic diversity', 'Population']) {
      const row = rowFor(page, nm);
      assert.equal(await row.locator('.barrow').count(), 2, `${nm}: both bars drawn`);
      const alone = (await row.locator('td.num').nth(0).textContent()).trim();
      const model = (await row.locator('td.num').nth(1).textContent()).trim();
      assert.notEqual(alone, '', `${nm}: alone figure present`);
      assert.notEqual(model, '—', `${nm}: in-model figure present while enabled`);
    }
    assert.deepEqual(errors, [], 'no console errors');
  } finally { await browser.close(); }
});

test('the three-step walk collapses diversity from 0.420 to ~0.013', async () => {
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser);
    const readDiversity = async () =>
      (await rowFor(page, 'Ethnic diversity').locator('td.num').nth(1).textContent()).trim();

    await page.getByRole('button', { name: /Diversity alone/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#predbody tr.on').length === 1);
    const solo = await readDiversity();
    assert.match(solo, /0\.4/, `diversity alone reads ~0.42, got ${solo}`);

    await page.getByRole('button', { name: /Add density/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#predbody tr.on').length === 2);
    const withDensity = parseFloat((await readDiversity()).replace('−', '-'));

    await page.getByRole('button', { name: /Add deprivation/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#predbody tr.on').length === 3);
    const withDeprivation = parseFloat((await readDiversity()).replace('−', '-'));

    // The CLAIM is the collapse, not a particular decimal — assert the ratio so a data
    // refresh that moves the figure does not fail a test whose point still holds.
    const alone = parseFloat(solo.replace('−', '-'));
    assert.ok(Math.abs(withDensity) < Math.abs(alone), 'density alone already shrinks it');
    assert.ok(Math.abs(withDeprivation) / Math.abs(alone) < 0.25,
      `deprivation collapses it to under a quarter of ${alone}, got ${withDeprivation}`);
    assert.deepEqual(errors, [], 'no console errors');
  } finally { await browser.close(); }
});

test('the sample is identical across every step — a beta moves because the model changed', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    const nOf = async () => (await page.locator('#fit b').nth(1).textContent()).trim();
    const seen = new Set();
    for (const step of [/Diversity alone/, /Add density/, /Add deprivation/, /All six/]) {
      await page.getByRole('button', { name: step }).click();
      await page.waitForTimeout(120);
      seen.add(await nOf());
    }
    assert.equal(seen.size, 1, `n must not move with the toggles, saw ${[...seen].join(', ')}`);
    assert.equal([...seen][0], '263');
  } finally { await browser.close(); }
});

test('toggling a predictor off blanks its in-model figure but keeps its alone figure', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    await page.getByRole('button', { name: /Diversity alone/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#predbody tr.on').length === 1);
    const dep = rowFor(page, 'Deprivation');
    assert.equal((await dep.locator('td.num').nth(1).textContent()).trim(), '—', 'off: no in-model figure');
    assert.notEqual((await dep.locator('td.num').nth(0).textContent()).trim(), '—',
      'off: alone figure still shown, so the comparison is never half-missing');
  } finally { await browser.close(); }
});

test('zero predictors is refused rather than fitted', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    await page.getByRole('button', { name: /Diversity alone/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#predbody tr.on').length === 1);
    await rowFor(page, 'Ethnic diversity').locator('.toggle').click();
    await page.waitForFunction(() => document.querySelectorAll('#predbody tr.on').length === 0);
    const note = await page.locator('#commentary').textContent();
    assert.match(note, /not a model/i, 'says why an empty model is refused');
  } finally { await browser.close(); }
});

test('a failed fit says so, and warns against reading it as a zero', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser, { fail: true });
    await page.waitForFunction(() => {
      const s = document.getElementById('state');
      return s && !s.hidden && s.className.includes('err');
    }, { timeout: 5000 });
    const msg = await page.locator('#state').textContent();
    assert.match(msg, /could not be computed/i);
    assert.match(msg, /not a result|zero/i, 'an error must not read as an answer');
  } finally { await browser.close(); }
});

test('residuals name the districts and Westminster is explained', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    const res = page.locator('#residuals');
    await res.locator('table.res').waitFor({ timeout: 5000 });
    const rows = await res.locator('table.res tr').count();
    assert.ok(rows > 1, 'residual rows rendered');
    const text = await res.textContent();
    assert.match(text, /Westminster/);
    assert.match(text, /daytime population/i, 'the outlier is explained, not just listed');
  } finally { await browser.close(); }
});

test('how-it-works is reachable and carries the method and the caveats', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    assert.equal(await page.locator('#how').isVisible(), false, 'hidden until asked for');
    await page.locator('#howlink').click();
    await page.waitForFunction(() => document.getElementById('how').style.display === 'block');
    const how = await page.locator('#how').textContent();
    for (const must of [/never causation/i, /where they\s+live/i, /England only/i, /1 − Σ|1 - Σ/,
                        /regress\(/, /sample never changes/i]) {
      assert.match(how, must);
    }
  } finally { await browser.close(); }
});
