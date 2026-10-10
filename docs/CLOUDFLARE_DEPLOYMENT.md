# Cloudflare Workers automatic deployment

Use Cloudflare Workers Builds to deploy this repository to the existing
`source-first-paper-trader` Worker on pushes to `main`.

Production URL: <https://source-first-paper-trader.kuilef42.workers.dev/>.

This document records the intended configuration and verification procedure. It
does not establish that a particular commit has been deployed successfully.

## Build settings

Open the existing Worker in Cloudflare, then **Settings → Builds**. Connect
`kuilef/source-first-paper-trader` and use:

- Production branch: `main`
- Automatic builds: enabled (`Disable builds` off)
- Root directory: `/` (the repository root)
- Build variable: `NODE_VERSION=24`
- Build token: an authorized Cloudflare Workers Builds token

Build command:

```sh
test -n "$WORKERS_CI_COMMIT_SHA" && BUILD_REVISION="$WORKERS_CI_COMMIT_SHA" npm run package:worker
```

Deploy command:

```sh
npx --yes wrangler@4 deploy artifacts/source-first-worker.mjs --name source-first-paper-trader --compatibility-date 2026-07-01 --no-bundle
```

Inspect the complete saved command values; a truncated dashboard summary is not
enough to confirm them. Keep non-production branch builds disabled unless preview
deployments are wanted.

Cloudflare installs dependencies before the build. Keep `package-lock.json`
committed and automatic dependency installation enabled. Node 24 matches the
repository's engine requirement and GitHub Actions workflow. The deploy command
uses Wrangler 4; this repository does not currently pin an exact Wrangler version.

Cloudflare supplies `WORKERS_CI_COMMIT_SHA` for each build. Passing it as
`BUILD_REVISION` stamps that pushed commit into `release.json`; do not save a fixed
commit SHA as a dashboard variable. The command stops if the injected SHA is
missing.

Cloudflare's [build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
and [build image](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
documentation describe these settings and variables. A new GitHub authorization
or build token must be approved by the account owner. Keep tokens out of the
repository; the application itself needs no runtime secrets.

## Preserve the standalone Worker deployment

`npm run package:worker` builds the app and embeds its public text assets into
`artifacts/source-first-worker.mjs`. This ES-module Worker also serves the proxy,
logo, favicon and security headers. It requires no uploaded asset directory,
`ASSETS` binding or Node compatibility flag.

The deploy command explicitly selects that generated module and the existing
Worker name. Wrangler supports these [deployment options](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy).
An explicit script path bypasses automatic framework configuration. No Wrangler
configuration file is required for this command.

The ordinary `npm run build` output is the separate Pages deployment format.
Do not replace the command above with bare `wrangler deploy`,
`wrangler pages deploy`, or `wrangler deploy --assets dist`. The standalone
deployment preserves the existing `workers.dev` URL.

## Normal release workflow

1. Push an intended source or documentation change to `main`.
2. Cloudflare starts a build for that commit, runs the build command, then runs
   the deploy command. A successful production deployment updates the existing
   Worker.
3. GitHub Actions runs its separate verification and packaging workflow for the
   same commit. Workers Builds does not wait for this workflow to pass; it is a
   separate pipeline.
4. Verify the build, active deployment and public release below before reporting
   the release as complete.

See Cloudflare's [existing-Worker setup](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker).
Documentation-only pushes also trigger builds unless build watch paths have been
configured to exclude them.

## Verify a release and investigate failures

- Copy the full expected commit SHA from GitHub `main` or the specific release
  commit. If working from a normal checkout, `git rev-parse HEAD` gives its SHA;
  confirm that it matches the remote commit being released.
- Check [GitHub Actions](https://github.com/kuilef/source-first-paper-trader/actions)
  for that exact SHA. A green verification workflow alone does not prove that
  Cloudflare deployed it.
- In the existing Worker's **Deployments → View build history**, open the build
  for the same SHA. Check dependency installation, both command values and the
  build/deploy logs. Confirm the resulting version is the active production
  deployment, rather than only a preview or an uploaded version.
- Retrieve the public release marker and compare `sourceCommit` with the complete
  expected SHA:

  ```sh
  curl --fail --silent --show-error --header 'Cache-Control: no-cache' \
    https://source-first-paper-trader.kuilef42.workers.dev/release.json
  ```

- Check the page, `/logo.png`, `/favicon.ico`, the replay entry/exit and old-event
  abstention. Check the deployed public-source adapter:

  ```sh
  npm run live-smoke -- https://source-first-paper-trader.kuilef42.workers.dev/
  ```

- Perform one live scan in the browser when sources are reachable, then stop the
  agent. Report unavailable sources honestly; passing replay tests is not proof
  that live upstream requests succeeded.

If no build appears, inspect the repository connection, production branch,
`Disable builds` switch and build watch paths. If a build fails, inspect its logs
before retrying. Settings saved before a retry apply to that retry. Do not reuse
an old local artifact to stand in for the intended commit. Cloudflare's
[build troubleshooting guide](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/)
covers missing entry points, Worker-name mismatches and stale build tokens.
