// Scans public/packs/<pack>/ and writes a pack.json index for each pack, following the naming rules:
//   red.png            default look of character "red"
//   red@scared.png     an expression (scared, hit, sleep, blink, or anything else)
//   red.hit.wav        a sound for an action (only "hit" is used for now)
// Files that do not fit the rules are listed under "unsorted" instead of being dropped.
// Runs automatically before `npm run dev` and `npm run render`.
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'public/packs';
const IMAGE = /^([a-z0-9-]+)(?:@([a-z0-9-]+))?\.(png|webp|svg|jpg)$/i;
const SOUND = /^([a-z0-9-]+)\.([a-z0-9-]+)\.wav$/i;

export interface PackIndex {
  name: string;
  characters: Record<string, { expressions: Record<string, string>; sounds: Record<string, string> }>;
  unsorted: string[];
}

if (existsSync(ROOT)) {
  for (const name of readdirSync(ROOT)) {
    const dir = join(ROOT, name);
    if (!statSync(dir).isDirectory()) continue;
    const pack: PackIndex = { name, characters: {}, unsorted: [] };
    const character = (id: string) => (pack.characters[id] ??= { expressions: {}, sounds: {} });
    for (const file of readdirSync(dir).sort()) {
      if (file === 'pack.json') continue;
      const img = IMAGE.exec(file);
      const snd = SOUND.exec(file);
      if (img) character(img[1].toLowerCase()).expressions[(img[2] ?? 'default').toLowerCase()] = file;
      else if (snd) character(snd[1].toLowerCase()).sounds[snd[2].toLowerCase()] = file;
      else pack.unsorted.push(file);
    }
    for (const [id, c] of Object.entries(pack.characters)) {
      if (!c.expressions.default) pack.unsorted.push(`${id}: thiếu ảnh mặc định ${id}.png`);
    }
    writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
    console.log(`pack ${name}: ${Object.keys(pack.characters).length} nhân vật${pack.unsorted.length ? `, ${pack.unsorted.length} file chưa phân loại` : ''}`);
  }
}
