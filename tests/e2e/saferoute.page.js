// Page Object for SafeRoute — encapsulates selectors and common actions.
import { expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir  = dirname(fileURLToPath(import.meta.url));
const MOCK   = JSON.parse(readFileSync(join(__dir, '../fixtures/overpass-mock.json'), 'utf8'));
const GPX    = join(__dir, '../fixtures/test-route.gpx');

export class SafeRoutePage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/');
    // Clear OSM cache so tests start clean regardless of prior runs
    await this.page.evaluate(() => {
      for (const key of [...Object.keys(sessionStorage)]) {
        if (key.startsWith('sr_osm_')) sessionStorage.removeItem(key);
      }
    });
  }

  // Intercept all Overpass POST requests and return the fixture response.
  // Call before uploadGPX() so the mock is in place when requests fire.
  async mockOverpassSuccess() {
    await this.page.route('**/api/interpreter', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK),
      })
    );
  }

  // Return empty elements — triggers the "all simulated" fallback path.
  async mockOverpassEmpty() {
    await this.page.route('**/api/interpreter', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ elements: [] }),
      })
    );
  }

  async uploadGPX() {
    await this.page.locator('#fileInput').setInputFiles(GPX);
  }

  async waitForResults() {
    await expect(this.page.locator('#app'))
      .toHaveAttribute('data-state', 'results', { timeout: 15_000 });
  }

  async waitForIdle() {
    await expect(this.page.locator('#app'))
      .toHaveAttribute('data-state', 'idle', { timeout: 10_000 });
  }

  async getScore() {
    const text = await this.page.locator('.ring-score').textContent();
    return parseInt(text, 10);
  }

  async getRouteName() {
    return this.page.locator('.score-name').textContent();
  }

  async clickBack() {
    await this.page.locator('#backBtn').click();
  }

  async clickRetry() {
    await this.page.locator('#retryBtn').click();
  }

  // First segment row visible in the flagged list (score < 70)
  flaggedSegment() {
    return this.page.locator('.flagged-row:not(.flagged-row--hidden)').first();
  }
}
