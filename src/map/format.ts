// Map files are written for people to read: short objects and arrays stay on one line, long ones break up.
const WIDTH = 110;

export function formatMap(map: unknown): string {
  return format(map, '') + '\n';
}

function format(value: unknown, indent: string): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return 'null';
  if (value === null || typeof value !== 'object' || indent.length + flat.length <= WIDTH) return spaced(value);
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`).join(',\n')}\n${indent}}`;
}

// One-line form with a space after colons and commas, like the hand-written maps.
function spaced(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(spaced).join(', ')}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${spaced(v)}`).join(', ')} }` : '{}';
}
