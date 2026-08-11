# Bachi

Bachi is a browser-only editor for Taiko no Tatsujin Nijiiro data. It has no
application backend: project files are opened, decoded, edited, and saved
locally by the browser.

[Open Bachi](https://bachi-editor.github.io/)

This directory is the complete standalone application and is published as the
root of the [public source repository](https://github.com/bachi-editor/bachi-editor).
Private game dumps and reference projects are not part of the application.

## Browser support

Bachi requires a Chromium-based browser with the File System Access API,
IndexedDB, WebCrypto, CompressionStream, Web Audio, and workers. Chrome, Edge,
Brave, Arc, Opera, and comparable Chromium browsers are supported. Safari and
Firefox do not provide the required filesystem picker APIs.

Use the hosted HTTPS site or a localhost development server. AES keys and the
optional G.719 decoder and encoder modules are supplied by the user; none are
bundled in the production build.

## Development

Install Node.js 20 or newer and run:

```bash
npm ci
npm run dev
```

The release gates and production build are:

```bash
npm run typecheck
npm test
npm run build
```

The minified static site is written to `dist/`. Its asset URLs are relative, so
the same build works at a domain root or below a repository path.

### Corpus-backed tests

`npm test` passes on a bare clone. The corpus-backed codec and format checks
skip themselves when their inputs are absent and the run prints a banner listing
what is missing; everything that does not need the corpus still runs and must
pass. Nothing here is ever committed or bundled — the AES keys, the game/server
corpus, and the G.719 binaries are all excluded from the production build.

To run the full suite, copy `.env.example` to `.env` and fill in what you have:

```bash
cp .env.example .env
```

| Variable | Purpose | Default |
| --- | --- | --- |
| `BACHI_DATATABLE_KEY`, `BACHI_FUMEN_KEY` | AES-256 keys, 64 hex chars each | read from the TaikoArcadeLoader source under the corpus root |
| `BACHI_RESOURCES_DIR` | maintainer's game/server corpus | `../resources` |
| `BACHI_G719_DIR` | directory holding `g719.wasm` and `g719-encoder.wasm` | `vendor/g719`, else `$BACHI_RESOURCES_DIR/g719` |

`.env` is gitignored and read only by the test suite. Shell variables override
it. A malformed key fails the run rather than skipping, so typos surface.
Proprietary codec binaries go in `vendor/g719/` — see `vendor/README.md`.

## Deployment

`.github/workflows/deploy-pages.yml` runs the release gates on every push to
`main` and publishes the build.

The site is served from a **separate repository**, `bachi-editor.github.io`,
whose Pages source is branch `main` at `/`. That is what serves the app from the
domain root. Publishing therefore pushes `dist/` to that repository rather than
deploying Pages from this one — a Pages site enabled here would live at
`/bachi-editor/` instead. The published branch is exactly the build output:
tracked files are dropped and replaced each run, so removals propagate.

Deploying cross-repo needs a token, since the built-in `GITHUB_TOKEN` cannot
write to another repository. One-time setup:

1. Create a fine-grained personal access token scoped to
   `bachi-editor/bachi-editor.github.io` with **Contents: Read and write**.
2. Add it to this repository as the secret `PAGES_DEPLOY_TOKEN`
   (Settings → Secrets and variables → Actions).

The deploy job fails with a pointer to this section if the secret is missing.
Runs are serialized on a `github-pages` concurrency group and queue rather than
cancel, so a slow deploy cannot be overtaken by a newer one.

## Manage version and changelog information

The About dialog reads the current version from `package.json` and the dated
changelog structure from `src/releaseNotes.ts`. All release titles and bullet
text live in the normal four-language catalog at `src/i18n/messages.ts`.

For a release:

1. Run `npm version <version> --no-git-tag-version` from `app/`. This updates
   both `package.json` and `package-lock.json` without creating a Git tag.
2. Prepend the matching version, ISO date, title key, and change keys to
   `RELEASE_NOTES` in `src/releaseNotes.ts`. Keep entries newest-first.
3. Add every new key to `src/i18n/messages.ts` in English, Japanese, Simplified
   Chinese, and Traditional Chinese.
4. Run `npm run typecheck` and `npm test`. The release-information test rejects
   a newest changelog entry that does not match the package version.

## Local data and safety

Bachi does not upload project files. Folder handles and optional WASM modules
are kept in IndexedDB; AES keys, language, and theme are kept in localStorage.
Browser storage can be cleared by the browser or user, so it is not a backup.

Writes and deletions target the files selected by the user. Multi-file saves
are ordered but are not transactional as a group. Keep external backups of any
production game or server data you edit.

## Third-party software

Bundled third-party components and their license texts are documented in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Font licenses are under
`public/fonts/`.

## License

Bachi is available under the [MIT License](LICENSE).
