#!/usr/bin/env node
/**
 * Regenerate trailing `--- payloads ---` in examples/outline-demo.md
 * from scripts/demo-plaintexts.json via demoSeal. Outline body stays lean
 * (caption + flags + id only — no inline ct=). Remote uri stub written as-is.
 *
 * Usage: npm run demo:seal
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoSeal, DEMO_PASSPHRASE } from '../dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesPath = join(root, 'scripts/demo-plaintexts.json');
const mdPath = join(root, 'examples/outline-demo.md');
const htmlPath = join(root, 'examples/outline-demo.html');

const fixtures = JSON.parse(readFileSync(fixturesPath, 'utf8'));
const passphrase = fixtures.passphrase || DEMO_PASSPHRASE;

if (passphrase !== DEMO_PASSPHRASE) {
  console.warn(
    `Warning: fixtures passphrase "${passphrase}" ≠ DEMO_PASSPHRASE "${DEMO_PASSPHRASE}"`,
  );
}

const entries = [];
for (const p of fixtures.payloads) {
  const sealed = await demoSeal(p.plaintext, passphrase, p.kid);
  entries.push({
    id: p.id,
    kid: sealed.kid,
    alg: sealed.alg,
    ct: sealed.ciphertext,
    flag: p.flag,
    caption: p.caption,
  });
  console.log(`sealed ${p.id} kid=${p.kid} ct=${sealed.ciphertext.slice(0, 20)}…`);
}

const remote = fixtures.remoteStub;
const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

const payloadLines = ['--- payloads ---'];
for (const e of entries.sort((a, b) => a.id.localeCompare(b.id))) {
  payloadLines.push(`${e.id}:`);
  payloadLines.push(`  kid: ${e.kid}`);
  if (e.alg) payloadLines.push(`  alg: ${e.alg}`);
  payloadLines.push(`  ct: ${e.ct}`);
}
payloadLines.push(`${remote.id}:`);
payloadLines.push(`  kid: ${remote.kid}`);
payloadLines.push(`  alg: ${remote.alg || 'demo-aes-gcm'}`);
payloadLines.push(`  uri: ${remote.uri}`);
payloadLines.push('---');

const md = `---
fold-: courtyard-quotes, payroll, alarm, staff-private, ${remote.id}
collapsedMarker: "(+)"
---
- ☕ Northside Corner Cafe — ops handoff <id:root>
  - Menu update ideas · spring · P2 · 👍 <id:menu>
    - [ ] Add cold brew flight · board special <kind:pending-approve> <id:menu-coldbrew>
    - [ ] Retire winter pie · low sellers · P3 <kind:pending-approve> <id:menu-pie>
    - [-] Seasonal flat white syrup · supplier TBD <id:menu-syrup>
    - [x] Allergen line on board · approved:Jess · done Wed <id:menu-allergen>
    - pros: weekend tourist traffic · cons: barista training time <id:menu-notes>
  - Seasonal supplier update · Q4 fruit <id:suppliers>
    - Berries · Yarra Valley co-op · ETA next Tue <id:sup-berries>
    - Milk · keep current dairy · no change <id:sup-milk>
    - Coffee · sample bag from Altitude Roasters <id:sup-coffee>
    - [x] Send Friday supplier SMS · approved:sms-bot · auto <id:sup-sms>
    - ${byId['sup-private'].caption} <${byId['sup-private'].flag}> <id:sup-private> (+)
  - Remodel the courtyard · permit in flight · P1 <id:courtyard>
    - [ ] Confirm pavers quote · three bids <kind:pending-approve> <id:courtyard-quotes> (+)
      - Bid A · local mason · ballpark only <id:bid-a>
      - Bid B · landscape crew · includes planters <id:bid-b>
    - [ ] Shade sail colour · match awning <kind:pending-approve> <id:courtyard-sail>
    - [ ] Neighbour note before dig day <kind:pending-approve> <id:courtyard-neighbour>
    - [x] Permit lodged · approved:Sam <id:courtyard-permit>
  - Staff roster · first names only <id:staff>
    - Mon open · Sam · Jess <id:staff-mon>
    - Tue–Wed · Sam · Priya <id:staff-mid>
    - Fri late · Jess · Omar <id:staff-fri>
    - [x] Post Fri late SMS to Omar · approved:sms-bot · auto <id:staff-sms>
    - ${byId['staff-private'].caption} <${byId['staff-private'].flag}> <id:staff-private> (+)
  - Secrets · manager only <id:secrets>
    - ${byId.payroll.caption} <${byId.payroll.flag}> <id:payroll> (+)
    - ${byId.alarm.caption} <${byId.alarm.flag}> <id:alarm> (+)
    - ${remote.caption} <${remote.flag}> <id:${remote.id}> (+)

${payloadLines.join('\n')}
`;

writeFileSync(mdPath, md);
console.log('wrote', mdPath);

let html = readFileSync(htmlPath, 'utf8');
const srcRe = /const src = "[\s\S]*?";/;
if (!srcRe.test(html)) {
  console.warn('outline-demo.html: const src = … not found; skipped HTML sync');
} else {
  html = html.replace(srcRe, `const src = ${JSON.stringify(md)};`);
  writeFileSync(htmlPath, html);
  console.log('synced', htmlPath);
}

console.log(`\nDemo passphrase: ${passphrase}`);
console.log('Remote stub (no live fetch):', remote.uri);
