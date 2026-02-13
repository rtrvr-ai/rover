#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// Get version from command line
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('❌ Error: No version provided');
  console.log('Usage: node scripts/bump-version.mjs <version>');
  console.log('Example: node scripts/bump-version.mjs 0.1.2');
  process.exit(1);
}

// Validate version format (basic semver check)
const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
if (!semverRegex.test(newVersion)) {
  console.error(`❌ Error: Invalid version format "${newVersion}"`);
  console.log('Version must follow semver: MAJOR.MINOR.PATCH (e.g., 0.1.2, 1.0.0-beta.1)');
  process.exit(1);
}

// List of all package.json files to update
const packageJsonPaths = [
  'package.json', // root
  'packages/a11y-tree/package.json',
  'packages/shared/package.json',
  'packages/dom/package.json',
  'packages/instrumentation/package.json',
  'packages/bridge/package.json',
  'packages/worker/package.json',
  'packages/ui/package.json',
  'packages/sdk/package.json',
  'packages/tsconfig/package.json',
  'packages/storage/package.json',
  'packages/system-tool-utilities/package.json',
];

console.log(`🚀 Bumping version to ${newVersion}...\n`);

let updatedCount = 0;
let skippedCount = 0;

for (const pkgPath of packageJsonPaths) {
  const fullPath = resolve(rootDir, pkgPath);

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const pkg = JSON.parse(content);
    const oldVersion = pkg.version;

    // Update version
    pkg.version = newVersion;

    // Write back with pretty formatting
    writeFileSync(fullPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

    console.log(`✅ ${pkgPath.padEnd(50)} ${oldVersion} → ${newVersion}`);
    updatedCount++;
  } catch (error) {
    console.log(`⚠️  ${pkgPath.padEnd(50)} (skipped: ${error.message})`);
    skippedCount++;
  }
}

console.log(`\n✨ Done! Updated ${updatedCount} package(s)`);
if (skippedCount > 0) {
  console.log(`⚠️  Skipped ${skippedCount} package(s)`);
}

console.log(`\n📝 Next steps:`);
console.log(`   1. git add -A`);
console.log(`   2. git commit -m "chore: bump version to ${newVersion}"`);
console.log(`   3. git tag v${newVersion}`);
console.log(`   4. git push && git push --tags`);
console.log(`\n   Or trigger manually in GitHub Actions!`);
