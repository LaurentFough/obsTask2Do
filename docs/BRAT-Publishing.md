---
title: Task2Do — BRAT Publishing and Installation
description: Repeatable GitHub release workflow and BRAT installation, updates and recovery.
slug: task2do-brat-publishing
author: El
type: software-runbook
date-created: 2026-11-06
date-modified: 2026-11-06
date-published: null
source: [Task2Do release workflow, BRAT developer guide, GitHub documentation]
domain: IT
url: https://github.com/LaurentFough/obsTask2Do
draft: false
tags: [task2do, obsidian, brat, github, publishing]
keywords: [release, prerelease, beta, updates, installation]
---

# Task2Do publishing through BRAT

Task2Do is distributed as GitHub release assets. BRAT downloads the published `main.js`, `manifest.json` and `styles.css`; users need neither Node.js nor a source checkout. The plugin is desktop-only and currently alpha. Live provider testing is separate from the automated release checks.

## Publish from GitHub

1. Commit the intended source and generated `main.js`. Keep the same version in `manifest.json` and `package.json`; add that version and its minimum Obsidian version to `versions.json`.
2. Push to the intended branch. For the current alpha-only project, `main` is the normal release source.
3. Open [Actions → Release Task2Do](https://github.com/LaurentFough/obsTask2Do/actions/workflows/release.yml).
4. Click **Run workflow**, select the intended branch, and enter the exact manifest version, initially `0.9.0-alpha.2`. Do not add a `v` prefix.
5. Run the workflow and inspect its result. It validates versions, rebuilds and checks the committed bundle, runs syntax checks and tests, and prepares the assets.
6. After validation, it creates the exact-version tag when missing, creates a draft release, uploads all four assets, and publishes the release. Versions containing a hyphen are marked as prereleases.
7. Verify the published release contains `main.js`, `manifest.json`, `styles.css` and `appcast.json`, then test installation in a disposable desktop vault through BRAT.

No personal access token or extra repository secret is needed: GitHub Actions uses its repository-scoped `GITHUB_TOKEN` with Contents write permission. GitHub Actions must be enabled; repository/organization policies must allow the workflow's requested permission and the checkout/setup-node actions. The release job uses Node.js 22; the project has no install-time npm dependencies.

A source push alone does not publish an update. Maintainers explicitly publish a version through this workflow or by pushing its tag.

## Publish with a Git tag

After updating all version files and committing the built bundle:

```sh
npm run build
npm run check
npm test
npm run release
git add main.js manifest.json package.json versions.json
#= Include any changed source and documentation in the release commit as well.
git commit -m "Prepare Task2Do VERSION"
git push origin main
git tag VERSION
git push origin refs/tags/VERSION
```

Replace `VERSION` with the exact manifest version. Push the tag to the intended tested commit, never to an unrelated checkout. A user-pushed tag triggers the same release job. A tag created by the manual workflow's `GITHUB_TOKEN` does not trigger a second job; that run publishes the release itself.

## What users do

1. In desktop Obsidian, open **Settings → Community plugins** and install and enable **BRAT** (Obsidian42 – BRAT).
2. Open BRAT's settings and choose its command to add a beta plugin.
3. Enter `https://github.com/LaurentFough/obsTask2Do` (or `LaurentFough/obsTask2Do`). Choose the latest version, or explicitly choose an available release to pin it.
4. Enable **Task2Do** in Community plugins if BRAT has not enabled it.
5. Open **Settings → Task2Do**. Start with the local todo.txt provider or configure the desired provider.

Use BRAT 1.1.0 or newer for release-based selection. Latest installs follow the highest available release/prerelease by semantic version; frozen installs stay on the selected version. Enable BRAT's automatic update options if desired, or invoke its update command. Reload Task2Do or restart Obsidian when requested. BRAT must remain installed and enabled to manage these updates.

The installation identifier and folder remain `task2do`. For an existing manual installation, back up the vault and `.obsidian/plugins/task2do/`, including `data.json` and `credentials.enc` if present, before letting BRAT manage it. Keep only one enabled Task2Do installation. Credential unlocking after restart still applies. Never upload vault data or credentials as release assets.

## Release contract and channels

| Item | Requirement |
| --- | --- |
| Tag | Exact manifest version, e.g. `0.9.0-alpha.2`; no `v` prefix |
| Installation assets | Three separate, correctly named files: `main.js`, `manifest.json`, `styles.css` |
| Additional asset | `appcast.json` contains exact asset URLs, sizes and SHA-256 hashes |
| Alpha/beta builds | Hyphenated version, GitHub prerelease flag |
| Stable builds | Plain version such as `1.0.0`; regular GitHub release |
| Plugin identity | `manifest.json` ID `task2do`; retained across updates |
| Visibility | Public, published release; draft releases are unavailable to normal users |

BRAT does not use Task2Do's custom appcast. There is no built-in Task2Do updater. GitHub's automatic source ZIP/tarball is not the BRAT installation package. A release containing only the source archive cannot be installed by BRAT.

Current BRAT latest selection can include prereleases; GitHub's “Latest” badge does not provide a separate stable BRAT channel. Once Task2Do has a stable native Obsidian distribution, keep alpha version changes on a beta branch and tag that commit; retain the released stable manifest on the default branch. Current BRAT reads the release manifest directly, so `manifest-beta.json` is unnecessary. Obsidian's native version comparison differs from full semver; use BRAT for the transition from an alpha to its corresponding stable version, or follow the developer guide's higher-version guidance.

## Failed runs and recovery

- Validation failure: fix the source/version mismatch and rerun before publishing anything. A manually triggered run creates no remote tag or release until validation succeeds.
- Existing tag pointing elsewhere: do not move it. Select its original source or use a new version.
- Existing published release: the workflow refuses to replace it. Publish fixes under a new version.
- Failed draft/upload: inspect the retained draft. Finish the upload/publication manually after verifying every asset, or delete the unpublished draft and rerun against the same tagged commit. Never delete a published release to reuse its version.
- Authentication/403: review Actions enablement, Contents write policy and tag rules. Tags may be restricted independently of branch pushes.
- User cannot see the version: confirm the release is published, has all installation assets, and has a valid manifest. Check whether BRAT is pinned to another version.
- Rollback: back up current data, select a known-good release through BRAT's specific-version option, and inspect settings compatibility before enabling it. A code rollback does not roll back vault/task data or reverse remote changes.

## References

```bibtex
@online{bratDevelopers2026,
  author = {TfTHacker},
  title = {BRAT Guide for Plugin Developers},
  url = {https://tfthacker.com/brat-developers},
  urldate = {2026-11-06}
}
@online{githubReleaseCLI2026,
  author = {GitHub},
  title = {GitHub CLI: gh release create},
  url = {https://cli.github.com/manual/gh_release_create},
  urldate = {2026-11-06}
}
@online{githubToken2026,
  author = {GitHub},
  title = {Use GITHUB_TOKEN for authentication in workflows},
  url = {https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication},
  urldate = {2026-11-06}
}
```
