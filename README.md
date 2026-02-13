# rover
Embedded Fully Autonomous Agent - For Websites

## Development

- **Build:** `pnpm build`
- **Dev Server:** `pnpm dev` (runs demo app on port 5174)
- **Lint:** `pnpm lint`

## Releasing

See [RELEASE.md](RELEASE.md) for detailed release instructions.

**Quick release:**
```bash
pnpm version:bump 0.1.2
git add -A && git commit -m "chore: bump version to 0.1.2"
git tag v0.1.2
git push && git push --tags
```
