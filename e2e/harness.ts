import { expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

export const PKG_VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

/** Expected short SHA for build stamps, when known (CI / Pages verify). */
export function expectedSha(): string | null {
  const raw = process.env.EXPECT_SHA || process.env.GITHUB_SHA;
  if (raw) return raw.slice(0, 7);
  if (process.env.E2E_BASE_URL) return null;
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export type MapState = {
  /** document.activeElement === map host */
  hostFocused: boolean;
  activeTag: string;
  /** data-id of the element aria-activedescendant points at (null if none/dangling) */
  ad: string | null;
  adRaw: string | null;
  /** data-ids carrying .is-focused (the bordered ring) */
  ring: string[];
  /** rendered node ids in paint order */
  visible: string[];
  /** id → aria-expanded for foldable nodes */
  expanded: Record<string, string>;
};

export async function mapState(page: Page, hostSel: string): Promise<MapState> {
  return page.evaluate((sel) => {
    const host = document.querySelector(sel) as HTMLElement;
    const adRaw = host.getAttribute('aria-activedescendant');
    const adEl = adRaw ? document.getElementById(adRaw) : null;
    const nodes = [...host.querySelectorAll('.map-node')];
    const expanded: Record<string, string> = {};
    for (const n of nodes) {
      const v = n.getAttribute('aria-expanded');
      if (v != null) expanded[n.getAttribute('data-id')!] = v;
    }
    return {
      hostFocused: document.activeElement === host,
      activeTag: document.activeElement?.tagName || '',
      ad: adEl && host.contains(adEl) ? adEl.getAttribute('data-id') : null,
      adRaw,
      ring: [...host.querySelectorAll('.map-node.is-focused')].map(
        (e) => e.getAttribute('data-id')!,
      ),
      visible: nodes.map((e) => e.getAttribute('data-id')!),
      expanded,
    };
  }, hostSel);
}

/**
 * Contract 7: exactly one bordered node, it equals aria-activedescendant,
 * and (when given) equals the expected selection. Contract 1: DOM focus is
 * on the map host (single stable focus owner).
 */
export async function expectSelected(
  page: Page,
  hostSel: string,
  id: string,
  { hostFocused = true }: { hostFocused?: boolean } = {},
): Promise<MapState> {
  await expect
    .poll(async () => (await mapState(page, hostSel)).ad, {
      message: `aria-activedescendant should name ${id}`,
    })
    .toBe(id);
  const s = await mapState(page, hostSel);
  expect(s.ring, 'bordered .is-focused node == aria-activedescendant').toEqual([id]);
  if (hostFocused) {
    expect(s.hostFocused, `map host keeps DOM focus (active=${s.activeTag})`).toBe(true);
  }
  return s;
}

/** Wait for camera follow / FLIP to settle so geometry is stable. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => r()), 380)),
      ),
  );
}

/**
 * Contract 8: click the node through its visible pill with real pointer
 * actionability. First hit-test the pill centre (fails if any overlay would
 * intercept), then a Playwright click (which also refuses intercepted points).
 */
export async function clickNode(page: Page, host: Locator, id: string): Promise<void> {
  const node = host.locator(`.map-node[data-id="${id}"]`);
  await expect(node, `node ${id} rendered`).toHaveCount(1);
  await settle(page);
  const pill = node.locator('.map-pill');
  const box = await pill.boundingBox();
  expect(box, `pill ${id} has a box`).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  const hb = (await host.boundingBox())!;
  expect(
    cx >= hb.x && cx <= hb.x + hb.width && cy >= hb.y && cy <= hb.y + hb.height,
    `pill ${id} centre must be inside the visible map viewport before clicking (select via keys / pan first)`,
  ).toBe(true);
  const hit = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const n = el?.closest('.map-node');
      return {
        id: n?.getAttribute('data-id') ?? null,
        tag: el ? `${el.tagName}.${(el as HTMLElement).className?.toString?.() || ''}#${el.id}` : null,
      };
    },
    { x: cx, y: cy },
  );
  expect(hit.id, `pill centre of ${id} hit-tests to the node, not an overlay (${hit.tag})`).toBe(id);
  await node.click({ timeout: 5_000 });
}

export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await settle(page);
}

/** Press keys until aria-activedescendant == id (bounded), asserting coherence. */
export async function selectViaKeys(
  page: Page,
  hostSel: string,
  keys: string[],
  id: string,
): Promise<void> {
  for (const k of keys) await press(page, k);
  await expectSelected(page, hostSel, id);
}
