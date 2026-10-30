# Contributing to QOLLOCK

QOLLOCK runs in Source 2 Panorama. Its XML, CSS and JavaScript are game resources;
Node.js is used for development checks, not for the in-game runtime.

## Development Setup

Use Node.js 24, matching CI, and install the development dependencies:

```sh
npm ci
npm test
```

Optionally install the Git hook with `bash setup-hooks.sh`. It runs the complete
`npm test` gate before commits. Do not commit local captures, credentials or
generated build artifacts.

## Find the Right Owner

Start with [ARCHITECTURE.md](ARCHITECTURE.md), then read the focused reference
for the subsystem you are changing. Inspect current source and active XML includes.
HUD and settings run in separate JavaScript contexts.
The [documentation index](docs/README.md) separates current references from
snapshot reports and outstanding acceptance work.

- [Helpers](docs/HELPERS.md): shared APIs and their contracts.
- [Settings](docs/ADDING_SETTINGS.md): defaults, metadata, rendering and persistence.
- [Localization](docs/LOCALIZATION.md): visible text and translation workflows.
- [Feature catalog](docs/features/README.md): implementation ownership.
- [Testing](docs/TESTING.md): offline checks and their limits.
- [Release checklist](docs/TEST_CHECKLIST.md): client verification.
- [Releases and automation](docs/RELEASING.md): packaging, publication and upstream monitoring.

## Change Requirements

- Keep each change focused on its stated purpose. Avoid unrelated reformatting,
  duplicate implementations and temporary development artifacts.
- Write new and rewritten JavaScript with `const` and `let`, using supported
  Panorama APIs and preserving callback and cross-file global semantics.
  Node development tools and in-game scripts have different environments.
- Keep features with their owners and reuse helpers with matching semantics.
  Small features can remain in one manifest; split complex ones along real
  responsibilities rather than an arbitrary file-size limit.
- Keep native stylesheet wrappers as ordered `@import` lists. Place mod rules
  in the owning context's feature stylesheet, scope selectors to the intended
  component and preserve the native baseline. Existing full replacements and
  custom sheets follow their documented loading contracts.
- React to setting changes through the owning hook, avoid unnecessary recurring
  work and clean up owned panels, styles, classes, subscriptions and schedules.
  Handle late, destroyed and still-live replaced native panels, and reject
  asynchronous results belonging to a retired operation or context.
- Agree new persistent setting defaults with a maintainer and follow the complete
  settings path. Localize visible mod text through the current catalogs.
  Version and schema bumps require explicit maintainer authorization.
- Add meaningful regression coverage for changed behavior using existing suites.
  Static source checks can protect structural rules but cannot establish runtime
  behavior or native rendering. Run `npm test` before submitting a change.

Include the problem, resulting behavior, verification results and any remaining
client checks in the change description. The detailed code-quality requirements
are directly in [AGENTS.md](AGENTS.md#code-quality), alongside agent workflow rules.

Read the relevant technical references before changing their subsystem. Write
documentation in English and update it when the change invalidates documented
behavior, formats, ownership, contracts or verification procedures. Keep current
defaults, ranges and implementation details in source instead of duplicating them
in prose. Documentation-only changes do not need unrelated source edits.

Changing an implementation does not by itself authorize relaxing project rules,
removing acceptance checks or redefining a contract. Propose such changes
explicitly and agree them with a maintainer; do not rewrite the requirements
to make an otherwise nonconforming patch acceptable.

## Build and Verify

Compilation, VPK repacking and game installation belong to the maintainer.
Agents must not run build scripts or `resourcecompiler.exe`, modify game addons,
or create or modify VPK files.

For maintainers, [build_mod/README.md](build_mod/README.md) explains the CSDK 12
setup and the Windows build menu. The embedded builder selects this repository
automatically; there is no mod-selection step.

Close Deadlock, compile and pack the changes, then verify them in the client.
A passing simulator suite does not establish native rendering, FPS or persistence
after a full game restart. Report offline results and remaining client checks separately.
