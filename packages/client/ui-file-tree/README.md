# @deepseek-ai/dsh-client-ui-file-tree

English | [中文](README.zh.md)

The sidebar file tree: fills the shell's `sidebar.filetree` hole with the current session's workspace directory tree. Each directory level is listed lazily on expansion through `ctx.workspaces.listDir` (the `filetree.list` wire method backed by [`dsh-host-file-tree-local`](../../host/file-tree-local/README.md)), files carry the classic git status ink (`modified`/`added`/`deleted`/`untracked`/`ignored`), every row offers copy-path and open-path actions, and a click toggles multi-select highlight. A host-forwarded `filetree/change` event re-lists the root and every expanded level, so external edits appear without a reload.

The shell owns the Workspace/Files switch; this package only registers the tree into the `sidebar.filetree` seat it declares. Selection is a per-surface store today; surfacing it to the model is the sibling selection feature's job.

## Model Experience

None, as the tree is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Whole-expanded re-list on change** — every `filetree/change` re-lists the root and all expanded levels rather than diffing by affected path; coarse but correct until a path-scoped invalidation lands.
- **Selection is not yet model-visible** — the multi-select highlight stays client-side; the selection-to-context seam is deferred.
- **No directory git-status aggregation** — a directory whose descendant changed carries no status ink (inherited from the host seam).
