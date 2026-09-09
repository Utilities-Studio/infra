# Package releases

CI generates changesets from Conventional Commits using the existing generator
from `pixpilot/changesets-autopilot`, invoked through `run-func` under Bun.
Use `fix:`, `perf:`, or `revert:` for patches, `feat:` for minors, and `!` for
breaking changes. Non-release commit types such as `docs:`, `chore:`, and
`refactor:` are skipped. Manual changeset creation is optional.

On `main`, the shared workflow runs `changeset version`, verifies the result, and
uses `git-auto-commit-action` to push the version updates directly to `main`.
The same job publishes through `changesets/action`. The version commit uses
GitHub's automatic token and `[skip ci]`, so it does not trigger another publish run.
There is no version PR. The generator selects packages from files touched by
release commits. Changesets owns version calculation and dependency updates.

See [the root release guide](../README.md#releasing-infra-packages) for installation,
first-publication requirements, and trusted publisher setup.
