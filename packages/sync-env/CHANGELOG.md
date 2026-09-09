# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 1.2.0 (2026-09-09)

### Features

* **cli-kit:** extract shared helpers for CLI utilities ([7c9acab](https://github.com/Utilities-Studio/infra/commit/7c9acab4a8233cc7fe65628ae9921a83c01d635d))
* **core:** keep sessions active after page refresh ([781424d](https://github.com/Utilities-Studio/infra/commit/781424de7618dcc414e294b7ee8732775d95a43b))
* **core:** support npm-trust package ([736beb7](https://github.com/Utilities-Studio/infra/commit/736beb76814ffaa96f3d7f3b7d7ccb1bd22dabe7))
* **github-env:** add CLI for dotenv file integration with GitHub Actions ([9b1781e](https://github.com/Utilities-Studio/infra/commit/9b1781ee1d6e10a77f7528024e1adeea9e0eee47))
* monorepo support for sync-env and cloudflare-deploy ([8b33adf](https://github.com/Utilities-Studio/infra/commit/8b33adf83d2f14be63ed3ccda754dcec333ccc7e))
* **stripe-sync:** improve product config flexibility and add usage docs ([fb712a3](https://github.com/Utilities-Studio/infra/commit/fb712a387cc9edf3c5d3e302ece045232593bcde))
* **sync-env:** add env variable expansion support ([066f3f7](https://github.com/Utilities-Studio/infra/commit/066f3f713305386e189cb00bbecde5144d146cb8))
* **sync-env:** add reusable env key classifier for secrets detection ([30555d0](https://github.com/Utilities-Studio/infra/commit/30555d043a453548c3db0901ee03b8206ecb2f90))
* **sync-env:** add tests for package contract and secret-keys subpath ([01118ae](https://github.com/Utilities-Studio/infra/commit/01118aef9f8d8e0df7e8d4a8b9387262f37697e4))
* **sync-env:** add tier detection and env file loading ([a8a173c](https://github.com/Utilities-Studio/infra/commit/a8a173cbd777be30b976b3a3ff9af48c3e93ce8c))
* **sync-env:** improve env file handling and CI workflow flexibility ([060ad5d](https://github.com/Utilities-Studio/infra/commit/060ad5d5125aadb45717b4d18b3b1194b7d18317))
* **sync-env:** support root-level wrangler vars for single-env tier ([36aa61a](https://github.com/Utilities-Studio/infra/commit/36aa61aec4cc7d9a11984243d2b7269deabe9dfa))
* **workflows:** add GitHub Actions for Claude, Cloudflare deploys ([1cc72d3](https://github.com/Utilities-Studio/infra/commit/1cc72d3e2b8495fc87b74c6b90284f5c43f2224f))

### Bug Fixes

* address code review findings for multi-tier env support ([36a18c4](https://github.com/Utilities-Studio/infra/commit/36a18c48ae2b494c7422a08c3227dbe271f4b3d7))
* **packages:** add npm provenance metadata ([07a7c90](https://github.com/Utilities-Studio/infra/commit/07a7c908ee82fd7a4a923ea3fa523fa454adcd3b))
* **sync-env:** improve regex for env variable extraction ([d07d452](https://github.com/Utilities-Studio/infra/commit/d07d4524532dafca209db3b4f454f6e5aa45b97a))
* **sync-env:** include `PASSWORD` in sensitive key filtering ([03d2e65](https://github.com/Utilities-Studio/infra/commit/03d2e65e90d3e317499b19c9409797135b9aa118))
* **sync-env:** report redacted command failures ([90d0347](https://github.com/Utilities-Studio/infra/commit/90d0347e943ddd803beab25f1518b73d40434257))
* use path.resolve instead of path.join for --env-dir ([d495911](https://github.com/Utilities-Studio/infra/commit/d4959112a87b503b191155704fcca46a782ae733))
