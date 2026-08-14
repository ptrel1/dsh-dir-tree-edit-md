# @deepseek-ai/dsh-client-ui-file-tree

English | [中文](README.zh.md)

The sidebar file tree: fills the shell's `sidebar.filetree` hole with the current session's workspace directory tree. Each directory level is listed lazily on expansion through `ctx.workspaces.listDir` (the `filetree.list` wire method backed by [`dsh-host-file-tree-local`](../../host/file-tree-local/README.md)), files carry the classic git status ink (`modified`/`added`/`deleted`/`untracked`/`ignored`), every row offers copy-path and open-path actions, and a click toggles multi-select highlight. A host-forwarded `filetree/change` event re-lists the root and every expanded level, so external edits appear without a reload.

A name-search box sits above the tree. Typing filters the tree in place through `ctx.workspaces.searchEntries` (the `filetree.search` wire method): the query is a case-insensitive name substring, debounced 250ms, and both files and directories match. While filtering, the tree shape survives — every match stays put under its real ancestors, missing connecting levels render as synthesized directory rows (no git ink), and everything is auto-expanded. Clicking a directory row clears the search and reveals that directory in the plain tree (ancestors expand, missing levels load); clicking a file row toggles multi-select as usual. Clearing the box (Escape or the clear button) restores the plain tree. A `filetree/change` event re-runs the settled query, so live matches track external edits. Truncated and failed searches surface as status rows, never silently.

The shell owns the Workspace/Files switch; this package only registers the tree into the `sidebar.filetree` seat it declares. Selection is a per-surface store today; surfacing it to the model is the sibling selection feature's job.

## Model Experience

None, as the tree is browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Whole-expanded re-list on change** — every `filetree/change` re-lists the root and all expanded levels rather than diffing by affected path; coarse but correct until a path-scoped invalidation lands.
- **Selection is not yet model-visible** — the multi-select highlight stays client-side; the selection-to-context seam is deferred.
