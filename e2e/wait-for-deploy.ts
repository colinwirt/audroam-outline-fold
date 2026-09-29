import { chromium, type FullConfig } from '@playwright/test';
import { PKG_VERSION, expectedSha } from './harness';

/**
 * Live Pages gate (E2E_BASE_URL set): wait until the deployed react-live
 * stamp and viewer build meta show the expected version (+ sha), so the
 * keyboard specs never run against a stale CDN copy. Fails after ~6 min.
 */
export default async function waitForDeploy(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL as string;
  const sha = expectedSha();
  const browser = await chromium.launch();
  const deadline = Date.now() + 6 * 60_000;
  let last = '';
  try {
    while (Date.now() < deadline) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try {
        const bust = `v=${Date.now()}`;
        await page.goto(new URL(`react-live/?${bust}`, baseURL).href);
        const stamp = (await page.getByTestId('pkg-stamp').textContent({ timeout: 15_000 })) || '';
        await page.goto(new URL(`examples/viewer/?doc=../outline-demo.md&${bust}`, baseURL).href);
        const meta = (await page.locator('#buildMeta').textContent({ timeout: 15_000 })) || '';
        last = `react-live="${stamp.trim()}" viewer="${meta.trim()}"`;
        const ok = (t: string) =>
          t.includes(`@audroam/outline-fold@${PKG_VERSION}`) && (!sha || t.includes(sha));
        if (ok(stamp) && ok(meta)) {
          console.log(`[wait-for-deploy] live stamps match ${PKG_VERSION} ${sha ?? ''}`);
          return;
        }
      } catch (err) {
        last = String(err);
      } finally {
        await ctx.close();
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
    throw new Error(`[wait-for-deploy] Pages never showed ${PKG_VERSION} ${sha ?? ''}; last: ${last}`);
  } finally {
    await browser.close();
  }
}
