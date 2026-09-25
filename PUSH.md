# Publish `@audroam/outline-fold`

Package: `@audroam/outline-fold`. Repo: `colinwirt/audroam-outline-fold`.

## Auth

```bash
gh auth login
# or set GH_TOKEN with repo+workflow scopes
```

## Push (already initialized)

```bash
cd /workspace/audroam/packages/outline-fold
npm test && npm run build
git add -A
git commit -m "your message"
git push origin main
```

## npm (when ready)

```bash
npm publish --access public   # needs npm login to @audroam scope
```

No force-push. No secrets in the tree. Do not publish from docs-only scrub commits unless intentional.
