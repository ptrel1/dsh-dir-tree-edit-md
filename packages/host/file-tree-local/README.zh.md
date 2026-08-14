# @deepseek-ai/dsh-host-file-tree-local

[English](README.md) | 中文

[`file-tree` seam](../file-tree/README.md) 的本地文件系统后端：注册 `ctx.fileTree`，`listDir` 每次调用返回一层目录——直接的文件与子目录——通过 Node 标准库读取宿主文件系统，与 directory-picker 的 browse 后端一致。逐行 git 状态来自一次经 `ctx.subprocess` 运行的 `git status --porcelain=v1 -z --untracked-files=all`（`--ignored` 仅在显式开启时加入——枚举被忽略目录会让 monorepo 上的一次扫描耗时数分钟），折叠为 seam 的经典状态；非仓库路径、缺失 `git` 或输出溢出会降级为不着色，而不是让列举失败。后端用 Chokidar 监听每个被列举的根目录，并在每次文件系统事件时发出 `filetree/change`，使客户端无需轮询即可刷新。

`listDir` 拒绝非完全限定路径（`tree-unreadable`），沿用 directory-picker browse 后端的有界名称排序列举窗口（`maxEntries`，默认 1000），跟随指向目录的符号链接，并跳过断链或循环链接。`search` 在根下递归遍历，按忽略大小写的子串匹配条目名称，受 `searchMaxMatches`（默认 200）与 `searchTimeoutMs`（默认 10 秒——到期时以已收集的匹配项落定，`truncated: true`）约束。遍历跳过 `watchIgnored` 子树（编译后的 glob 匹配器）且绝不下降符号链接目录；中途不可读的子目录静默跳过，只有根目录自身的失败才抛 `tree-unreadable`。监听开关（`usePolling`、`watchPollIntervalMs`）存在是因为网络挂载不产生原生 fs 事件；其余 Chokidar 选项是固定后端常量。

## Model Experience

无——该后端服务于 GUI 宿主的文件树，没有任何内容进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **每次落定操作一次整仓库 `git status`** — 每次列举或搜索都按最近 `.git` 祖先作用域跑一次状态扫描，同一仓库的并发操作已单飞但跨落定不缓存；在加入变更失效缓存前，超大仓库每次调用都要付出这一成本。
- **仅经典状态集** — 重命名与冲突折叠为 `modified`，继承自 seam。
- **仅名称搜索** — `search` 匹配条目名称而非文件内容，继承自 seam。
