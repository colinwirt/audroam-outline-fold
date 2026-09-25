# Publish `@audroam/outline-fold` (Colin)

Branding: **audroam** only (not thisvision). Package name: `@audroam/outline-fold`.

## Auth (required — currently missing on box + MSB2)

```bash
gh auth login
# or set GH_TOKEN with repo+workflow scopes
```

## Create public repo

Prefer org `audroam` if you have it:

```bash
gh org list
gh repo create audroam/outline-fold --public --source=. --remote=origin --description "Audroam outline fold language (parse/serialize/fold+/fold-)"
```

Else on user:

```bash
gh repo create audroam-outline-fold --public --source=. --remote=origin
```

Then:

```bash
cd /workspace/audroam/packages/outline-fold   # or C:\code\audroam\packages\outline-fold
git init
git add .
git commit -m "v0.1.0: outline-fold core, icons, toHtml, examples"
git branch -M main
git push -u origin main
# update package.json repository.url to the chosen remote
npm publish --access public   # when ready; needs npm login to @audroam scope
```

No force-push. No secrets in the tree.

## MSB2 mirror (if extract pending)

Tarball staged at `%TEMP%\outline-fold.tgz`. Then:

```powershell
New-Item -ItemType Directory -Force -Path C:\code\audroam\packages
tar -xzf $env:TEMP\outline-fold.tgz -C C:\code\audroam\packages
cd C:\code\audroam\packages\outline-fold
npm install
npm test
```
