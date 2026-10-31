// Generates the placeholder "blobs" pack: round characters drawn as SVG with five expressions each,
// plus a short synthesized voice per character. Original art, safe to ship as a placeholder.
// Usage: node scripts/make-blobs.ts
import { mkdirSync, writeFileSync } from 'node:fs';

const DIR = 'public/packs/blobs';
const CHARACTERS: Record<string, { body: string; shade: string; pitch: number }> = {
  red: { body: '#ff5a5f', shade: '#c9343a', pitch: 520 },
  blue: { body: '#4aa8ff', shade: '#2a6fc0', pitch: 400 },
  yellow: { body: '#ffd23f', shade: '#d49b10', pitch: 660 },
  green: { body: '#52d681', shade: '#2a9a55', pitch: 460 },
  purple: { body: '#b57cff', shade: '#7d47c9', pitch: 360 },
  orange: { body: '#ff9b42', shade: '#cc6a17', pitch: 580 },
};

type Expression = 'default' | 'scared' | 'hit' | 'sleep' | 'blink';

const eyes: Record<Expression, string> = {
  default: '<circle cx="44" cy="54" r="9" fill="#fff"/><circle cx="84" cy="54" r="9" fill="#fff"/><circle cx="46" cy="56" r="5" fill="#1b1b24"/><circle cx="86" cy="56" r="5" fill="#1b1b24"/>',
  scared: '<circle cx="44" cy="52" r="12" fill="#fff"/><circle cx="84" cy="52" r="12" fill="#fff"/><circle cx="44" cy="52" r="3.5" fill="#1b1b24"/><circle cx="84" cy="52" r="3.5" fill="#1b1b24"/>',
  hit: '<path d="M34 46 L52 56 L34 64" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M94 46 L76 56 L94 64" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linecap="round"/>',
  sleep: '<path d="M34 58 Q44 64 54 58" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M74 58 Q84 64 94 58" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linecap="round"/>',
  blink: '<path d="M34 57 L54 57" stroke="#1b1b24" stroke-width="5" stroke-linecap="round"/><path d="M74 57 L94 57" stroke="#1b1b24" stroke-width="5" stroke-linecap="round"/>',
};

const mouth: Record<Expression, string> = {
  default: '<path d="M50 80 Q64 92 78 80" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linecap="round"/>',
  scared: '<ellipse cx="64" cy="88" rx="9" ry="12" fill="#1b1b24"/>',
  hit: '<path d="M48 88 L56 82 L64 88 L72 82 L80 88" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>',
  sleep: '<ellipse cx="64" cy="86" rx="5" ry="4" fill="#1b1b24"/><text x="92" y="34" font-family="Arial" font-weight="bold" font-size="22" fill="#fff">z</text>',
  blink: '<path d="M50 80 Q64 92 78 80" stroke="#1b1b24" stroke-width="5" fill="none" stroke-linecap="round"/>',
};

function svg(c: { body: string; shade: string }, e: Expression): string {
  const sweat = e === 'scared' ? '<path d="M104 30 Q110 42 104 46 Q98 42 104 30Z" fill="#9fe0ff"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
<circle cx="64" cy="66" r="56" fill="${c.shade}"/><circle cx="64" cy="62" r="54" fill="${c.body}"/>
<ellipse cx="44" cy="30" rx="16" ry="9" fill="#fff" opacity="0.35"/>
${eyes[e]}${mouth[e]}${sweat}
</svg>
`;
}

// A "boop": a quick pitch drop with a soft attack, 16-bit mono 48 kHz.
function voice(pitch: number): Uint8Array {
  const rate = 48000;
  const n = Math.round(rate * 0.12);
  const out = new Uint8Array(44 + n * 2);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, n * 2, true);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = pitch * (1.6 - 0.8 * (t / 0.12));
    phase += (2 * Math.PI * f) / rate;
    const env = Math.min(1, t / 0.008) * Math.exp(-t * 28);
    view.setInt16(44 + i * 2, Math.round((Math.sin(phase) + 0.3 * Math.sin(2 * phase)) * env * 14000), true);
  }
  return out;
}

mkdirSync(DIR, { recursive: true });
for (const [id, c] of Object.entries(CHARACTERS)) {
  writeFileSync(`${DIR}/${id}.svg`, svg(c, 'default'));
  for (const e of ['scared', 'hit', 'sleep', 'blink'] as const) writeFileSync(`${DIR}/${id}@${e}.svg`, svg(c, e));
  writeFileSync(`${DIR}/${id}.hit.wav`, voice(c.pitch));
}
console.log(`Đã tạo pack blobs: ${Object.keys(CHARACTERS).length} nhân vật trong ${DIR}`);
