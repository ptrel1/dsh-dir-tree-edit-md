# Agent Note：面向 Web GUI 的文件树能力 seam 与侧边栏界面

Status: implemented

[English](2026-08-14-file-tree-capability-seam.md) | 中文

## Problem

侧边栏的"工作区"区域是会话浏览器，不是文件树：它只列出已注册的项目目录及其对话，而模型侧的文件系统工具（`read`/`write`/`edit`/`glob`/`grep`）没有任何列目录界面（`ctx.fs.listDir` 只服务 provider 代码）。没有任何方式浏览工作区的实际文件、查看 git 状态，或标记文件让模型知晓——这正是文件浏览器式视图存在要做的三件事。

## Decision

一个**四包特性**，按仓库的 capability-seam 原则拆分：

- **`packages/host/file-tree`**（Service Definition，`ctx.fileTree`）：`listDir(path, signal)` 返回按名称排序的一层文件与目录，每行带 `gitStatus`（`modified`/`added`/`deleted`/`untracked`/`ignored`——经典集；重命名/冲突折叠为 `modified`）——文件报自身，目录聚合其下任意深度后代的最高等级状态——另有 `search(root, query, signal)` 返回扁平有界匹配列表，以及 `filetree/change` emit 事件。
- **`packages/host/file-tree-local`**（后端）：用 `opendir` 把该层流式读入有界名称排序窗口（directory-picker browse 后端的算法），经 `ctx.subprocess` 运行 `git status --porcelain=v1 -z --untracked-files=all` 折叠为经典态（`gitStatusIncludeIgnored` 开关可选加 `--ignored`），并用 Chokidar 监听每个被列举的根，发出 `filetree/change`。无 git 仓库、缺 `git` 或输出溢出都降级为不着色。`search` 带着同样的围栏递归遍历——ignore glob、symlink 目录绝不下降、每次 read 都竞速中止——并以 `searchMaxMatches`（默认 200）与 `searchTimeoutMs` 截止时间（默认 10 秒）自限；到期以已收集结果加 `truncated` 落定，只有根目录自身失败才浮出为 `tree-unreadable`，中途不可读子目录尽力跳过。
- **`packages/client/ui-file-tree`**（浏览器半）：填充外壳的 `sidebar.filetree` 槽，懒加载展开树、用 `--dsw-alias-state-*` token 上 git 色、每行复制/打开操作、多选高亮，树上方另有搜索框。"工作区/文件"切换由外壳拥有；树只注册进外壳声明的座位。
- **`packages/context/file-selection`**（选择 → 模型）：客户端经 `filetree.select` 同步多选；宿主记录持久化的 `file/selection` 会话事件，一个 system-prompt 上下文贡献把最新选择渲染为带来源的 "Selected files" 快照，使选择既对模型可见、又可从日志重建（"model-visible ⟺ logged" 规则）。

**关键裁定：**

