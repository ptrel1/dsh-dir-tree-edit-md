# @deepseek-ai/dsh-host-file-tree-local

[English](README.md) | 中文

[`file-tree` seam](../file-tree/README.md) 的本地文件系统后端：注册 `ctx.fileTree`，`listDir` 每次调用返回一层目录——直接的文件与子目录——通过 Node 标准库读取宿主文件系统，与 directory-picker 的 browse 后端一致。逐文件 git 状态来自一次经 `ctx.subprocess` 运行的 `git status --porcelain=v1 -z --untracked-files=all --ignored`，折叠为 seam 的经典状态；非仓库路径、缺失 `git` 或输出溢出会降级为不着色，而不是让列举失败。后端用 Chokidar 监听每个被列举的根目录，并在每次文件系统事件时发出 `filetree/change`，使客户端无需轮询即可刷新。

`listDir` 拒绝非完全限定路径（`tree-unreadable`），沿用 directory-picker browse 后端的有界名称排序列举窗口（`maxEntries`，默认 1000），跟随指向目录的符号链接，并跳过断链或循环链接。监听开关（`usePolling`、`watchPollIntervalMs`）存在是因为网络挂载不产生原生 fs 事件；其余 Chokidar 选项是固定后端常量。

## Model Experience

无——该后端服务于 GUI 宿主的文件树，没有任何内容进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **每层全仓库 `git status`** — 每次列举都按最近 `.git` 祖先作用域跑一次整仓库状态扫描，没有跨列举缓存；在加入变更失效缓存前，超大仓库每次展开都要付出这一成本。
- **无目录级 git 状态聚合** — `gitStatus` 仅按文件给出，继承自 seam。
- **仅经典状态集** — 重命名与冲突折叠为 `modified`，继承自 seam。
