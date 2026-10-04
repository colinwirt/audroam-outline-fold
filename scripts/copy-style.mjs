// tsc does not copy CSS. The stylesheet has to land in dist/ with the JS.
import { cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
cpSync(join(root, 'src', 'outline-fold.css'), join(root, 'dist', 'outline-fold.css'));
