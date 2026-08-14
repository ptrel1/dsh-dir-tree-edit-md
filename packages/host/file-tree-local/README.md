# @deepseek-ai/dsh-host-file-tree-local

English | [中文](README.zh.md)

The local-filesystem backend of the [`file-tree` seam](../file-tree/README.md): it registers `ctx.fileTree` and serves one directory level per `listDir` call — direct files and directories — over the host filesystem via Node's stdlib, exactly as the directory-picker browse backend does. Per-file git status comes from one `git status --porcelain=v1 -z --untracked-files=all --ignored` run through `ctx.subprocess`, folded into the seam's classic states; a non-repository path, a missing `git`, or output overflow degrades to no coloring rather than failing the listing. The backend watches each listed root with Chokidar and emits `filetree/change` on every filesystem event so the client refreshes without polling.

`listDir` rejects a path that is not fully qualified (`tree-unreadable`), mirrors the directory-picker browse backend's bounded name-sorted listing window (`maxEntries`, default 1000), follows symlinks to directories, and skips broken or cyclic links. Watching knobs (`usePolling`, `watchPollIntervalMs`) exist because network mounts deliver no native fs events; the remaining Chokidar options are fixed backend constants.

## Model Experience

None, as the backend serves the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Full-repo `git status` per level** — each listing runs one whole-repository status scan scoped by the nearest `.git` ancestor, with no cross-listing cache; a very large repository pays that cost per expansion until a change-invalidation cache lands.
- **No directory git-status aggregation** — `gitStatus` is per file only, inherited from the seam.
- **Classic status set only** — renames and conflicts fold into `modified`, inherited from the seam.
