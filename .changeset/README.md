# Package releases

Run `bun run changeset` from the repository root when a change needs a package release.
Select the affected packages, version bump, and write a short user-facing summary.
Commit the generated Markdown file alongside the change.

On `main`, the shared workflow runs `changeset version`, verifies the result, and
uses `git-auto-commit-action` to push the version updates directly to `main`.
The same job publishes through `changesets/action`. The version commit uses
GitHub's automatic token and `[skip ci]`, so it does not trigger another publish run.
There is no version PR. Changesets uses the committed changeset files to choose
packages and bump levels; source changes alone do not request a version bump.

See [the root release guide](../README.md#releasing-infra-packages) for installation,
first-publication requirements, and trusted publisher setup.
