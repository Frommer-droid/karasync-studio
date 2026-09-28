const fs = require('node:fs');
const path = require('node:path');

if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE !== '1') {
  throw new Error('Run this script with the packaged Electron EXE in Node mode.');
}

const repoRoot = path.resolve(__dirname, '..');
const expectedVersion = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
const portableDir = path.join(repoRoot, `Karaoke-Sync-Studio-${expectedVersion}`, 'win-unpacked');
const appArchive = path.join(portableDir, 'resources', 'app.asar');
const packaged = JSON.parse(fs.readFileSync(path.join(appArchive, 'package.json'), 'utf8'));
if (packaged.version !== expectedVersion) {
  throw new Error(`Packaged version ${packaged.version} differs from ${expectedVersion}.`);
}

process.env.NODE_ENV = 'production';
process.env.PORT = String(38000 + Math.floor(Math.random() * 20000));
process.chdir(portableDir);
require(path.join(appArchive, 'dist', 'server.cjs'));

async function checkServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const baseUrl = `http://127.0.0.1:${process.env.PORT}`;
      const health = await fetch(`${baseUrl}/api/health`);
      const page = await fetch(baseUrl);
      const data = await health.json();
      if (health.ok && data.service === 'Karaoke Sync Studio API' &&
          page.ok && (await page.text()).includes('id="root"')) {
        console.log(`FROZEN_SMOKE_OK version=${packaged.version} health=${health.status} page=${page.status}`);
        process.exit(0);
      }
    } catch (_) {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Packaged server did not answer health and page requests.');
}

checkServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
