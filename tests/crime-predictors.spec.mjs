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
const RANKED = fx('districtsranked');
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
  await page.addInitScript(({ alone, models, ranked, fail }) => {
    window.gateway = {
      view: {
        run: async ({ name, params }) => {
          if (name === 'CrimePredictorsOneByOne') return alone;
          if (name === 'DistrictsRanked') return ranked;
          if (fail) throw new Error('source unavailable');
          const enabled = Object.keys(params || {}).filter((k) => params[k]).sort();
          const m = models[enabled.join(',')];
          if (m) return m;
          /* Walking the checkboxes passes through many intermediate combinations. Fixtures exist
           * for the states whose NUMBERS are asserted; every other state is synthesized with the
           * right SHAPE (n fixed, one coefficient per enabled predictor) so the walk exercises
           * the app instead of failing on fixture bookkeeping. */
          return {
            rows: [{ model: {
              n: 263, dropped: 0, r2: 0.3, adjustedR2: 0.29,
              coefficients: enabled.map((_, i) => ({ predictor: 'x' + (i + 1), beta: 0.2 })),
              abovePrediction: [{ label: 'Westminster', actual: 446.4, predicted: 131.6, residual: 314.8 }],
              belowPrediction: [{ label: 'Tower Hamlets', actual: 99.6, predicted: 151.2, residual: -51.6 }],
            } }],
            warnings: [],
          };
        },
      },
    };
  }, { alone: ALONE, models: MODELS, ranked: RANKED, fail });

  await page.goto('http://app.invalid/app-under-test.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('preds').hidden, { timeout: 5000 })
    .catch(() => {});
  return { page, errors };
}

/* Select on the row's data-key, never its label: "Population" is a substring of
 * "Population density", so a text filter silently drove the wrong checkbox. */
const KEY = {
  'Deprivation': 'deprivation', 'Population density': 'density', 'Young adults': 'youngAdults',
  'Median pay': 'pay', 'Ethnic diversity': 'diversity', 'Population': 'population',
};
const rowFor = (page, name) =>
  page.locator(`#predbody tr[data-key="${KEY[name] || name}"]`);

/** Click a predictor's checkbox and wait for the fit to settle. */
const onCount = (page) => page.locator('#predbody tr.on').count();

/** Click a predictor's checkbox and wait for the enabled count to land where it should. */
async function tick(page, name) {
  const before = await onCount(page);
  const isOn = ((await rowFor(page, name).getAttribute('class')) || '') === 'on';
  await rowFor(page, name).locator('.toggle').click();
  const want = before + (isOn ? -1 : 1);
  await page.waitForFunction(
    (n) => document.querySelectorAll('#predbody tr.on').length === n, want, { timeout: 8000 });
  await page.waitForFunction(() => {
    const s = document.getElementById('state');
    return !s || s.hidden || !/fitting/.test(s.textContent);
  }, { timeout: 8000 });
  await page.waitForTimeout(80);
}

/** Leave exactly one predictor ticked, and prove it. */
async function only(page, name) {
  for (const other of ['Deprivation', 'Population density', 'Young adults', 'Median pay',
                       'Ethnic diversity', 'Population']) {
    if (other === name) continue;
    if (((await rowFor(page, other).getAttribute('class')) || '') === 'on') await tick(page, other);
  }
  if (((await rowFor(page, name).getAttribute('class')) || '') !== 'on') await tick(page, name);
  assert.equal(await onCount(page), 1, `exactly ${name} is enabled`);
}

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

    await only(page, 'Ethnic diversity');
    const solo = await readDiversity();
    assert.match(solo, /0\.4/, `diversity alone reads ~0.42, got ${solo}`);

    await tick(page, 'Population density');
    const withDensity = parseFloat((await readDiversity()).replace('−', '-'));

    await tick(page, 'Deprivation');
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
    await only(page, 'Ethnic diversity'); seen.add(await nOf());
    await tick(page, 'Population density'); seen.add(await nOf());
    await tick(page, 'Deprivation'); seen.add(await nOf());
    await tick(page, 'Young adults'); await tick(page, 'Median pay'); await tick(page, 'Population');
    seen.add(await nOf());
    assert.equal(seen.size, 1, `n must not move with the toggles, saw ${[...seen].join(', ')}`);
    assert.equal([...seen][0], '263');
  } finally { await browser.close(); }
});

test('toggling a predictor off blanks its in-model figure but keeps its alone figure', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    await only(page, 'Ethnic diversity');
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
    await only(page, 'Ethnic diversity');
    await tick(page, 'Ethnic diversity');
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

test('the ranked district list renders every district and re-sorts on a column click', async () => {
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser);
    const table = page.locator('#ranked table.rank');
    await table.waitFor({ timeout: 8000 });
    const rows = await table.locator('tr').count();
    assert.ok(rows > 50, `the whole cross-section is listed, got ${rows - 1} districts`);

    // Default order is worst crime first.
    const first = await table.locator('tr').nth(1).locator('td').first().textContent();
    assert.match(first, /Westminster/, 'worst crime rate leads by default');

    // Sorting by a different column actually re-orders.
    await table.locator('th', { hasText: 'Deprivation' }).click();
    await page.waitForTimeout(120);
    const afterSort = await table.locator('tr').nth(1).locator('td').first().textContent();
    assert.ok(!/Westminster/.test(afterSort),
      'sorting by deprivation moves Westminster off the top — its crime rank is an artefact');
    assert.deepEqual(errors, [], 'no console errors');
  } finally { await browser.close(); }
});

test('the Embabel badge is present, visible and links out', async () => {
  // Nothing injects this. The server-side rule (HtmlEmbabelBannerRule) runs only on GENERATED
  // apps; an app shipped in a realm's apps/ directory is served from disk and never passes
  // through it. So the realm's own harness is the enforcement, and it asserts VISIBLE rather
  // than merely present — an empty div satisfies a grep and shows the user nothing, which is
  // exactly how this shipped the first time.
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    const badge = page.locator('#embabel-badge');
    assert.equal(await badge.count(), 1, 'the badge marker is the well-known #embabel-badge id');
    assert.ok(await badge.isVisible(), 'the badge is visible, not an empty or hidden div');
    const text = (await badge.textContent()).trim();
    assert.ok(text.length > 0, `the badge carries attribution text, got "${text}"`);
    assert.match(text, /Embabel/i);
    const href = await badge.locator('a').getAttribute('href');
    assert.match(href || '', /embabel\.com/, 'the badge links to embabel.com');

    // It must not be covered by the page: a fixed bar the layout paints over is not shown.
    const box = await badge.boundingBox();
    const vh = page.viewportSize().height;
    assert.ok(box && box.height > 0, 'the badge occupies real space');
    assert.ok(box.y + box.height <= vh + 1, 'the badge sits within the viewport');
  } finally { await browser.close(); }
});
