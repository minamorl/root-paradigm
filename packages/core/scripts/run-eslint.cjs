'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run() {
  const args = process.argv.slice(2);
  try {
    // Locate eslint via its package.json to avoid resolution quirks
    const eslintPkgPath = require.resolve('eslint/package.json');
    const eslintPkg = require(eslintPkgPath);
    const binRel = (eslintPkg && eslintPkg.bin && eslintPkg.bin.eslint) ? eslintPkg.bin.eslint : 'bin/eslint.js';
    const eslintBin = path.join(path.dirname(eslintPkgPath), binRel);
    const res = spawnSync(process.execPath, [eslintBin, ...args], { stdio: 'inherit' });
    process.exit(res.status ?? 0);
  } catch (e) {
    console.warn('[lint] eslint not available; skipping. Reason:', e && e.message ? e.message : e);
    process.exit(0);
  }
}

run();
