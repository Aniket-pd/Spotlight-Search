#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/build.js <chrome|safari>');
  process.exit(1);
}

const manifestSource = path.join(__dirname, '..', 'manifests', `${target}.json`);
if (!fs.existsSync(manifestSource)) {
  console.error(`Unknown target "${target}". Expected manifests/${target}.json`);
  process.exit(1);
}

const distRoot = path.join(__dirname, '..', 'dist');
const distDir = path.join(distRoot, target);

function copyRecursive(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }
  const stats = fs.statSync(source);
  if (stats.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      const srcEntry = path.join(source, entry);
      const destEntry = path.join(destination, entry);
      copyRecursive(srcEntry, destEntry);
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const entriesToCopy = ['icons', 'src', 'README.md', 'COMMAND_DEVELOPMENT.md', 'DESIGN_SYSTEM.md'];
for (const entry of entriesToCopy) {
  copyRecursive(path.join(__dirname, '..', entry), path.join(distDir, entry));
}

fs.copyFileSync(manifestSource, path.join(distDir, 'manifest.json'));

console.log(`Built Spotlight Search for ${target} in ${path.relative(process.cwd(), distDir)}`);
