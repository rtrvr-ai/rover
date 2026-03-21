# Release Guide

This document explains how to release new versions of the Rover SDK.

## Quick Reference

**Current Version:** Check [packages/sdk/package.json](packages/sdk/package.json)
**NPM Package:** [@rtrvr-ai/rover](https://www.npmjs.com/package/@rtrvr-ai/rover)

---

## Release Methods

You can release a new version in two ways:

### Method 1: GitHub Workflow (Recommended)

Two-step process that respects branch protection rules:

**Step 1 — Create release PR:**

1. Go to **Actions** tab in GitHub
2. Select **"Release & Publish to npm"** workflow
3. Click **"Run workflow"**
4. Enter the new version (e.g., `0.1.2`)
5. Click **"Run workflow"**

This bumps all package.json files and creates a PR from `release/v0.1.2` → `main`.

**Step 2 — Merge and tag:**

```bash
# Merge the PR (via GitHub UI or CLI)
gh pr merge release/v0.1.2 --squash

# Pull and push the tag to trigger npm publish
git pull origin main
git tag v0.1.2
git push origin v0.1.2
```

**What happens on tag push:**
- ✅ Builds all packages
- ✅ Publishes to npm
- ✅ Creates GitHub Release

---

### Method 2: Local (Manual)

```bash
# 1. Create a release branch
git checkout -b release/v0.1.2

# 2. Bump version in all packages
pnpm version:bump 0.1.2

# 3. Commit and push
git add -A
git commit -m "chore: bump version to 0.1.2"
git push origin release/v0.1.2

# 4. Create PR, get it reviewed, merge
gh pr create --title "chore: release v0.1.2" --base main

# 5. After merge, push the tag to trigger publish
git checkout main && git pull
git tag v0.1.2
git push origin v0.1.2
```

**What happens on tag push:**
- ✅ Builds all packages
- ✅ Publishes to npm
- ✅ Creates GitHub Release

---

## Version Bump Script

The `pnpm version:bump <version>` command updates version in all packages:

- ✅ Root `package.json`
- ✅ All workspace packages (`packages/*/package.json`)

**Examples:**

```bash
# Patch release (bug fixes)
pnpm version:bump 0.1.3

# Minor release (new features)
pnpm version:bump 0.2.0

# Major release (breaking changes)
pnpm version:bump 1.0.0

# Pre-release
pnpm version:bump 1.0.0-beta.1
```

---

## Versioning Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **Patch** (0.1.X): Bug fixes, no breaking changes
- **Minor** (0.X.0): New features, backward compatible
- **Major** (X.0.0): Breaking changes

**Examples:**
- Fix bug in SDK → `0.1.2` → `0.1.3`
- Add new API method → `0.1.3` → `0.2.0`
- Change API signature → `0.2.0` → `1.0.0`

---

## Troubleshooting

### "Version already published" Error

If you see:
```
npm error 403 You cannot publish over the previously published versions: 0.1.2
```

**Solution:** Bump to a higher version number. npm doesn't allow republishing the same version.

### Build Fails in GitHub Actions

1. Check the Actions tab for error logs
2. Run `pnpm build` locally to verify it works
3. Ensure all tests pass before releasing

### Tag Already Exists

If you need to recreate a tag:
```bash
# Delete local tag
git tag -d v0.1.2

# Delete remote tag
git push origin :refs/tags/v0.1.2

# Create new tag
git tag v0.1.2
git push --tags
```

---

## What Gets Published

The npm package includes:
- `dist/rover.js` - Standalone SDK bundle
- `dist/embed.js` - Embed script
- `dist/worker/rover-worker.js` - Web Worker bundle
- `dist/index.d.ts` - TypeScript definitions
- `dist/loader.js` - Lazy loader

See [packages/sdk/package.json](packages/sdk/package.json) `files` field for details.

---

## Checklist Before Release

- [ ] All tests passing locally (`pnpm test`)
- [ ] Build works (`pnpm build`)
- [ ] Changes documented in commit messages
- [ ] Version number follows semver
- [ ] Breaking changes noted (if major version)

---

## Post-Release

After successful release:

1. **Verify npm:** https://www.npmjs.com/package/@rtrvr-ai/rover
2. **Check GitHub Release:** https://github.com/rtrvr-ai/rover/releases
3. **Update documentation** if needed
4. **Announce in Discord/Slack** (if applicable)

---

## CI/CD Workflows

### `release.yml` (Two-phase)
- **Phase 1** (workflow_dispatch): Bumps versions, creates release PR
- **Phase 2** (tag push `v*.*.*`): Builds packages, publishes to npm, creates GitHub Release

### `build-deploy.yml` (Auto on Push)
- Triggers: Push to `main` branch
- Builds SDK artifacts
- Deploys to Vercel (rtrvr-cloud-website)
- **Does NOT** publish to npm (moved to `release.yml`)

---

## Questions?

- Issues: [GitHub Issues](https://github.com/rtrvr-ai/rover/issues)
- Workflow files: `.github/workflows/`
- Bump script: `scripts/bump-version.mjs`
