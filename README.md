# dir-tree-dsh

A **file-tree sidebar plugin** for the DeepSeek Harness (dsh) web GUI: browse a
workspace's real files in a lazy-expanding tree, see git status on every row,
and multi-select files for the model to know about.

[English](README.md) | [中文](README.zh.md)

## Features

- **Lazy, bounded tree** — one `listDir` call per expanded level, capped at
  `maxEntries` (default 1000) with a `truncated` flag.
- **Git ink per row** — files report their own status
  (`modified` / `added` / `deleted` / `untracked` / `ignored`); directories
  aggregate the highest-ranked status of their descendants at any depth, so a
  change deep in the tree inks every enclosing folder.
- **Model-visible selection** — multi-selected paths become a durable
  `file/selection` session event that is rendered into the model's context and
  can be replayed from the session log.
- **Live refresh without polling** — a Chokidar watcher emits `filetree/change`,
  which is forwarded to clients through dsh's remote-event allowlist; the
  client aborts superseded requests and re-lists its expanded view.
- **Hardened for big repos** (measured on a real monorepo):
  - git-status scans are single-flighted per repo root and deadline-bounded
    (`gitStatusTimeoutMs`, default 8 s); on expiry the listing settles without
    coloring instead of stalling.
  - `--ignored` is off by default (`gitStatusIncludeIgnored` opts in): it made
    one scan take >5 min vs 0.06 s without it.
  - the watcher sets `followSymlinks: false` (pnpm `node_modules` are junctions
    into the virtual store) and skips `node_modules` / `.git` / `.pnpm-store`
    via compiled glob matchers (chokidar 5 string `ignored` entries compare by
    exact equality, so compiled matchers are the only form that prunes).
  - graceful degradation: no git repo, missing `git`, or stdout overflow means
    no coloring, never a failed listing.

## Repository layout

```
packages/
├── host/
│   ├── file-tree/          # Service Definition: ctx.fileTree, listDir, types
│   └── file-tree-local/    # backend: listing, git status, Chokidar watcher
├── client/
│   └── ui-file-tree/       # browser tree UI: expansion, git ink, multi-select
└── context/
    └── file-selection/     # selection → durable session event → model context
integration/
├── wiring.patch            # dsh core wiring changes (RPCs, sidebar slot, events)
└── new-files/              # new dsh core files the patch introduces
docs/
└── 2026-08-14-file-tree-capability-seam.md   # full design record (EN + ZH)
```

The plugin packages use pnpm `workspace:^` dependencies and are meant to live
**inside a dsh checkout**. `integration/` carries the dsh-core wiring the
plugin needs (apiproxy `filetree.list`/`filetree.select` RPCs, the
`sidebar.filetree` slot and Workspace/Files switch, the forwarded
`filetree/change` event, and the web-app mount rows).

## Install into a dsh checkout

Requirements: a [dsh](https://github.com/deepseek-harness) checkout, Node 22+,
pnpm.

1. **Copy the plugin packages** into the monorepo at the same paths:

   ```
   packages/host/file-tree
   packages/host/file-tree-local
   packages/client/ui-file-tree
   packages/context/file-selection
   ```

2. **Apply the wiring** from the repo root:

   ```bash
   git apply integration/wiring.patch
   cp -r integration/new-files/* .
   ```

   `wiring.patch` is a snapshot of dsh-core changes against the checkout this
   plugin was developed on; on a newer dsh, resolve conflicts manually.

3. **Install** (updates the lockfile and links the new workspace packages):

   ```bash
   pnpm install
   ```

4. **Refresh test snapshots** the wiring touches (UI snapshots of `apps/web`
   and `ui-sidebar`): run those suites with `-u` per the dsh test docs.

5. **Run**: `pnpm dsh web`, then open the sidebar's **Files** tab.

## Configuration

`LocalFileTree` (the `packages/host/file-tree-local` backend) takes a cordis
config schema:

| Key | Default | Meaning |
|---|---|---|
| `maxEntries` | `1000` | complete-result bound of one listing level |
| `graceMs` | `5000` | terminate-escalation grace for the git spawn |
| `gitStatusMaxBytes` | `8 MiB` | stdout cap; overflow degrades to no coloring |
| `gitStatusIncludeIgnored` | `false` | add `--ignored` to the scan (slow on monorepos; opt in) |
| `gitStatusTimeoutMs` | `8000` | deadline per scan; expiry degrades to no coloring |
| `usePolling` | `false` | watch via polling (network mounts without native events) |
| `watchPollIntervalMs` | `500` | polling interval when `usePolling` is true |
| `watchIgnored` | `['**/node_modules/**', '**/.git/**', '**/.pnpm-store/**']` | globs the watcher skips (`*` within a segment, `**` across segments) |
| `watchDepth` | `undefined` | max directory depth to arm watchers on; undefined = all |

## Design rulings (summary)

- The tree is a **GUI browsing surface**, not a model storage tool: it reads the
  host filesystem directly like dsh's directory-picker browse backend, and
  returns files too because the tree shows them. Full record in
  [`docs/`](docs/2026-08-14-file-tree-capability-seam.md).
- Real-time updates ride the **forwarded-event allowlist** (`filetree/change`),
  not a new frame; the client re-lists expanded levels only.
- Selection is **per-session and logged** — the prompt context reads the latest
  `file/selection` event back from the log, never client state, so a replay
  rebuilds the same context.
- Directory git color is **aggregated**: highest rank of
  `modified > added > deleted > untracked > ignored` among descendants.

## Testing

From a dsh checkout with the packages installed:

```bash
pnpm vitest run host/file-tree-local client/ui-file-tree
```
