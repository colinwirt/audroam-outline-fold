// 0.5.30: regenerate the role CSS between the @gen-roles markers from dist/nodeColour.js (run after tsc).
import { readFileSync, writeFileSync } from 'node:fs';
import { rolesCss } from '../dist/nodeColour.js';
const p = new URL('../src/outline-fold.css', import.meta.url);
const s = readFileSync(p, 'utf8');
const a = '/* @gen-roles-start */\n', b = '/* @gen-roles-end */';
const i = s.indexOf(a), j = s.indexOf(b);
if (i < 0 || j < 0) throw new Error('markers missing');
writeFileSync(p, s.slice(0, i + a.length) + rolesCss() + s.slice(j));
console.log('roles css regenerated');
