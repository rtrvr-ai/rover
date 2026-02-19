# rover
Embedded Fully Autonomous Agent - For Websites

## Rover v1 contract

- Server-authoritative runtime contract: `/v1/rover/*` on `extensionrouter.rtrvr.ai`.
- Bootstrap with `publicKey` (`pk_site_*`), then runtime uses short-lived `sessionToken` (`rvrsess_*`).
- In API mode, failed `/run/input` is terminal for that turn (no silent local fallback run).
- Authoritative backend + infra runbook:  
  `/Users/bhavanikalisetty/work/act_2/rtrvr-cloud-backend/README.md`

Primary integration docs:
- `/Users/bhavanikalisetty/work/act_2/rover/docs/INTEGRATION.md`
- `/Users/bhavanikalisetty/work/act_2/rover/docs/TESTING.md`

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
