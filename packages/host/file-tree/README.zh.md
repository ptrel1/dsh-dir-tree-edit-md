# @deepseek-ai/dsh-host-file-tree

[English](README.md) | 中文

Web GUI 宿主的工作区文件树是一个能力 seam。抽象 `FileTree` 服务（`ctx.fileTree`）即其 Service Definition。它的方法是 `listDir(path, signal)`——一层目录，直接的文件与子目录——与 `search(root, query, signal)`——在根下递归做忽略大小写的文件名子串扫描，返回平铺的 `matches`。每行携带经典工作区状态的 `gitStatus`（`modified` / `added` / `deleted` / `untracked` / `ignored`）：文件报自身状态，目录聚合其下任意深度后代的最高等级状态。后端通过发出 `filetree/change` 事件报告文件系统变更，消费方网关将其转发给客户端，使文件树无需轮询即可刷新。与 [`directory-picker`](../directory-picker/README.md) 不同，后者的 browse 后端只列目录，本 seam 还列出文件，因为文件树需要展示文件；两个 seam 都不读取文件内容。

`FileTreeEntry` 行携带宿主判定的 `hidden` 标志（POSIX 点前缀约定），展示策略留在客户端；可选的 `gitStatus` 在任何 git 工作树之外缺省。`FileTreeListing.entries` 按名称排序；目录优先的分组是客户端的展示选择。`FileTreeSearchResult.matches` 是平铺列表——不包含匹配项的祖先，过滤后的层级由客户端重建。两个方法都会约束完整结果并报告 `truncated`；超时的搜索后端以已收集的匹配项落定而非卡死。失败抛出类型化的 `FileTreeError`（`tree-unreadable`，携带主题 `path`），消费方网关将其 1:1 映射为 wire 错误码。

## Model Experience

无——该 seam 服务于 GUI 宿主的文件树，没有任何内容进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **仅经典状态集** — 重命名与冲突在后端折叠为 `modified`；更丰富的状态词表留待需要渲染它的消费方。
- **仅名称搜索** — `search` 匹配条目名称而非文件内容；内容搜索将是另一个更重的后端。
