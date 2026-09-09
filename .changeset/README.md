# Package releases

Run `bun run changeset` from the repository root when a change needs a package release.
Select the affected packages, version bump, and write a short user-facing summary.
Commit the generated Markdown file alongside the change.

On `main`, the shared workflow opens or updates the Changesets version PR. Review and
merge that PR to publish the versioned packages. No package list or manual version
comparison is needed, including when adding a new workspace package.

See [the root release guide](../README.md#releasing-infra-packages) for installation,
first-publication requirements, and trusted publisher setup.