- **不走 `ctx.fs`。** 文件树是 GUI 浏览界面，不是模型的存储栈；它像 directory-picker browse 后端一样直接读宿主文件系统，且 `listDir` 也返回文件（picker 只列目录），因为树要展示文件。
- **实时更新走转发事件白名单，而非新帧。** `filetree/change` 加入 `API_REMOTE_FORWARDED_EVENTS`（seam 暴露 client-safe 的 `./types` 子路径供形状断言看到）；网关把它作为 `host/remote-event` 转发，客户端重列已展开视图——粗粒度的整层重列，在路径级失效物有所值前这是正确做法。
- **外壳拥有视图切换。** `ui-sidebar` 在 `sidebar.workspaces` 旁声明 `sidebar.filetree`，一个两段控件切换两者；树是与 workspace 浏览器一样的 `single` 座位占有者，因此错配或重复的组合在客户端加载时失败。
- **选择按会话且落日志。** `file/selection` 事件携带完整路径集（空集清除），连续相同集合不重录，prompt 上下文读回最新事件——绝不读客户端状态——因此回放重建同一上下文。
- **懒加载、有界列举。** 一次 `listDir` 至多返回 `maxEntries`（默认 1000）并带 `truncated` 标志，目录仅在展开时列举，Chokidar 监听加 `filetree/change` 重列取代轮询。
- **仅文件名搜索，树内就地过滤。** `search` 对文件与目录名做忽略大小写子串匹配并返回扁平列表（不含祖先链——宿主从不发送它们）。客户端用纯函数 `buildFilteredTree` 重建树形：每个匹配成为真实节点，缺失层级成为合成目录节点且不带 git 色（从未被列举过），过滤视图天然全展开。宿主自行限制匹配数与墙钟时间（`searchMaxMatches`/`searchTimeoutMs`），因为客户端 30 秒 unary 超时是会话级兜底而非遍历预算；截止到期以已收集匹配加 `truncated` 落定，绝不卡死。清空查询恢复普通树；点击匹配目录清除过滤并借普通树的 `listDir` 展开定位，点击文件行保持普通多选语义。revision 变化时为存储的查询重跑搜索，使过滤视图与普通树一样随 `filetree/change` 保持鲜活。
- **有界扫描、围栏监听、客户端兜底。** git-status 扫描按仓库根单飞、按截止时间终止（`gitStatusTimeoutMs`，默认 8 秒）；到期时列举无着色地落定而非卡死，`--ignored` 默认不加（实测在本 monorepo 加它 >5 分钟，不加 0.06 秒）。监听器设 `followSymlinks: false`（pnpm 工作区的 `node_modules` 是通向虚拟存储的 junction；跟随一个就会为存储的每个目录挂一个 watcher）并经编译后的函数匹配器跳过 `watchIgnored` glob（默认 `**/node_modules/**`、`**/.git/**`、`**/.pnpm-store/**`）——chokidar 5 对字符串 `ignored` 项做精确相等比较，只有编译成 glob 才真正剪枝——另有可选 `watchDepth` 封顶挂载深度。客户端中止被取代的请求、把挂起的列举（15 秒）变成逐行重试按钮，并随转发的 `filetree/change` 重列已展开层级。

## Alternatives considered

- **为变更新增专用 `HostFrame` 变体。** 否决：remote-event 白名单已经逐字转发宿主事件且无投影；为单个事件再造一套是重复。
- **给 `ctx.fs` 加列目录工具。** 否决：GUI 浏览不得耦合模型的沙箱后端，且 seam 已向 provider 暴露 `listDir`——面向模型的列目录工具是另一个、已延后的问题。
- **整树急切枚举。** 否决：大目录或对抗目录下内存/扫描无界；有界窗口加懒加载使每层 O(maxEntries)。
- **客户端用 shell 跑 `git` 取状态。** 否决：进程关注点归宿主；`ctx.subprocess` 提供有界采集、中止与进程树终止，非仓库优雅降级。
- **把选择放在仅客户端 store。** 否决：模型可见需要持久会话事件，因此 prompt 上下文从日志派生，而非瞬态浏览器状态。
- **内容搜索（翻开文件）。** 否决：需求是名称搜索；内容索引是另一个后端（且 dsh 已有面向模型的 `grep`）。名称遍历只是 `opendir` 上的循环，受同样的 ignore/symlink 围栏约束。
- **扁平结果列表而非过滤树。** 否决：匹配散布在深层路径中，丢掉树形即丢掉位置上下文；合成祖先链在只显示相关行的同时保留目录结构，且两种模式的行行为一致——复制/打开/选择动作原样可用。
- **客户端借 `listDir` 遍历。** 否决：每层一个 RPC 会把深度搜索变成没有全局匹配数/时间上限的请求扇出；单个宿主侧 `search` 自带一个截止时间与一个上限。

## Consequences

- `web-app` 挂载 `file-tree`（宿主）、`file-selection`（宿主）、`ui-file-tree`（客户端）三行；apiproxy 新增 `filetree.list`/`filetree.select`/`filetree.search` RPC 与 `tree-unreadable`/`file-tree-unavailable` 错误码。
- connection 夹具与测试运行时新增 `filetree`/`listDir`/`selectFiles`/`searchEntries` 双打，使无 key 装配测试保持确定性。
- 未来面向模型的列目录工具、或路径级变更失效，都是既有 seam 之后的小增量。
