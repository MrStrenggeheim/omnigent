# Custom workspace fork

This repository is [MrStrenggeheim's Omnigent fork](https://github.com/MrStrenggeheim/omnigent), based on upstream `v0.20.0`.
The maintained branch is `custom`.
Upstream authorship, LICENSE and NOTICE are retained.

## Run it

Follow the [root quickstart](../README.md#quick-start) for a local browser installation or the existing Docker server stack.
The default one-line installer reuses the existing OSS installer, builds the frontend and installs the backend and SDKs from our `custom` Git ref.
The expandable manual recipe instead uses a local checkout and `uv.lock`, then builds the frontend with `pnpm-lock.yaml`.
Native harnesses need their own installation/login, `tmux` and, on Linux, `bubblewrap`.
The browser/server recipe does not need Rust, Ruby or iOS tooling.
See [contributor setup](../CONTRIBUTING.md#development-setup) when changing code.

## Custom feature map

| Area | Repository documentation |
| --- | --- |
| Docked views, per-chat layouts and pins | [Unified workspace](../feature-map/unified-workspace.md) |
| Composer and model controls | [Composer](../feature-map/composer.md) |
| Feature verification entry points | [Feature map](../feature-map/README.md) |
| Shared appearance and interaction rules | [Design system](../design-system/omnigent/MASTER.md) |

## Configuration and updates

Local user data and credentials live under `~/.omnigent` by default, independently of the checkout.
Keep this directory and Docker's generated `.env` private.
Docker stores database and artifact data in its existing named volumes; see the [deployment guide](../deploy/docker/README.md).

For an installer-based update, let running work finish, stop the local instance with `omnigent stop`, and rerun the installer.
For checkout-based updates, stop it and run `git pull --ff-only` on `custom`.
Repeat the quickstart's dependency-install and frontend-build commands, then start it again.
Upstream PyPI, Homebrew and desktop downloads do not contain this fork's changes.

`deploy/local/` contains the original operator's VPS release-management tools.
They are not required by either quickstart and still assume that operator's systemd installation.
Portable release automation, additional platform certification and the wider productionization audit are deferred.

## Development

Keep feature behavior, shared UI rules and setup instructions in this repository.
Record tasks in the fork's issues or the operator's supplied checklist; personal agent instructions and private KBs are optional.
Before submitting a change, run the relevant existing checks and the required Git hooks.
