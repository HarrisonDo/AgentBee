import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(root, 'package.json');
const lockPath = resolve(root, 'package-lock.json');

const packageJson = await readJson(packagePath);
const nextVersion = bumpPatchVersion(packageJson.version);
packageJson.version = nextVersion;
await writeJson(packagePath, packageJson);

const lockJson = await readJson(lockPath);
lockJson.version = nextVersion;
if (lockJson.packages?.['']) {
  lockJson.packages[''].version = nextVersion;
}
await writeJson(lockPath, lockJson);

console.log(`BeeWeb version bumped to ${nextVersion}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function bumpPatchVersion(version) {
  const parts = String(version).split('.');
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  parts[2] = String(Number(parts[2]) + 1);
  return parts.join('.');
}
