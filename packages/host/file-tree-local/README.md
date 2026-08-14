# @deepseek-ai/dsh-host-file-tree-local

English | [中文](README.zh.md)

The local-filesystem backend of the [`file-tree` seam](../file-tree/README.md): it registers `ctx.fileTree` and serves one directory level per `listDir` call — direct files and directories — over the host filesystem via Node's stdlib, exactly as the directory-picker browse backend does. Per-row git status comes from one `git status --porcelain=v1 -z --untracked-files=all` run through `ctx.subprocess` (`--ignored` only when opted in — enumerating ignored directories makes one scan take minutes on a monorepo), folded into the seam's classic states; a non-repository path, a missing `git`, or output overflow degrades to no coloring rather than failing the listing. The backend watches each listed root with Chokidar and emits `filetree/change` on every filesystem event so the client refreshes without polling.

`listDir` rejects a path that is not fully qualified (`tree-unreadable`), mirrors the directory-picker browse backend's bounded name-sorted listing window (`maxEntries`, default 1000), follows symlinks to directories, and skips broken or cyclic links. `search` walks the tree recursively under a root, matching entry names case-insensitively by substring, bounded by `searchMaxMatches` (default 200) and `searchTimeoutMs` (default 10 s — on expiry it settles with the matches collected so far, `truncated: true`). The walk skips `watchIgnored` subtrees (compiled glob matchers) and never descends symlinked directories; an unreadable subdirectory mid-walk is skipped silently, and only the root's own failure raises `tree-unreadable`. Watching knobs (`usePolling`, `watchPollIntervalMs`) exist because network mounts deliver no native fs events; the remaining Chokidar options are fixed backend constants.

## Model Experience

None, as the backend serves the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One whole-repo `git status` per settled operation** — each listing or search runs one status scan scoped by the nearest `.git` ancestor, single-flighted across concurrent operations on the same repo but not cached across settlements; a very large repository pays that cost per call until a change-invalidation cache lands.
- **Classic status set only** — renames and conflicts fold into `modified`, inherited from the seam.
- **Name-only search** — `search` matches entry names, not file contents, inherited from the seam.
