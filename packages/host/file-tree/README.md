# @deepseek-ai/dsh-host-file-tree

English | [中文](README.zh.md)

The web GUI host's workspace file tree is a capability seam. The abstract `FileTree` service (`ctx.fileTree`) is its Service Definition. Its only method, `listDir(path, signal)`, returns one directory level — direct files and directories — with a per-file `gitStatus` for the classic working-tree states (`modified` / `added` / `deleted` / `untracked` / `ignored`). A backend reports filesystem changes by emitting the `filetree/change` event, which the consuming gateway forwards to clients so the tree refreshes without polling. Unlike [`directory-picker`](../directory-picker/README.md), whose browse backend lists directories only, this seam lists files too because the file tree shows them; neither seam reads file contents.

`FileTreeEntry` rows carry a host-owned `hidden` flag (POSIX dot convention) so display policy stays client-side, and an optional `gitStatus` that is absent for directories and for paths outside any git work tree. `FileTreeListing.entries` is name-sorted; directory-first grouping is the client's presentation choice. Listing failures throw the typed `FileTreeError` (`tree-unreadable`, carrying the subject `path`), which the consuming gateway maps 1:1 onto a wire error code.

## Model Experience

None, as the seam serves the GUI host's file tree; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No directory git-status aggregation** — `gitStatus` is per file only; a directory whose descendant is modified is not yet marked, which needs a whole-tree status scan and is deferred until a consumer asks for it.
- **Classic status set only** — renames and conflicts fold into `modified` at the backend; a richer status vocabulary waits on a consumer that renders it.
