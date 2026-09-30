# SQLite reservation migration

FactoryOS now stores new reservation ledgers in SQLite. Existing JSON ledgers are not automatically converted, replaced or deleted. This guide covers local migration of the reservation service only; browser orders, execution gates and real inventory ownership do not change.

## Prepare and preview

Use Node 24.16 or newer within Node 24 and npm 11.13.0. Stop every service using the target data directory, retain a separate backup of the stopped directory, and build the commands:

```sh
npm ci --no-audit --no-fund
npm run build:server
npm run reservations:migrate -- preview --directory ".factoryos-data"
```

Use the actual data directory if it differs. `FACTORYOS_DATA_DIR` supplies the default when `--directory` is omitted. Preview does not create a directory, lock, database or other file. It validates the original envelope checksum and full receipt replay, then reports only counts, source bytes and a SHA-256 checksum of the exact source file. It does not print order records, notes or local paths. A service lock or interrupted-write artifact blocks preview.

Review the source revision, order count, active holds, retained reservations, event count and receipt count. The reported checksum is of the entire file, not just the checksum field inside its JSON envelope. Preview cannot prove that no process will start afterward; apply rechecks ownership and source bytes.

## Apply the reviewed source

Replace `REVIEWED_SHA256` with the complete 64-character checksum from preview:

```sh
npm run reservations:migrate -- apply --directory ".factoryos-data" --checksum REVIEWED_SHA256
```

Apply acquires the same exclusive directory lock as the old service and revalidates the source. It creates a uniquely named candidate database, commits all imported state and migration metadata in one transaction, reads the result back, and publishes it without overwriting an existing destination. The original `reservations.json` is retained byte-for-byte. A changed source, invalid history, unexpected database, unsupported schema, active lock or interrupted artifact causes a failure instead of a reset.

Only after apply succeeds, start `npm run start:server` with the same data-directory setting. Reconnect the browser, inspect holds and history, and verify any previously pending command by retrying that exact command where it is still available. Migration preserves stored request identities and receipts, but does not recover in-memory browser drafts or pending requests lost by closing a page.

Repeating apply with the same verified source is safe after a confirmed publication, even if newer commands exist in the database. It validates the matching migration receipt without restoring the old state. Its counts still describe the imported source, not the current database revision. If an interrupted candidate remains, stop and follow recovery guidance instead of removing it to force a retry.

## Retain and recover

Keep `reservations.sqlite` and the exact original `reservations.json` together. Startup requires the original source checksum to match the database's migration receipt. Deleting, editing or reformatting that source blocks reopening; the service never silently recreates it. A fresh SQLite ledger has no JSON source or migration receipt. The current compatibility writer refuses to write JSON in a directory containing SQLite or migration artifacts.

Do not start an older service binary on a migrated directory. Do not rename files to select a storage engine. There is no automatic rollback, reset, repair or source-deletion command. Preserve the complete directory when investigating a failure, including `.reservations.lock`, candidate files and SQLite sidecars. Manual lock recovery requires first verifying that its owner has stopped. Review a copy with a maintainer before cleanup or restoration.

The runtime supports a single local owner and a local filesystem that supports hard links for non-overwriting publication. Network filesystems, multiple application processes, cloud deployment, user authorization and automatic backups are not validated here. Logical release headroom does not reserve physical disk space. The full-replay capacity limits remain in place; SQLite adoption is not a claim of unlimited throughput.

## Runtime and verification

The previous phase used Node 20. Node's [release schedule](https://nodejs.org/en/about/previous-releases) now lists Node 20 as end-of-life and Node 24 as LTS. FactoryOS uses the already available Node 24 runtime and a pinned `better-sqlite3` 13.0.3 driver; its [published manifest](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/package.json) requires Node 22 or newer and includes platform builds. Other portfolio repositories are not upgraded by this change.

The project `.npmrc` enforces the supported engine and disables automatic dependency lifecycle scripts. The current locked dependencies supply prebuilt runtime assets. This avoids an unnecessary `node-gyp` rebuild observed during clean installation with npm 11.13.0 despite the SQLite package declaring `gypfile: false`. Explicit commands such as `npm run check`, `npm run build:server` and `npx playwright install --with-deps chromium` still run. Reassess this policy when changing dependencies; a future package may genuinely require an install hook, and platforms without a bundled binary are not silently given a compiler fallback. Do not edit installed packages to make a local validation pass.

`npm run check` exercises both the retained JSON regression suite and SQLite database, migration, CLI and HTTP tests. `npm run test:e2e` starts the SQLite-backed service and verifies a genuine database file with no JSON ledger for fresh browser fixtures. The Windows/Linux CI workflow uses read-only repository permissions and pinned action revisions. Adding this workflow does not establish a successful hosted run; local results and hosted execution must be reported separately.
