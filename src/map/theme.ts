// Ready-made styles. A theme fills in the background, the ground colours and texture, the marble skin and the
// hit sound; anything the map sets itself (ground, look, sound) wins over the theme.
import type { Look, MapDoc, SoundSet } from './types.ts';

export interface Theme {
  name: string;
  background: string;
  ground: { color: string; rim: string; rimWidth?: number };
  look: Look;
  sound: SoundSet;
}

export const THEMES: Record<string, Theme> = {
  paper: {
    name: 'Giấy kẻ ô',
    background: '#e9e4d6',
    ground: { color: '#fbf8ef', rim: '#3b4a6b', rimWidth: 2.5 },
    look: { marble: 'glass', shadow: true, pattern: 'paper', backdrop: ['#efe9da', '#ddd5c0'] },
    sound: 'pop',
  },
  wood: {
    name: 'Bàn gỗ',
    background: '#2a1a0e',
    ground: { color: '#b07a45', rim: '#5c3a1c', rimWidth: 4 },
    look: { marble: 'glass', shadow: true, pattern: 'wood', backdrop: ['#3a2414', '#1e1209'] },
    sound: 'wood',
  },
  chalk: {
    name: 'Bảng đen',
    background: '#16241c',
    ground: { color: '#2d4a3a', rim: '#e9f1e9', rimWidth: 2.5 },
    look: { marble: 'flat', shadow: false, pattern: 'chalk', backdrop: ['#1d3127', '#122019'] },
    sound: 'tick',
  },
  neon: {
    name: 'Đèn neon',
    background: '#07010f',
    ground: { color: '#110622', rim: '#ff2bd6', rimWidth: 3 },
    look: { marble: 'glow', shadow: false, pattern: 'plain', backdrop: ['#0b0221', '#2a0845'] },
    sound: 'glass',
  },
  space: {
    name: 'Vũ trụ',
    background: '#000510',
    ground: { color: '#0d1b2a', rim: '#4cc9f0', rimWidth: 3 },
    look: { marble: 'gem', shadow: false, pattern: 'dots', backdrop: ['#000814', '#001d3d'] },
    sound: 'glass',
  },
  factory: {
    name: 'Nhà máy thép',
    background: '#15181c',
    ground: { color: '#3d434c', rim: '#a9b2bd', rimWidth: 3 },
    look: { marble: 'metal', shadow: true, pattern: 'plates', backdrop: ['#1d2127', '#0e1013'] },
    sound: 'metal',
  },
  candy: {
    name: 'Kẹo ngọt',
    background: '#ffe3ef',
    ground: { color: '#ffffff', rim: '#ff6fae', rimWidth: 4 },
    look: { marble: 'glass', shadow: true, pattern: 'dots', backdrop: ['#ffd6e8', '#c9f0ff'] },
    sound: 'coin',
  },
};

/** The map with its theme spelled out, for drawing and sound. The map's own settings win. */
export function applyTheme(map: MapDoc): MapDoc {
  const theme = map.theme ? THEMES[map.theme] : undefined;
  if (!theme) return map;
  return {
    ...map,
    frame: { ...map.frame, background: theme.background },
    ground: { ...theme.ground, ...map.ground },
    look: { ...theme.look, ...map.look },
    sound: map.sound ?? theme.sound,
  };
}
