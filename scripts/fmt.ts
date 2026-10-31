// Rewrites map or template files in the house JSON style. Usage: node scripts/fmt.ts <files...>
import { readFileSync, writeFileSync } from 'node:fs';
import { formatMap } from '../src/map/format.ts';

for (const file of process.argv.slice(2)) writeFileSync(file, formatMap(JSON.parse(readFileSync(file, 'utf8'))));
