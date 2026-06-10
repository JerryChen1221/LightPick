# LightPick 系统架构与技术设计文档

> **LightPick** — Multi-agent Canvas for Creative Video Work
>
> 一个 AI 驱动的多人实时协作视频创作平台，人类与 AI Agent 在同一块 CRDT 画布上实时编辑。
> 全栈部署在 Cloudflare Workers 之上，支持完全自托管。

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [Monorepo 工程结构](#3-monorepo-工程结构)
4. [核心模块详解](#4-核心模块详解)
   - 4.1 [api-cf — 后端服务层](#41-api-cf--后端服务层)
   - 4.2 [web — 前端 SPA](#42-web--前端-spa)
   - 4.3 [render-server — 视频渲染容器](#43-render-server--视频渲染容器)
   - 4.4 [packages — 共享库](#44-packages--共享库)
5. [Durable Object 体系设计](#5-durable-object-体系设计)
6. [实时协同引擎 — Loro CRDT](#6-实时协同引擎--loro-crdt)
7. [AI 生成管线](#7-ai-生成管线)
8. [多 Agent 协作架构](#8-多-agent-协作架构)
9. [BYO Bridge — 本地 Agent 接入](#9-byo-bridge--本地-agent-接入)
10. [数据层设计](#10-数据层设计)
11. [插件系统](#11-插件系统)
12. [认证与安全](#12-认证与安全)
13. [关键设计决策与权衡](#13-关键设计决策与权衡)
14. [技术栈总览](#14-技术栈总览)

---

## 1. 项目概览

| 维度 | 描述 |
|------|------|
| **定位** | AI-native 视频创作平台，以无限画布（Canvas）为交互范式 |
| **核心差异** | 人类与多个 AI Agent 在同一 CRDT 文档上实时协作，而非传统的 request-response |
| **代码规模** | ~82,000 行 TypeScript，Monorepo 包含 4 个应用 + 12 个共享包 |
| **部署目标** | Cloudflare Workers（边缘计算），全球分布式，可完全自托管 |
| **协议** | PolyForm Shield 1.0.0 — 源码可用，不可竞品化 |

---

## 2. 整体架构

```
                          ┌───────────────────────────────────────┐
                          │          lightpick-web Worker             │
     Browser ─── WS ─────▶│  Vite SPA + Better Auth               │
                          │  proxies /api  /sync  /agents         │
                          └──────────────┬────────────────────────┘
                                         │ service binding
                                         ▼
                          ┌───────────────────────────────────────┐
                          │          lightpick-api Worker             │
                          │                                       │
                          │  ┌─────────────┐  ┌────────────────┐ │
                          │  │ Hono Router  │  │  Hono v1 API   │ │
                          │  └──────┬──────┘  └───────┬────────┘ │
                          │         │                  │          │
                          │  ┌──────▼──────────────────▼────────┐ │
                          │  │     Durable Object 集群           │ │
                          │  │                                   │ │
                          │  │  ProjectRoom    SupervisorAgent   │ │
                          │  │  (Loro 序列器)    (AI Chat DO)    │ │
                          │  │                                   │ │
                          │  │  ByoBridgeRoom  RuntimeRoom       │ │
                          │  │  (本地Agent桥)   (本地运行时)      │ │
                          │  │                                   │ │
                          │  │  RenderContainer                  │ │
                          │  │  (Remotion 容器)                   │ │
                          │  └───────────────────────────────────┘ │
                          │                                       │
                          │  ┌───────────────────────────────────┐ │
                          │  │  GenerationWorkflow               │ │
                          │  │  (CF Workflows — 持久化任务调度)    │ │
                          │  └───────────────────────────────────┘ │
                          └───┬────────────┬──────────┬───────────┘
                              │            │          │
                        D1 lightpick-d1   R2 lightpick-r2   External AI APIs
                        (SQLite)      (Object Store)  ├─ Google Vertex
                        ├─ users       ├─ images      ├─ fal.ai
                        ├─ projects    ├─ videos      ├─ OpenAI
                        ├─ assets      ├─ audio       └─ Kling
                        └─ api_tokens  └─ covers
```

**请求流转路径（以一次 AI 图片生成为例）：**

1. 用户在 Canvas 上创建 Image 节点，设置 prompt + model，点击 Run
2. 前端通过 Loro CRDT 向 ProjectRoom DO 写入 `{status: 'pending'}` 节点
3. ProjectRoom 的 `NodeProcessor` 检测到 pending 节点，构建 `GenerationParams`
4. 调用 `GENERATION_WORKFLOW.create()` 创建 Cloudflare Workflow 实例
5. `GenerationWorkflow.run()` 通过 `resolveProvider()` 路由到对应 AI 提供商
6. Provider 调用外部 API（如 Google Imagen），将结果上传 R2、在 D1 创建 asset 行
7. 通过 HTTP POST `/sync/<projectId>/update-node` 回写到 ProjectRoom
8. ProjectRoom 更新 Loro 文档，**广播**到所有连接的浏览器和 Agent

---

## 3. Monorepo 工程结构

```
lightpick/
├── apps/
│   ├── api-cf/          # 后端 Hono Worker + 全部 DO + Workflow
│   ├── web/             # Vite SPA + Cloudflare Pages Worker
│   ├── render-server/   # Remotion 渲染镜像（Docker → CF Container）
│   └── loro-sync-server/# Legacy，同步功能已迁入 api-cf
│
├── packages/
│   ├── shared-types/    # Zod Schemas、Model Cards、能力声明
│   ├── shared-layout/   # Canvas 自动布局算法
│   ├── web-ui/          # 共享 React 组件库
│   ├── cli/             # 终端 CLI 工具
│   ├── lightpick-bridge/    # 本地 Agent 运行时桥接
│   ├── claude-code-plugin/  # Claude Code 集成插件
│   ├── action-sdk/      # 自定义 Action 开发 SDK
│   ├── remotion-core/   # Remotion 核心状态管理
│   ├── remotion-components/ # Remotion 视频组件库
│   └── remotion-ui/     # Remotion 时间线编辑器 UI
│
├── scripts/             # 开发脚本
├── docs/                # 项目文档
└── skills/              # AI Skill 定义
```

**构建工具链：** pnpm Workspaces + Turborepo 编排，Vite 打包前端，Wrangler 部署 Workers。

---

## 4. 核心模块详解

### 4.1 api-cf — 后端服务层

这是整个系统的**核心后端**，运行在 Cloudflare Workers 上，通过 Hono 框架提供 HTTP/WS 路由。

```
apps/api-cf/src/
├── index.ts              # Worker 入口，导出 DO 和 Workflow 类
├── app.ts                # Hono 应用工厂（Plugin-aware）
├── config.ts             # Env 类型定义（Bindings）
├── providers.ts          # AI LLM 模型工厂（OpenAI / Anthropic）
│
├── agents/               # Durable Object 定义
│   ├── project-room.ts   # ProjectRoom — Loro CRDT 序列器
│   ├── supervisor.ts     # SupervisorAgent — AI Chat Agent
│   ├── generation.ts     # GenerationWorkflow — 持久化生成任务
│   ├── byo-bridge.ts     # ByoBridgeRoom — 本地 Agent 双向桥
│   ├── runtime-room.ts   # RuntimeRoom — 本地运行时 DO
│   └── tools/            # Agent 可调用的工具集
│       ├── canvas.ts     # 画布操作工具（增/删/改节点）
│       ├── timeline.ts   # 时间线编排工具
│       ├── workflow.ts   # 工作流触发工具
│       └── delegation.ts # 任务委派工具（子 Agent）
│
├── generation/           # AI 生成管线
│   ├── registry.ts       # Provider 路由器（策略模式）
│   ├── context.ts        # GenerationContext — 共享原语
│   ├── params.ts         # 生成参数 Schema
│   └── providers/        # 具体 Provider 实现
│       ├── google-image.ts
│       ├── fal-image.ts
│       ├── veo.ts        # Google Veo 视频
│       ├── fal-video.ts
│       ├── gemini-tts.ts # TTS 语音
│       ├── render.ts     # Remotion 视频渲染
│       ├── text-gen.ts
│       └── custom-action.ts  # 用户自定义 Action
│
├── loro/                 # Loro CRDT 持久化与处理
│   ├── storage.ts        # 事件溯源持久化（DO Storage）
│   ├── NodeProcessor.ts  # Pending 节点检测与任务提交
│   ├── NodeUpdater.ts    # 节点数据原子更新
│   ├── TaskPolling.ts    # 异步任务状态轮询
│   └── auth.ts           # WS 连接认证
│
├── routes/               # HTTP 路由层
│   ├── v1/               # 公开 REST API
│   │   ├── projects.ts   # 项目 CRUD
│   │   ├── assets.ts     # 素材管理
│   │   ├── sessions.ts   # Agent 会话
│   │   ├── edits.ts      # 图片编辑
│   │   ├── runtimes.ts   # 本地运行时注册
│   │   └── crew.ts       # 多人协作
│   ├── assets.ts         # 素材上传/下载
│   └── marketplace.ts    # Action 市场
│
├── services/             # 业务服务层
│   ├── assets.ts         # 素材元数据管理
│   ├── r2.ts             # R2 对象存储操作
│   ├── google-gen.ts     # Google AI 调用
│   ├── session.ts        # 会话解析
│   └── thumbnail.ts      # 缩略图生成
│
├── plugins/              # 插件系统
│   ├── types.ts          # Plugin 接口定义
│   └── registry.ts       # 插件注册表
│
├── db/                   # 数据库层
│   ├── index.ts          # Drizzle ORM 初始化
│   └── app.schema.ts     # D1 表结构定义
│
└── domain/               # 领域对象
    └── canvas.ts         # 画布状态枚举
```

### 4.2 web — 前端 SPA

Vite 构建的 React 19 单页应用，以 Cloudflare Pages Worker 托管。

**核心技术选型：**
- **画布引擎：** @xyflow/react（基于 React Flow）
- **实时同步：** loro-crdt（浏览器端 CRDT 副本）
- **动效：** Framer Motion
- **样式：** Tailwind CSS v4
- **路由：** React Router (SPA mode)
- **认证：** Better Auth 客户端

**关键页面路由：**

| 路由 | 组件 | 说明 |
|------|------|------|
| `/` | `landing.tsx` | 着陆页 |
| `/projects` | `projects.tsx` | 项目列表 |
| `/project/:id` | `project.$id.tsx` | 项目画布编辑器 |
| `/settings` | `settings.tsx` | 用户设置 |
| `/marketplace` | `marketplace.tsx` | Action 市场 |
| `/billing` | `billing.tsx` | 计费管理 |
| `/editor-standalone` | `editor-standalone.tsx` | 独立视频编辑器 |

**Worker 层** (`workers/app.ts`) 代理所有 `/api/*`、`/sync/*`、`/agents/*` 请求到 api-cf，前端只负责静态资源和 Auth cookie 传递。

### 4.3 render-server — 视频渲染容器

基于 Remotion 4 的无头渲染服务，运行在 Cloudflare Containers（Docker）中。

- **镜像组成：** Chromium + FFmpeg + Node.js
- **调用方式：** `RenderContainer` DO 管理容器生命周期
- **自动休眠：** 5 分钟无活动后自动 sleep，节省资源
- **端口：** 8080

### 4.4 packages — 共享库

| 包 | 说明 | 关键设计 |
|-----|------|----------|
| **shared-types** | Zod Schema + Model Cards | 前后端共享的类型真相源，定义所有 AI 模型能力卡片、Prompt Schema |
| **shared-layout** | Canvas 自动布局 | 碰撞检测、网格对齐、层级分组、自动缩放 |
| **web-ui** | React 组件库 | ProjectEditor、ChatbotCopilot、GroupChatPanel、Timeline 等 |
| **cli** | 命令行工具 | `lightpick auth/projects/canvas/tasks/actions/vars/room` 七大命令族 |
| **lightpick-bridge** | 本地运行时桥接 | ACP Runtime 管理、Daemon 进程、LaunchD 集成 |
| **claude-code-plugin** | Claude Code 集成 | Skills (canvas-operations / generation / project-management) + Hooks |
| **action-sdk** | 自定义 Action SDK | 开发者构建画布 Action 的类型和工具 |
| **remotion-core** | 视频编辑状态 | EditorContext (React Context)、Asset 工具函数 |
| **remotion-components** | 视频组件 | VideoComposition、Root、转场动画 |
| **remotion-ui** | 时间线 UI | Timeline、Properties Panel、Canvas Preview、拖拽交互 |

---

## 5. Durable Object 体系设计

Durable Object (DO) 是 Cloudflare 的有状态计算单元——全局单例、自带持久化存储、支持 WebSocket Hibernation。
本系统设计了 **5 个 DO 类 + 1 个 Workflow**，每个承担明确的职责边界：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Durable Object 矩阵                        │
├──────────────────┬──────────────────────────────────────────────┤
│ ProjectRoom      │ Loro CRDT 序列器。一个项目一个实例。          │
│                  │ 职责：CRDT 合并/广播、节点变更检测、           │
│                  │ 任务提交/轮询、Presence 管理、Snapshot 持久化  │
├──────────────────┼──────────────────────────────────────────────┤
│ SupervisorAgent  │ AI Chat Agent。命名: "projectId:threadId"。  │
│                  │ 每个对话线程一个实例，同一项目可并行多个 Agent。│
│                  │ 内含独立 Loro 副本，通过内部 WS 与             │
│                  │ ProjectRoom 同步。                            │
├──────────────────┼──────────────────────────────────────────────┤
│ ByoBridgeRoom    │ 浏览器↔本地 Agent 的 WebSocket 中继。         │
│                  │ 一次性 Token 配对，无持久化。                  │
├──────────────────┼──────────────────────────────────────────────┤
│ RuntimeRoom      │ 本地运行时（机器）的 DO 代理。                │
│                  │ Daemon WS + N 个 Client WS，事件扇出。        │
├──────────────────┼──────────────────────────────────────────────┤
│ RenderContainer  │ Remotion Docker 容器管理。                    │
│                  │ 5 分钟超时自动 sleep。                        │
├──────────────────┼──────────────────────────────────────────────┤
│ GenerationWorkflow│ Cloudflare Workflow (非 DO)。                │
│  (Workflow)      │ 持久化任务调度，每步可重试/超时恢复。         │
└──────────────────┴──────────────────────────────────────────────┘
```

### 关键：SupervisorAgent ↔ ProjectRoom 的双 WS 模式

```
Browser ──── WS (chat) ────► SupervisorAgent
  │                              │
  │                         WS (内部 Loro sync)
  │                              │
  └─── WS (Loro sync) ────► ProjectRoom ◄──── 其他 Agent
```

- 浏览器同时连接 ProjectRoom（画布同步）和 SupervisorAgent（AI 对话）
- SupervisorAgent 内部维护一个 Loro 副本，通过内部 WS 与 ProjectRoom 保持同步
- 当 Agent 执行 canvas tool 修改画布时，变更先写入本地副本，再广播到 ProjectRoom
- **设计动机：** Agent 需要读取完整画布状态来做决策（如"当前有哪些节点"），直接持有 CRDT 副本避免了每次工具调用都跨 DO RPC

---

## 6. 实时协同引擎 — Loro CRDT

### 为什么选 Loro？

Loro 是新一代 CRDT 库，相比 Yjs/Automerge 有以下优势：
- **原生二进制协议：** 无需 JSON 中间层，WebSocket 直传 Uint8Array
- **Shallow Snapshot：** 支持裁剪历史，控制文档体积增长
- **Rust 核心 + WASM：** 性能优于纯 JS 实现

### 数据模型

Loro 文档内部结构（Map of Maps）：

```
LoroDoc
├── nodes: Map<nodeId, NodeData>      # 所有画布节点
│   └── {id, type, position, data: {label, status, prompt, assetId, ...}}
├── edges: Map<edgeId, EdgeData>      # 节点间连线
├── projectMeta: Map                  # 项目元数据
├── tasks: Map<taskId, TaskInfo>      # 当前任务状态
└── customActions: Map<actionId, ...> # 已注册的自定义 Action
```

### 持久化策略 — 事件溯源

```
DO Storage Layout:
  loro:snapshot              → 最新浅快照 (ArrayBuffer)
  loro:snapshot-seq          → 快照对应的 seq 号
  loro:next-seq              → 下一个 update 的 seq
  loro:u:000000000001        → 增量 update (零填充保证字典序)
  loro:u:000000000002
  ...
```

- **每次写入：** append 一条增量 update 到 DO Storage
- **每 100 次写入：** 执行 compaction — 生成浅快照、删除旧 update
- **硬上限 500 次：** 防止 compaction 卡住导致 update 日志过长
- **启动恢复：** 加载 snapshot + 回放后续 update

---

## 7. AI 生成管线

### Provider 路由（策略模式）

`resolveProvider()` 根据 `GenerationParams.type` + `modelName` 分发到具体 Provider：

```
                ┌───────────────────────┐
                │  resolveProvider()    │
                └──────────┬────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
     image_gen        video_gen        audio_gen
     ┌───┴───┐       ┌───┴───┐            │
     │       │       │       │            ▼
  Google   fal.ai  Veo     fal.ai    Gemini TTS
  Imagen  (FLUX,  (Google) (Sora,
          Nano)          Kling)

     text_gen       video_render      custom_action
     ┌───┴───┐          │                 │
     │       │          ▼                 ▼
  Google   OpenAI   Remotion         用户自定义
  Gemini   /GPT    Container         Worker/Agent
```

### GenerationContext — 共享原语

每个 Provider 收到一个 `GenerationContext`，提供：

| 方法 | 说明 |
|------|------|
| `ctx.step(name, fn)` | 持久化步骤包装器（支持重试、超时） |
| `ctx.readR2Base64(key)` | 读取 R2 对象为 base64 |
| `ctx.uploadBytes(bytes)` | 上传到 R2 |
| `ctx.createAsset(params)` | 创建 D1 资产行 |
| `ctx.probeAsset(key)` | 探测媒体元数据（尺寸、时长） |
| `ctx.notifyCompleted(assetId)` | 回写节点状态到 ProjectRoom |
| `ctx.notifyFailed(err)` | 标记节点失败 |

### Workflow 持久性保证

GenerationWorkflow 运行在 Cloudflare Workflows 上，每个 `step.do()` 是一个持久化检查点：
- Worker 被 evict → Workflow 自动恢复到最后一个已完成 step
- 外部 API 超时 → 按配置重试（2 次、指数退避）
- 每步默认 5 分钟超时上限

---

## 8. 多 Agent 协作架构

### SupervisorAgent 设计

SupervisorAgent 继承 `@cloudflare/ai-chat` 的 `AIChatAgent`，扩展了：

1. **Loro 副本管理：** 持有独立 CRDT 副本，懒连接 ProjectRoom
2. **工具注册：** Canvas / Timeline / Workflow / Delegation 四类工具
3. **Hibernation 恢复：** `ensureIdentity()` 从 DO Storage 恢复身份信息
4. **超时保护：** 首 chunk 60s + 总轮次 5min 超时自动 abort
5. **断线续传：** pendingBroadcasts 队列 + 重连时全量状态推送
6. **历史修复：** `repairDanglingToolCalls()` 修复因 eviction 产生的悬挂工具调用

### Agent 工具集

```
SupervisorAgent Tools
├── Canvas Tools          # 画布操作
│   ├── add_node          # 添加节点（image/video/audio/text）
│   ├── update_node       # 更新节点属性
│   ├── delete_node       # 删除节点
│   ├── connect_nodes     # 创建连线
│   └── read_canvas       # 读取画布当前状态
│
├── Timeline Tools        # 时间线编排
│   ├── edit_timeline     # 编辑时间线 YAML
│   └── preview_timeline  # 预览时间线
│
├── Workflow Tools        # 生成流程
│   ├── run_generation    # 触发节点生成
│   └── wait_for_generation # 等待生成完成（长轮询）
│
└── Delegation Tool       # 子任务委派
    └── task_delegation   # 将复杂任务拆分给子 Agent
```

### 多 Agent 并行

同一项目可以有多个 SupervisorAgent 实例（不同 threadId），它们：
- 各自持有独立 Loro 副本
- 通过 ProjectRoom 实现最终一致性
- CRDT 自动合并冲突

---

## 9. BYO Bridge — 本地 Agent 接入

```
┌──────────┐    WS     ┌──────────────┐    WS     ┌──────────┐
│  Browser  │◄────────►│ ByoBridgeRoom │◄────────►│  Local    │
│  (React)  │  relay   │  (CF DO)      │  relay   │  Agent    │
└──────────┘           └──────────────┘           │(lightpick-   │
                                                   │ bridge)  │
                                                   └──────────┘
```

- **配对流程：** Browser 请求生成一次性 Token → 显示给用户 → 用户在本地 `lightpick-bridge` 输入 Token → 双方 WS 连接到同一 DO
- **消息中继：** DO 不解析消息内容，纯 byte-relay
- **ACP Runtime：** lightpick-bridge 包含一个本地 Agent Container Platform，支持 Node.js Agent 进程生命周期管理
- **Daemon 模式：** 通过 LaunchD 常驻后台，RuntimeRoom DO 维护在线状态

---

## 10. 数据层设计

### 数据分层原则

> **Loro 是画布真相源，D1 是元数据真相源。两者永不复制同一字段。**

| 数据 | 存储位置 | 原因 |
|------|---------|------|
| 节点位置、连线、状态 | Loro CRDT (DO Storage) | 需要实时协同 |
| 用户、项目元数据 | D1 (SQLite) | 需要 SQL 查询 |
| 素材二进制 | R2 (Object Store) | 大文件存储 |
| 素材元数据 | D1 `assets` 表 | 需要关联查询 |
| API Token | D1 `api_tokens` 表 (仅存 hash) | 安全 |
| 用户密钥 | D1 `user_variables` 表 (AES-GCM 加密) | 安全 |

### D1 Schema 关键表

```sql
project          -- 项目元数据 (id, ownerId, name, description)
assets           -- 素材 (id, userId, kind, srcR2Key, coverR2Key, metadata JSON)
asset_refs       -- 素材-项目 M:N 关联 (assetId, projectId)
api_token        -- API 令牌 (id, userId, tokenHash, tokenPrefix)
user_variable    -- 加密用户变量 (userId, key, encryptedValue)
installed_action -- 已安装 Action (userId, actionId, manifest, runtime)
installed_skill  -- 已安装 Skill (userId, skillId, linkedActionId)
```

### 素材（Asset）解析路径

```
Canvas Node
  └─ assetId (UUID)
       │
       ├─ D1 SELECT * FROM assets WHERE id = ?
       │    └─ srcR2Key: "gen/abc123/output.png"
       │    └─ metadata: {"width":1024, "height":768, ...}
       │
       └─ R2 GET gen/abc123/output.png → binary blob
```

**关键不变量：** 节点只存 `assetId`，永不存 `src` URL。服务端通过 D1 查表解析 R2 key。

---

## 11. 插件系统

```typescript
interface Plugin {
  name: string;

  auth?: {
    resolveUser?: (req, env) => Promise<UserContext | null>;
  };

  generation?: {
    resolveKey?: (provider, ctx) => Promise<ResolvedKey | null>;
    beforeGenerationStart?: (ctx) => Promise<void>;  // 快速失败
    beforeGenerate?: (ctx) => Promise<void>;          // Workflow 内
    afterGenerate?: (ctx, result) => Promise<void>;
    onFailure?: (ctx, err) => Promise<void>;
  };

  assets?: {
    beforeUpload?: (input) => Promise<void>;
  };

  routes?: {
    register?: (app: Hono) => void;
  };
}
```

- **OSS 模式：** `createApp()` 无插件，所有 hook 是 no-op
- **托管模式：** `createApp({ plugins: [billingPlugin, quotaPlugin] })` 注入计费/配额/BYOK
- **设计意图：** OSS 代码零侵入，商业功能通过私有 overlay 仓库注入

---

## 12. 认证与安全

### 认证层

| 场景 | 方案 | 说明 |
|------|------|------|
| 浏览器用户 | Better Auth (Cookie Session) | Google OAuth + 邮箱 OTP |
| CLI / 外部 Agent | API Token (`clsh_` + 40 hex) | 仅存 SHA-256 Hash |
| 内部 DO 通信 | `x-internal-agent: true` Header | 无需认证 |
| 本地运行时 | Machine Token (`sk_machine_*`) | 一次性注册码 + Bearer |

### 安全设计

- **用户密钥加密：** `user_variables` 表使用 AES-GCM 加密，密钥在 env 中
- **Token 不可逆：** API Token 仅存 hash，泄露数据库不暴露原文
- **跨 DO 认证：** ProjectRoom 验证 WS 连接的 Better Auth Session
- **BYO Bridge 隔离：** 一次性 Token + DO 不解析中继内容

---

## 13. 关键设计决策与权衡

### 决策 1：Loro CRDT 而非 OT（Operational Transformation）

**选择：** Loro CRDT
**原因：**
- 去中心化架构 — 每个 Agent 可以离线写入，重连后自动合并
- 无需中央排序服务器（ProjectRoom 只是 relay + persist，不做排序）
- 二进制协议性能优异

**权衡：** CRDT 文档会持续增长（需 compaction），且"删除"语义需要 tombstone

### 决策 2：Cloudflare Workflows 而非自建队列

**选择：** CF Workflows
**原因：**
- 每步持久化 — Worker eviction 不丢失进度
- 原生重试/超时/backoff
- 零运维，与 Workers 生态无缝集成

**权衡：** 受 Cloudflare 平台限制，无法迁移到其他云

### 决策 3：SupervisorAgent 持有独立 Loro 副本

**选择：** Agent DO 内嵌 Loro + 内部 WS 同步
**替代方案：** 每次工具调用 RPC 查询 ProjectRoom
**原因：**
- Agent 需要频繁读取全局画布状态（如 `read_canvas`），RPC 延迟不可接受
- 本地副本允许 Agent 批量写入后一次性广播
- CRDT 保证最终一致性

**权衡：** 内存占用 × Agent 数量，但 DO 按需实例化 + Hibernation 控制了成本

### 决策 4：Plugin 系统分离 OSS 与商业

**选择：** 运行时 Plugin 注入（DI 模式）
**原因：**
- OSS 代码 100% 可运行，无 feature flag 或条件编译
- 商业功能（计费/配额/BYOK）通过独立仓库 `lightpick-hosted` 注入
- 开发者体验优先 — `createApp()` 零配置即可运行

---

## 14. 技术栈总览

| 层 | 技术 |
|----|------|
| **前端框架** | React 19 + Vite + React Router |
| **画布引擎** | @xyflow/react (React Flow) |
| **UI** | Tailwind CSS v4 + Framer Motion |
| **实时协同** | Loro CRDT (binary WebSocket) |
| **视频编辑** | Remotion 4 (编辑器 UI + 无头渲染) |
| **后端运行时** | Cloudflare Workers (Hono) |
| **有状态计算** | Durable Objects (Hibernation API) |
| **任务调度** | Cloudflare Workflows |
| **容器化渲染** | Cloudflare Containers (Docker) |
| **数据库** | D1 (SQLite on edge) + Drizzle ORM |
| **对象存储** | R2 |
| **AI — 对话** | OpenAI GPT / Anthropic Claude (via AI SDK) |
| **AI — 图片** | Google Imagen / fal.ai (FLUX, Nano Banana) |
| **AI — 视频** | Google Veo / fal.ai (Sora, Kling) |
| **AI — 语音** | Gemini TTS |
| **认证** | Better Auth (Session + OAuth + OTP) |
| **构建** | pnpm Workspaces + Turborepo |
| **CLI** | Commander.js |
| **测试** | Vitest |
| **部署** | Wrangler + GitHub Actions |

---

*Generated at 2026-06-08. Based on source code analysis of the LightPick repository.*
