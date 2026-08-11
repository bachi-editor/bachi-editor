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

The full test suite includes corpus-backed codec and format checks. Those tests
expect the maintainer's separately held game/server corpus under `../resources`;
the corpus, production AES keys, and G.719 reference binaries are intentionally
excluded from the production build. The application can still install,
typecheck, and build without those resources.

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
