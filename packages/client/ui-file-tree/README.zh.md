# @deepseek-ai/dsh-client-ui-file-tree

[English](README.md) | 中文

侧边栏文件树：填充外壳的 `sidebar.filetree` 插槽，展示当前会话工作区的目录树。每个目录层级在展开时通过 `ctx.workspaces.listDir`（即 [`dsh-host-file-tree-local`](../../host/file-tree-local/README.md) 支撑的 `filetree.list` wire 方法）懒加载，文件携带经典 git 状态着色（`modified`/`added`/`deleted`/`untracked`/`ignored`），每行提供复制路径与打开路径操作，点击切换多选高亮。宿主转发的 `filetree/change` 事件会重新列举根目录与所有已展开层级，使外部编辑无需刷新即可出现。

外壳拥有"工作区/文件"切换；本包只把树注册进它声明的 `sidebar.filetree` 座位。选择目前是表层级 store；把它暴露给模型是姊妹选择特性的职责。

## Model Experience

无——该树是浏览器 chrome，没有任何内容进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **变更时整层重列** — 每次 `filetree/change` 都会重列根目录与所有已展开层级，而非按受影响路径做差异；在路径级失效落地前，这是粗但正确的做法。
- **选择尚未对模型可见** — 多选高亮仍停留在客户端；选择入上下文的 seam 已延后。
- **无目录级 git 状态聚合** — 某个后代发生变化的目录不携带状态着色（继承自宿主 seam）。
