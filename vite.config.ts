// Dev server plus a small file API for the map editor: list, read and save maps and templates,
// list packs and target pictures, export a video, and tell open editors when a map file changes on disk.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const FOLDERS = { maps: 'maps', templates: 'templates', generated: 'generated' } as const;
const NAME = /^[a-z0-9][a-z0-9-]*$/;

export default defineConfig({
  plugins: [editorApi()],
  build: { rollupOptions: { input: { main: 'index.html', editor: 'editor.html' } } },
});

function editorApi(): Plugin {
  return {
    name: 'marble-editor-api',
    // Map and template files are data, not code: changing one must never reload open pages
    // (the editor would lose unsaved work). The editor hears about it through "marble:file" instead.
    handleHotUpdate({ file }) {
      if (Object.values(FOLDERS).some((d) => file.replaceAll('\\', '/').includes(`/${d}/`))) return [];
    },
    configureServer(server) {
      for (const dir of Object.values(FOLDERS)) mkdirSync(dir, { recursive: true });
      // Saves from the editor come back here too; the editor ignores content it already has.
      server.watcher.add(Object.values(FOLDERS).map((d) => join(process.cwd(), d)));
      const notify = (file: string) => {
        const folder = Object.entries(FOLDERS).find(([, d]) => file.replaceAll('\\', '/').includes(`/${d}/`))?.[0];
        if (!folder || !file.endsWith('.json')) return;
        server.ws.send({ type: 'custom', event: 'marble:file', data: { folder, name: basename(file, '.json') } });
      };
      server.watcher.on('change', notify);
      server.watcher.on('add', notify);

      server.middlewares.use('/api', async (req, res, next) => {
        try {
          const parts = (req.url ?? '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
          const [what, name] = parts;
          if (what === 'maps' || what === 'templates' || what === 'generated') {
            const dir = FOLDERS[what];
            if (!name) return json(res, list(dir));
            if (!NAME.test(name)) return json(res, { error: `Tên file chỉ gồm chữ thường không dấu, số và gạch ngang: "${name}"` }, 400);
            const file = join(dir, `${name}.json`);
            if (req.method === 'GET') return existsSync(file) ? json(res, JSON.parse(readFileSync(file, 'utf8'))) : json(res, { error: `Không có ${file}` }, 404);
            if (req.method === 'PUT') {
              const body = await read(req);
              JSON.parse(body);
              writeFileSync(file, body.endsWith('\n') ? body : body + '\n');
              return json(res, { saved: file });
            }
          }
          if (what === 'packs') {
            const root = 'public/packs';
            const packs = existsSync(root)
              ? readdirSync(root).filter((p) => existsSync(join(root, p, 'pack.json'))).map((p) => {
                const pack = JSON.parse(readFileSync(join(root, p, 'pack.json'), 'utf8'));
                return { name: p, characters: Object.keys(pack.characters) };
              })
              : [];
            return json(res, packs);
          }
          if (what === 'targets') return json(res, existsSync('public/targets') ? readdirSync('public/targets') : []);
          if (what === 'render' && req.method === 'POST' && name && NAME.test(name)) return render(name, res);
          next();
        } catch (e) {
          json(res, { error: (e as Error).message }, 500);
        }
      });
    },
  };
}

function list(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

// Runs the same exporter as `npm run render` and streams its output lines back.
function render(name: string, res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  const child = spawn(process.execPath, ['scripts/render.ts', name], { cwd: process.cwd() });
  const pass = (chunk: Buffer) => res.write(chunk.toString().replaceAll('\r', '\n'));
  child.stdout.on('data', pass);
  child.stderr.on('data', pass);
  child.on('close', (code) => res.end(`\n[exit ${code}]\n`));
}

function read(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
