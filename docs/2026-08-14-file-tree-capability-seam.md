# Agent Note: A file-tree capability seam and sidebar surface for the web GUI

Status: implemented

English | [中文](2026-08-14-file-tree-capability-seam.zh.md)

## Problem

The sidebar's "Workspace" region is a session browser, not a filesystem tree: it lists registered project directories and their conversations, and the model-facing filesystem tools (`read`/`write`/`edit`/`glob`/`grep`) have no directory-listing surface at all (`ctx.fs.listDir` serves provider code only). There was no way to browse a workspace's actual files, see git status, or mark files for the model to know about — the three things a file-explorer-style view exists to do.

## Decision

A **four-package feature** split along the repo's capability-seam doctrine:

- **`packages/host/file-tree`** (Service Definition, `ctx.fileTree`): `listDir(path, signal)` returning a name-sorted level of files and directories with a per-row `gitStatus` (`modified`/`added`/`deleted`/`untracked`/`ignored` — the classic set; renames/conflicts fold into `modified`) — a file reports its own, a directory aggregates the highest-ranked status of its descendants at any depth — plus `search(root, query, signal)` returning a flat, bounded match list, and the `filetree/change` emit event.
- **`packages/host/file-tree-local`** (backend): streams the level through `opendir` into a bounded name-sorted window (the directory-picker browse backend's algorithm), runs `git status --porcelain=v1 -z --untracked-files=all` through `ctx.subprocess` folded to the classic states (a `gitStatusIncludeIgnored` opt-in adds `--ignored`), and watches each listed root with Chokidar, emitting `filetree/change`. No git repo, a missing `git`, or output overflow degrades to no coloring. `search` walks the tree recursively with the same fences — ignored globs, no symlink-directory descent, per-read abort racing — and self-limits with `searchMaxMatches` (default 200) and a `searchTimeoutMs` deadline (default 10 s) that settles with whatever was collected plus `truncated`; unreadable subdirectories are skipped best-effort, and only a failing root surfaces as `tree-unreadable`.
- **`packages/client/ui-file-tree`** (browser half): fills the shell's `sidebar.filetree` slot with the lazy-expanding tree, git ink via the `--dsw-alias-state-*` tokens, per-row copy/open actions, multi-select highlight, and a search box above the tree. The Workspace/Files switch is shell-owned; the tree only registers into the seat the shell declares.
- **`packages/context/file-selection`** (selection → model): the client syncs the multi-select over `filetree.select`; the host logs a durable `file/selection` session event and a system-prompt context contribution renders the latest selection as a sourced "Selected files" snapshot, so the selection is model-visible and reconstructable from the log (the "model-visible ⟺ logged" rule).

**Key rulings:**

- **Not `ctx.fs`.** The file tree is a GUI browsing surface, not the model's storage stack; it reads the host filesystem directly like the directory-picker browse backend, and `listDir` returns files too (the picker lists directories only) because the tree shows them.
- **Real-time via the forwarded-event allowlist, not a new frame.** `filetree/change` joins `API_REMOTE_FORWARDED_EVENTS` (the seam exposes a client-safe `./types` subpath so the shape assertion sees it); the gateway forwards it as `host/remote-event` and the client re-lists its expanded view — coarse whole-expanded re-list, correct until path-scoped invalidation pays for itself.
- **The shell owns the view switch.** `ui-sidebar` declares `sidebar.filetree` beside `sidebar.workspaces` and a two-segment control toggles them; the tree is a `single`-seat occupant like the workspace browser, so a mismatched or doubled composition fails at client load.
- **Selection is per-session and logged.** A `file/selection` event carries the complete path set (empty clears), consecutive identical sets are not re-logged, and the prompt context reads the latest event back — never client state — so a replay rebuilds the same context.
- **Lazy, bounded listing.** One `listDir` call returns at most `maxEntries` (default 1000) with a `truncated` flag, directories are listed only on expansion, and the Chokidar watcher plus the `filetree/change` re-list replaces polling.
- **Name-only search, filtered in-tree.** `search` matches case-insensitive substrings against file and directory names and returns a flat list (no ancestor chains — the host never ships them). The client rebuilds the tree shape with a pure `buildFilteredTree`: each match becomes a real node, missing levels become synthesized directory nodes carrying no git ink (they were never listed), and the filtered view is expanded by construction. The host self-limits matches and wall time (`searchMaxMatches`/`searchTimeoutMs`) because the client's 30 s unary timeout is a session-level backstop, not a walk budget; a deadline expiry settles with the collected matches and `truncated`, never a stall. Clearing the query restores the plain tree; clicking a matched directory clears the filter and reveals it via the plain tree's `listDir` expansion, and clicking a file row keeps the ordinary multi-select semantics. A revision change re-runs the search for the stored query, so the filtered view stays live under `filetree/change` like the plain tree.
- **Bounded scans, fenced watchers, client-side recovery.** A git-status scan is single-flighted per repo root and deadline-terminated (`gitStatusTimeoutMs`, default 8 s); on expiry the listing settles without coloring instead of stalling, and `--ignored` stays off unless opted in (measured >5 min with it on this monorepo, 0.06 s without). The watcher sets `followSymlinks: false` (a pnpm workspace's `node_modules` are junctions into the virtual store; following one arms a watcher per store directory) and skips `watchIgnored` globs (defaults `**/node_modules/**`, `**/.git/**`, `**/.pnpm-store/**`) via a compiled function matcher — chokidar 5 compares string `ignored` entries by exact equality, so only compiled globs actually prune — with an optional `watchDepth` cap. The client aborts superseded requests, converts a hung listing (15 s) into a per-row retry button, and re-lists expanded levels on the forwarded `filetree/change`.

## Alternatives considered

- **A dedicated `HostFrame` variant for changes.** Rejected: the remote-event allowlist already forwards verbatim host events with no projection; a new frame would duplicate that machinery for one event.
- **Extending `ctx.fs` with a listing tool.** Rejected: GUI browsing must not couple to the model's confinement backend, and the seam already exposes `listDir` to providers — a model-facing directory-listing tool is a separate, deferred question.
- **Whole-tree eager enumeration.** Rejected: unbounded memory/scan for large or adversarial directories; the bounded window plus lazy expansion keeps each level O(maxEntries).
- **Client-side git status via a shelled `git`.** Rejected: the host owns process concerns; `ctx.subprocess` gives bounded capture, abort, and tree termination, and a non-repo degrades gracefully.
- **Putting the selection in a client-only store.** Rejected: model visibility requires a durable session event, so the prompt context derives from the log rather than transient browser state.
- **Content search (ripping files).** Rejected: the request was name search; a content index is a different backend (and dsh already has model-facing `grep`). The name walk is a loop over `opendir`, bounded by the same ignore/symlink fences as listing.
- **A flat results list instead of a filtered tree.** Rejected: matches are spread across deep paths, and losing the tree shape loses the location context; the synthesized-ancestor chain keeps the directory structure visible while showing only relevant rows. It also keeps row behavior uniform — the same copy/open/select actions work in both modes.
- **Client-side walk over `listDir`.** Rejected: one RPC per level over the wire would turn a deep search into a request fan-out with no global match/time bound; a single host-side `search` carries one deadline and one cap.

## Consequences

- `web-app` mounts `file-tree` (host), `file-selection` (host), and `ui-file-tree` (client) rows; the apiproxy gains the `filetree.list`/`filetree.select`/`filetree.search` RPCs and `tree-unreadable`/`file-tree-unavailable` error codes.
- The connection fixture and test runtimes gain `filetree`/`listDir`/`selectFiles`/`searchEntries` doubles so keyless assembled tests stay deterministic.
- A future model-facing directory-listing tool, or a path-scoped change invalidation, are both small additions behind the existing seams.
