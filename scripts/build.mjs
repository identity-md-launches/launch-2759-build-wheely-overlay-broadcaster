import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
await rm(join(root, 'dist'), { recursive: true, force: true });
await mkdir(join(root, 'dist'), { recursive: true });
await cp(join(root, 'src'), join(root, 'dist'), { recursive: true });
let count = 0, bytes = 0;
async function inspect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else { count++; bytes += (await stat(path)).size; }
  }
}
await inspect(join(root, 'dist'));
console.log(`Production export: ${count} files, ${bytes.toLocaleString()} bytes. No bundler or dependencies.`);
