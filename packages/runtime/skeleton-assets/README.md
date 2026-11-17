# Skeleton assets

Files in this folder are **templated** into a brand-new project workspace by `apps/platform-worker`'s `generateMinimalSkeleton`. The agent then fills `src/` and refines `game.json` to materialize the user's intent.

Replacement tokens used at copy time:

- `__RUNTIME_SPEC__` in `package.json.tpl` → swapped for the install spec the worker chose (e.g. `file:/abs/path/to/runtime/dist` or an npm version).

Everything else is plain static text.
