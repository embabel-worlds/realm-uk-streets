/*
 * Drives apps/community-profile.html in a real browser against envelopes captured from live
 * view runs (tests/fixtures/). What curl cannot see: that every panel renders from its view,
 * that the dial re-queries and the list shrinks, that a failed source shows an error and not
 * an empty-looking answer, and that the badge and the How-it-works link are present.
 *
 *   npx playwright install chromium     # once
 *   node --test tests/community-profile.spec.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appHtml = readFileSync(join(here, '..', 'apps', 'community-profile.html'), 'utf8');
const fx = (n) => JSON.parse(readFileSync(join(here, 'fixtures', n + '.json'), 'utf8'));
const FIX = {
  MyPlaces: fx('myplaces'),
  PlaceProfile: fx('placeprofile-blackpool'),
  SchoolReadinessAtPlace: fx('schoolreadiness-blackpool'),
  IndicatorTrendAtPlace: fx('youthjustice-blackpool'),
  GrantsIntoPlaceByYear: fx('grantsbyyear-blackpool'),
  WhoFundsThisPlace: fx('funders-blackpool'),
  CharitiesOperatingHere: fx('charities-blackpool'),
  CharityChangesHere: fx('changes-blackpool'),
};
const SMART = { 60: fx('smartinsights-blackpool-60'), 90: fx('smartinsights-blackpool-90') };

async function open(browser, { failing = null } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/app-under-test.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: appHtml }));
  await page.route('**/api/v1/apps-runtime/**', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(({ fix, smart, failing }) => {
    window.__calls = [];
    window.gateway = {
      view: {
        run: async ({ name, params }) => {
          window.__calls.push({ name, params });
          if (name === failing) throw new Error('source unavailable');
          if (name === 'SmartInsights') {
            const d = (params && params.dial) || 60;
            return smart[d >= 90 ? 90 : 60];
          }
          const f = fix[name];
          if (!f) throw new Error('no fixture for ' + name);
          return f;
        },
      },
    };
  }, { fix: FIX, smart: SMART, failing });
  await page.goto('http://app.test/app-under-test.html');
  await page.waitForFunction(() => document.querySelectorAll('#tiles .tile').length > 0 || document.querySelector('#tiles .err'));
  return { page, errors };
}

test('every panel renders from its view, with no page errors', async () => {
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser);
    await page.waitForFunction(() => document.querySelectorAll('#stands .row').length > 0);
    assert.equal(await page.locator('#tiles .tile').count(), 6, 'six at-a-glance tiles');
    assert.match(await page.locator('#tiles').textContent(), /143,492/, 'residents from PlaceProfile');
    assert.ok((await page.locator('#stands .row').count()) >= 5, 'stands-in-England rows at dial 60');
    assert.ok(await page.locator('#readiness svg').count(), 'school readiness chart drawn');
    assert.ok(await page.locator('#youth svg').count(), 'youth justice chart drawn');
    assert.ok(await page.locator('#grants svg rect.col').count() >= 5, 'grants columns drawn');
    assert.ok((await page.locator('#funders table tr').count()) > 3, 'funders table');
    assert.ok((await page.locator('#charities table tr').count()) > 3, 'charities table');
    assert.ok((await page.locator('#changes li').count()) >= 1, 'changes feed');
    assert.deepEqual(errors, [], 'no console or page errors');
  } finally { await browser.close(); }
});

test('the dial re-queries SmartInsights and the list shrinks', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    await page.waitForFunction(() => document.querySelectorAll('#stands .row').length > 0);
    const before = await page.locator('#stands .row').count();
    await page.locator('#dial').evaluate((el) => { el.value = '90'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction((b) => document.querySelectorAll('#stands .row').length < b, before);
    const calls = await page.evaluate(() => window.__calls.filter((c) => c.name === 'SmartInsights').map((c) => c.params.dial));
    assert.ok(calls.includes(90), 'the dial value reached the view: ' + JSON.stringify(calls));
    assert.match(await page.locator('#dialv').textContent(), /90/);
  } finally { await browser.close(); }
});

test('a failed source shows an error in its panel, never an empty answer', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser, { failing: 'WhoFundsThisPlace' });
    await page.waitForSelector('#funders .err');
    assert.match(await page.locator('#funders .err').textContent(), /unavailable/);
    assert.ok((await page.locator('#tiles .tile').count()) === 6, 'the rest of the page still renders');
  } finally { await browser.close(); }
});

test('the Embabel badge and the How-it-works link are present', async () => {
  const browser = await chromium.launch();
  try {
    const { page } = await open(browser);
    const badge = page.locator('#embabel-badge');
    assert.equal(await badge.count(), 1);
    assert.ok(await badge.isVisible());
    assert.match((await badge.textContent()).trim(), /Embabel/);
    assert.equal(await page.locator('footer a[href="#how-it-works"]').count(), 1, 'the discreet footer link');
    await page.locator('footer a[href="#how-it-works"]').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#how-it-works')).display !== 'none');
    await page.waitForFunction(() => document.querySelectorAll('#how-views pre').length >= 3);
    assert.ok((await page.locator('#how-views pre').count()) >= 3, 'views read back into the section');
  } finally { await browser.close(); }
});
