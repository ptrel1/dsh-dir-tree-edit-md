# @deepseek-ai/dsh-host-file-tree

English | [中文](README.zh.md)

The web GUI host's workspace file tree is a capability seam. The abstract `FileTree` service (`ctx.fileTree`) is its Service Definition. Its methods are `listDir(path, signal)` — one directory level, direct files and directories — and `search(root, query, signal)` — a recursive case-insensitive name-substring scan under a root returning flat `matches`. Rows carry a per-row `gitStatus` for the classic working-tree states (`modified` / `added` / `deleted` / `untracked` / `ignored`): a file reports its own, a directory aggregates the highest-ranked status of its descendants at any depth. A backend reports filesystem changes by emitting the `filetree/change` event, which the consuming gateway forwards to clients so the tree refreshes without polling. Unlike [`directory-picker`](../directory-picker/README.md), whose browse backend lists directories only, this seam lists files too because the file tree shows them; neither seam reads file contents.

`FileTreeEntry` rows carry a host-owned `hidden` flag (POSIX dot convention) so display policy stays client-side, and an optional `gitStatus` that is absent outside any git work tree. `FileTreeListing.entries` is name-sorted; directory-first grouping is the client's presentation choice. `FileTreeSearchResult.matches` is a flat list — ancestors of matches are not included, so the client reconstructs the filtered hierarchy. Both methods bound their complete results and report `truncated`; backends settle a timed-out search with the matches collected so far rather than stalling. Failures throw the typed `FileTreeError` (`tree-unreadable`, carrying the subject `path`), which the consuming gateway maps 1:1 onto a wire error code.

## Model Experience

None, as the seam serves the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Classic status set only** — renames and conflicts fold into `modified` at the backend; a richer status vocabulary waits on a consumer that renders it.
- **Name-only search** — `search` matches entry names, not file contents; a content search would be a separate, heavier backend.
