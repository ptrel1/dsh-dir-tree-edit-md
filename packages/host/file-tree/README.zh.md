# @deepseek-ai/dsh-host-file-tree

[English](README.md) | 中文

Web GUI 宿主的工作区文件树是一个能力 seam。抽象 `FileTree` 服务（`ctx.fileTree`）即其 Service Definition。它唯一的方法 `listDir(path, signal)` 返回一层目录——直接的文件与子目录——并为每个文件携带经典工作区状态的 `gitStatus`（`modified` / `added` / `deleted` / `untracked` / `ignored`）。后端通过发出 `filetree/change` 事件报告文件系统变更，消费方网关将其转发给客户端，使文件树无需轮询即可刷新。与 [`directory-picker`](../directory-picker/README.md) 不同，后者的 browse 后端只列目录，本 seam 还列出文件，因为文件树需要展示文件；两个 seam 都不读取文件内容。

`FileTreeEntry` 行携带宿主判定的 `hidden` 标志（POSIX 点前缀约定），展示策略留在客户端；可选的 `gitStatus` 对目录与任何 git 工作树之外的路径缺省。`FileTreeListing.entries` 按名称排序；目录优先的分组是客户端的展示选择。列举失败抛出类型化的 `FileTreeError`（`tree-unreadable`，携带主题 `path`），消费方网关将其 1:1 映射为 wire 错误码。

## Model Experience

无——该 seam 服务于 GUI 宿主的文件树，没有任何内容进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **无目录级 git 状态聚合** — `gitStatus` 仅按文件给出；某个后代被修改的目录尚未标记，这需要整树状态扫描，留待有消费方需要时再做。
- **仅经典状态集** — 重命名与冲突在后端折叠为 `modified`；更丰富的状态词表留待需要渲染它的消费方。
