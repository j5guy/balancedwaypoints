# CI/CD and Releases

`.gitea/workflows/test.yml` and `prod.yml` mirror the pattern used by
`workouts`/`fondwaypoints`: pushing to `test` deploys to a `web-test`-labeled
Gitea Actions runner; pushing to `master` deploys to `web-prod`, mirrors the
branch to GitHub, and cuts a GitHub + Gitea release tagged from
`package.json`'s `version` field.

These workflows assume infrastructure this repo doesn't provision itself —
a `web-test`/`web-prod` Gitea runner, a `balancedwaypoints` systemd service
on that host, and (for `prod.yml`) `REMOTE_REPO_TOKEN`/`DOCKER_GITEA_TOKEN`
secrets — set those up the same way the sibling projects' hosts are
configured before relying on these workflows; until then they're inert.

To cut a release by hand instead: bump `version` in `package.json`, tag it
`vX.Y.Z`, and push the tag.
