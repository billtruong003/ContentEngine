// The open map plus its undo history. Each entry keeps the whole map before and after, which is small
// (a few KB) and means any change, from any source, undoes the same way.
import { apply, type Command } from './commands.ts';
import { formatMap } from '../map/format.ts';
import type { MapDoc } from '../map/types.ts';

/** Who made a change: the person at the mouse, a script through window.__editor, or someone editing the file on disk. */
export type Source = 'người' | 'script' | 'file';

export interface Entry {
  label: string;
  source: Source;
  before: string;
  after: string;
}

const LIMIT = 300;

export class History {
  map: MapDoc;
  /** File name under maps/ without .json, or null for a map never saved. */
  file: string | null;
  saved: string;
  readonly undone: Entry[] = [];
  readonly done: Entry[] = [];
  onChange: () => void = () => {};
  private gesture: { label: string; before: string } | null = null;

  constructor(map: MapDoc, file: string | null) {
    this.map = map;
    this.file = file;
    this.saved = formatMap(map);
  }

  get dirty(): boolean {
    return formatMap(this.map) !== this.saved;
  }

  /** Runs commands as one undo step. If any of them fails, the map is left as it was and the error is thrown. */
  run(label: string, cmds: Command[], source: Source = 'người'): unknown[] {
    const before = JSON.stringify(this.map);
    try {
      const results = cmds.map((c) => apply(this.map, c));
      this.commit(label, before, source);
      return results;
    } catch (e) {
      this.map = JSON.parse(before);
      this.onChange();
      throw e;
    }
  }

  /** A drag: call begin, change `map` freely while the mouse moves, then end to make it one undo step. */
  begin(label: string): void {
    this.gesture = { label, before: JSON.stringify(this.map) };
  }

  end(): void {
    if (!this.gesture) return;
    const { label, before } = this.gesture;
    this.gesture = null;
    this.commit(label, before, 'người');
  }

  /** Replaces the whole map (opening a file, or the file changed on disk) as an undoable step. */
  replace(map: MapDoc, label: string, source: Source): void {
    const before = JSON.stringify(this.map);
    this.map = map;
    this.commit(label, before, source);
  }

  undo(): Entry | undefined {
    const e = this.done.pop();
    if (!e) return;
    this.undone.push(e);
    this.map = JSON.parse(e.before);
    this.onChange();
    return e;
  }

  redo(): Entry | undefined {
    const e = this.undone.pop();
    if (!e) return;
    this.done.push(e);
    this.map = JSON.parse(e.after);
    this.onChange();
    return e;
  }

  private commit(label: string, before: string, source: Source): void {
    const after = JSON.stringify(this.map);
    if (after !== before) {
      this.done.push({ label, source, before, after });
      if (this.done.length > LIMIT) this.done.shift();
      this.undone.length = 0;
    }
    this.onChange();
  }
}
