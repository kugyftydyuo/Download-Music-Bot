import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(name));
    else if (name.endsWith('.js')) result.push(name);
  }
  return result;
}
let failed = false;
const groups = await Promise.all(['src', 'scripts', 'test'].map(files));
for (const file of groups.flat()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
console.log(failed ? 'Проверка синтаксиса не пройдена.' : 'Синтаксис всех JS-файлов проверен.');
process.exitCode = failed ? 1 : 0;
