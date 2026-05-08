import { test, expect } from '@playwright/test';
import { SafeRoutePage } from './saferoute.page.js'
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';


const __dir  = dirname(fileURLToPath(import.meta.url));
const GPXWARNING  = join(__dir, '../fixtures/test-unsafe-route.gpx');
const GPXSAFE    = join(__dir, '../fixtures/test-route.gpx');
const MOCKSAFE    = JSON.parse(readFileSync(join(__dir, '../fixtures/overpass-mock-safe.json'), 'utf8'));
const MOCKDANGER   = JSON.parse(readFileSync(join(__dir, '../fixtures/overpass-mock-danger.json'), 'utf8'));
const MOCKCAUTION   = JSON.parse(readFileSync(join(__dir, '../fixtures/overpass-mock-use-caution.json'), 'utf8'));

// ── Upload + results ──────────────────────────────────────────────────────────

test('shows upload screen on load', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await expect(page.locator('#app')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('#uploadZone')).toBeVisible();
  await expect(page.locator('#resultsZone')).toBeHidden();
});

test('uploads GPX and displays safe scored results', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();

  await expect(page.locator('.ring-score')).toHaveText('80');
  await expect(page.locator('.score-name')).toHaveText('Safe Test Route');
  await expect(page.locator('.score-tier')).toHaveAttribute('style', 'color:var(--safe)');
});

test('uploads GPX and displays use caution scored results', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKCAUTION);
  await sr.uploadGPX(GPXWARNING);
  await sr.waitForResults();

  await expect(page.locator('.ring-score')).toHaveText('52');
  await expect(page.locator('.score-name')).toHaveText('Unsafe Test Route');
  await expect(page.locator('.score-tier')).toHaveAttribute('style', 'color:var(--caution-fixed)');
  await expect(page.locator('.score-tier')).toHaveText('Use Caution');
});

test('uploads GPXWARNING and displays risky scored results', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKDANGER);
  await sr.uploadGPX(GPXWARNING);
  await sr.waitForResults();

  await expect(page.locator('.ring-score')).toHaveText('44');
  await expect(page.locator('.score-name')).toHaveText('Unsafe Test Route');
  await expect(page.locator('.score-tier')).toHaveAttribute('style', 'color:var(--danger)');
  await expect(page.locator('.score-tier')).toHaveText('Risky');
  await expect(page.locator('.score-name')).toHaveText('Unsafe Test Route');
});

test('overall score is between 0 and 100', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();

  const score = await sr.getScore();
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(100);
});

// ── Data quality banner ───────────────────────────────────────────────────────

test('no data quality banner when Overpass returns road data', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();

  await expect(page.locator('#dataQualityBanner')).toBeHidden();
});

test('data quality banner appears when Overpass returns no data', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassEmpty();
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();

  await expect(page.locator('#dataQualityBanner')).toBeVisible();
  await expect(page.locator('#retryBtn')).toBeVisible();
});

test('retry button re-runs scoring with new mock data', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();

  // First load: no data → banner shown
  await sr.mockOverpassEmpty();
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();
  await expect(page.locator('#dataQualityBanner')).toBeVisible();

  //Skipping this for further testing until we can reliably unroute and re-route in the same test. See:
  // Retry: real data arrives → banner clears
  await page.unroute('**/api/interpreter');
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.clickRetry();
  await sr.waitForResults();
  await expect(page.locator('#dataQualityBanner')).toBeHidden();
});

// ── Segment interaction ───────────────────────────────────────────────────────

test('clicking a flagged segment marks it active', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKCAUTION);
  await sr.uploadGPX(GPXWARNING);
  await sr.waitForResults();

  const seg = sr.flaggedSegment();
  await expect(seg).toBeVisible();
  await seg.click();
  await expect(seg).toHaveClass(/seg-active/);
});

test('clicking an active segment deactivates it', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKCAUTION);
  await sr.uploadGPX(GPXWARNING);
  await sr.waitForResults();

  const seg = sr.flaggedSegment();
  await seg.click(); // activate
  await expect(seg).toHaveClass(/seg-active/);
  await seg.click(); // deactivate
  await expect(seg).not.toHaveClass(/seg-active/);
});

// ── Navigation ────────────────────────────────────────────────────────────────

test('New route button returns to upload state', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();

  await sr.clickBack();
  await sr.waitForIdle();
  await expect(page.locator('#uploadZone')).toBeVisible();
});

// ── Share URL ─────────────────────────────────────────────────────────────────

test('URL hash is set after results load', async ({ page }) => {
  const sr = new SafeRoutePage(page);
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();

  expect(page.url()).toContain('#r=');
});

test('navigating to a share URL loads the route directly', async ({ page }) => {
  const sr = new SafeRoutePage(page);

  // Load once to capture the share hash. Route intercepts persist across
  // navigations on the same page, so the mock stays active for the reload.
  await sr.goto();
  await sr.mockOverpassSuccess(MOCKSAFE);
  await sr.uploadGPX(GPXSAFE);
  await sr.waitForResults();
  const shareUrl = page.url();

  // Reload the share URL — app sees #r= in the hash and auto-scores
  await page.goto(shareUrl);
  await sr.waitForResults();
  expect(await sr.getRouteName()).toBe('Safe Test Route');
});
