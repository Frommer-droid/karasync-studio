const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
const portableDir = path.join(repoRoot, `Karaoke-Sync-Studio-${version}`, 'win-unpacked');
const electronExe = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const probe = path.join(__dirname, 'release-smoke.cjs');

if (!fs.existsSync(path.join(portableDir, 'resources', 'app.asar'))) {
  throw new Error(`Packaged app not found: ${portableDir}`);
}

const result = spawnSync(electronExe, [probe], {
  cwd: portableDir,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 15_000,
  windowsHide: true,
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error || result.status !== 0 || !result.stdout?.includes('FROZEN_SMOKE_OK')) {
  throw result.error || new Error(`Frozen smoke failed with exit status ${result.status}.`);
}
