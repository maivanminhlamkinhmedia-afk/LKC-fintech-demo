# CMS-009 candidate artifact handoff (symlink delta pending review)

The candidate job in `.github/workflows/ci.yml` is a separate manual `cms009-candidate` mode. It checks out the workflow revision containing `scripts/cms-media/package-candidate.mjs` separately from the application source pinned to `54238cd55e43b60b4d8cea02a32fc98e82f7762e`; both Git SHAs are checked before build. The existing pull-request validation job still runs on pull requests. The candidate job uses Linux/Node 22, a dummy database URL and auth URL, and no production secret, SSH, database query, deployment, or runtime environment change. `npm run build` invokes the existing standalone assembler. The existing source-bundle media smoke runs first, followed by the same smoke on the **materialized candidate** before archive creation.

The packaging helper inventories standalone/static/public symlinks by internal file/directory, external, dangling, cycle, unverified and special target. Only a link whose final target resolves inside its own source tree is materialized to a regular file/directory; copied bytes and executable mode are checked. External, dangling, cyclic or unverifiable links, `.env*` and special files still fail. Link targets and file contents are never logged. The candidate tree is inspected again to reject any remaining links or special files.

A successful job uploads `cms009-candidate-54238cd.tar.gz`, its `.sha256` sidecar, and `manifest.json`. The archive has `cms009-candidate/standalone/` (including static/public assets), `scripts/cms-media/smoke-standalone.mjs`, and `tests/browser-local/cms-media-lifetime-child.mjs`. The manifest records both SHAs, run ID/attempt, Node/npm, source and candidate smoke results, internal-link counts, archive name and SHA-256. A missing bundle, unsafe link, failed candidate smoke, or missing required archive member prevents upload. A successful candidate job proves the media smoke on the Actions runner, not on cPanel or the full deploy dependency tree.

The first dispatched run, [37328338287](https://github.com/maivanminhlamkinhmedia-afk/LKC-fintech-demo/actions/runs/37328338287), built and passed source-bundle smoke but stopped at the blanket `standalone contains symlinks` guard. It uploaded **zero artifacts**. Its log did not report any link path or target, so it does not establish whether those links were internal, external, dangling or cyclic. This delta has not been dispatched; Claude review and a separate authorization are needed before another candidate run.

## After delta review and a separate dispatch authorization

Commit and review the workflow delta first. `workflow_dispatch` requires the workflow file to exist on the default branch; the current CI workflow already does. Dispatch against the feature ref containing this delta and select `cms009-candidate`. Verify the resulting run has event `workflow_dispatch`, job `cms009-candidate` success, and manifest `workflowSha` equal to that run's head SHA. The source checkout and manifest `sourceSha` must still equal the pinned SHA above. Do not confuse the two commits. The PR validation job is not a substitute for this dispatch.

Download the artifact named `cms009-candidate-<run-id>-<attempt>` from that exact run, for example with `gh run download <run-id> --repo maivanminhlamkinhmedia-afk/LKC-fintech-demo --name cms009-candidate-<run-id>-<attempt> --dir <empty-local-directory>`. Keep the directory private and outside the repository. Confirm the run/job succeeded, inspect the manifest fields, and calculate the archive SHA-256 locally; it must match both the manifest and sidecar. Check the archive listing has only the `cms009-candidate/` prefix, with no `..` members, symlinks, or unexpected files. Do not use an artifact from another run or a failed job.

In a later authorized host task, transfer exactly the verified archive, sidecar and manifest to a **new**, owner-only candidate directory such as `/home/edpmjmha/cms009-candidate-gha-<run-id>-<attempt>`. Confirm its realpath is outside `/home/edpmjmha/public_html`, the live AppRoot `/home/edpmjmha/lkcfintech.com.vn/deploy`, the private media root, and deploy purge targets. Refuse an existing path; do not reuse or delete the failed hosting-build candidate. On the host, recheck the three file hashes and manifest provenance before extracting. Extract into that new directory only, then verify `cms009-candidate/standalone/server.js`, both helper scripts, traced storage/contract, worker and codecs are present. Do not launch `server.js` or serve traffic.

Run the extracted smoke from `cms009-candidate/` with the observed Passenger binary `/home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node`. Recheck that binary's actual version (22.18.0 was previously observed). The future command is:

```bash
cd /home/edpmjmha/cms009-candidate-gha-<run-id>-<attempt>/cms009-candidate
env -i HOME=/home/edpmjmha PATH=/usr/bin:/bin NODE_ENV=production \
  DATABASE_URL=mysql://build:build@127.0.0.1:3306/build \
  NEXTAUTH_URL=http://127.0.0.1:3000 \
  /home/edpmjmha/nodevenv/lkcfintech.com.vn/deploy/22/bin/node \
  scripts/cms-media/smoke-standalone.mjs standalone
```

Require exit 0 and `assembledMediaSmoke: PASS`, `worker: PNG`, `lifetimes: 2`; record the run ID, both commits, archive hash and actual Passenger Node version. This smoke uses a synthetic temporary media root and does not query production DB or touch the provisioned root/sentinel. Keep storage persistence verification, runtime `CMS_MEDIA_ROOT` configuration and production release as separate gates. The 122/122 staging result belongs to application commit `12cc768…`, not to this candidate workflow.
