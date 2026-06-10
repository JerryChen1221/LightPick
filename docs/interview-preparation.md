# LightPick 项目面试讲解准备 — AI视频生成Agent方向

> 面向岗位：字节番茄小说 · AI Agent开发工程师
> 核心能力展示：多Agent协作架构设计 × AI视频生成全链路 × 分布式系统工程实践

---

## 一、30秒电梯演讲（面试开场）

> "我参与开发的 LightPick 是一个 AI 驱动的多Agent协作视频创作平台。用户通过对话界面描述创意需求，系统自动拆解为剧本编写、概念设计、分镜绘制、视频生成、时间线剪辑等子任务，由一个 Supervisor Agent 协调多个专业子Agent（ScriptWriter、ConceptArtist、StoryboardDesigner、Editor）在同一个 CRDT 画布上实时协作完成。底层支持 Google Veo、fal.ai Sora/Kling/FLUX 等多个文生视频/文生图模型的统一调度，通过 Cloudflare Durable Objects 实现有状态的持久化工作流，确保生成任务的可靠性和幂等性。"

---

## 二、项目架构全景（白板讲解）

### 2.1 系统分层架构

```
┌─────────────────────── Client Layer ───────────────────────┐
│  React SPA + @xyflow/react Canvas + Framer Motion          │
│  ChatbotCopilot ──WebSocket──► SupervisorAgent DO          │
│  Canvas Editor ──WebSocket──► ProjectRoom DO (Loro sync)   │
└────────────────────────────────────────────────────────────┘
                          │
┌─────────────────── Agent Layer (DO) ──────────────────────┐
│                                                            │
│  SupervisorAgent DO ── 决策中枢                             │
│    ├── 解析用户意图 (LLM Chat + Function Calling)           │
│    ├── 任务拆解与委派 (task_delegation tool)                │
│    ├── 4个专业子Agent (ScriptWriter / ConceptArtist /      │
│    │   StoryboardDesigner / Editor)                        │
│    ├── Canvas工具集 (10+ CRDT操作工具)                      │
│    └── 本地 Loro CRDT 副本 (与ProjectRoom同步)             │
│                                                            │
│  ProjectRoom DO ── 数据中枢                                │
│    ├── Loro CRDT 排序器 (所有写入的单一真相源)               │
│    ├── Event-sourced 持久化 (snapshot + update log)         │
│    ├── NodeProcessor (监听pending节点→提交生成任务)          │
│    └── TaskPolling (轮询外部生成状态回写节点)                │
│                                                            │
└────────────────────────────────────────────────────────────┘
                          │
┌──────────────── Generation Layer (Workflow) ──────────────┐
│                                                            │
│  GenerationWorkflow (CF Workflow)                          │
│    ├── Strategy Pattern: resolveProvider(params)           │
│    ├── 视频: veoProvider / falVideoProvider                │
│    ├── 图片: googleImageProvider / falImageProvider        │
│    ├── 音频: geminiTtsProvider                             │
│    ├── 文本: googleTextProvider / textGenProvider          │
│    ├── 理解: understandProvider (VLM多模态理解)             │
│    └── 描述: describeProvider                              │
│                                                            │
│  GenerationContext ── 统一的生成上下文                       │
│    ├── Durable Step 包装 (重试/超时/幂等)                   │
│    ├── R2 存储操作 (上传/下载/Base64)                       │
│    ├── Asset Probe (视频探测: 分辨率/时长/封面帧)           │
│    └── Loro 通知 (状态回写到CRDT文档)                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
                          │
┌──────────────── Storage Layer ────────────────────────────┐
│  D1 (SQLite) + Drizzle ORM  →  项目/资产/用户元数据        │
│  R2 Object Storage           →  图片/视频/音频二进制       │
│  DO Storage                  →  Loro快照 + 更新日志        │
└────────────────────────────────────────────────────────────┘
```

### 2.2 核心数据流（剧本到视频全链路）

```
用户输入 "根据《重启日》生成视频剧本"
    │
    ▼
SupervisorAgent.onChatMessage()
    │  ├── LLM解析意图 (streamText + Function Calling)
    │  ├── 创建workspace group节点
    │  └── task_delegation(agent="ScriptWriter", instruction="...")
    │
    ▼
ScriptWriter子Agent
    │  ├── list_canvas_nodes() 检查现有节点
    │  ├── create_canvas_node(type="text", label="剧本: 重启日", content="...")
    │  ├── create_canvas_node(type="text", label="角色: 林恩", content="...")
    │  └── 返回创建报告给Supervisor
    │
    ▼
Supervisor验证 → task_delegation(agent="ConceptArtist")
    │
    ▼
ConceptArtist子Agent
    │  ├── read_canvas_node() 读取剧本内容
    │  ├── create_canvas_node(type="text", content="视觉描述prompt")
    │  ├── list_models(kind="image") 选择模型
    │  ├── create_generation_node(type="image_gen", model="flux-2-pro")
    │  ├── run_generation_node() → 触发GenerationWorkflow
    │  └── wait_for_generation(timeout=120s) → 轮询CRDT状态
    │
    ▼
GenerationWorkflow (Durable Workflow)
    │  ├── resolveProvider(type="image_gen") → falImageProvider
    │  ├── step("resolve-sources") → R2读取参考图→上传fal.storage
    │  ├── step("fal-generate") → 调用fal.ai FLUX API
    │  ├── step("probe-image") → 探测尺寸/格式
    │  ├── step("save-asset") → D1写入asset行
    │  └── ctx.notifyCompleted() → POST到ProjectRoom更新节点状态
    │
    ▼
ProjectRoom接收notify → 更新Loro文档 → 广播给所有连接
    │  ├── SupervisorAgent的wait_for_generation收到更新
    │  └── Browser Canvas实时更新显示
    │
    ▼
Supervisor → task_delegation(agent="StoryboardDesigner") → 分镜+视频生成
    │
    ▼
Supervisor → task_delegation(agent="Editor") → 时间线编排
    │
    ▼
最终视频 ← videoRenderProvider(timelineDSL)
```

---

## 三、面试核心考点深度准备

### 3.1 Agent底层原理 — ReAct + Function Calling实现

**面试回答模板：**

> "LightPick的Agent架构采用 ReAct (Reasoning + Acting) 模式，底层基于 Vercel AI SDK 的 `streamText` + `tools` 实现 Function Calling。"

**源码级证据（supervisor.ts）：**

```typescript
// 核心调用链：streamText + 工具集 + 多步推理
const result = streamText({
  model,                                    // 动态Provider (OpenAI/Anthropic/Google)
  system: cachedSystemPrompt(SUPERVISOR_PROMPT, provider),  // 缓存优化
  messages: withCacheControl(modelMessages, provider),      // 消息转换
  tools,                                    // 12个Function Calling工具
  stopWhen: stepCountIs(MAX_STEPS),         // 100步上限防无限循环
  abortSignal: turnAbort.signal,            // 3层中止控制
  prepareStep: ({ messages }) => { ... },   // 步间图像注入
});
```

**关键设计决策：**

| 设计点 | 实现 | 为什么这么做 |
|--------|------|-------------|
| 工具调用而非Prompt Engineering | AI SDK `tool()` + Zod schema | 结构化输出，避免解析错误 |
| 步数上限100步 | `stopWhen: stepCountIs(100)` | 防止Agent陷入无限tool call循环 |
| 三层超时控制 | firstChunk 60s + total 5min + client cancel | 检测LLM挂起，防止"Thinking..."永远不结束 |
| 图像透传到模型 | `prepareStep` 中strip CANVAS_IMAGE marker→注入user message | OpenAI tool-role只接受文本，需要workaround |

**面试加分点 — 挂起恢复机制：**

```typescript
// supervisor.ts: 两种自我修复机制
// 1. 陈旧流清理 (sweepStaleStream) — 清理5分钟以上的僵尸流
// 2. 悬挂工具调用修复 (repairDanglingToolCalls) — 修复因DO被驱逐导致的半完成工具调用
private async repairDanglingToolCalls(turn: number): Promise<void> {
  const DANGLING = new Set(["input-streaming", "input-available", "approval-requested"]);
  // 将所有悬挂状态的tool part标记为output-error
  // 模型看到"this tool failed"后能自主决定下一步
}
```

> **面试话术：** "真实生产环境中Agent的可靠性是最大挑战。我们遇到过DO被驱逐导致工具调用中途断开的问题，OpenAI要求每个tool_use必须有对应的tool_result，否则400拒绝。我们通过在每轮对话开始前扫描历史消息、自动修复悬挂的工具调用来解决。"

---

### 3.2 多Agent协作架构 — 任务委派与工具权限隔离

**面试回答模板：**

> "LightPick实现了一个 Supervisor-Specialist 架构的多Agent协作系统。Supervisor是唯一拥有委派权限的中枢Agent，它通过 `task_delegation` 工具将任务分发给4个专业子Agent，每个子Agent有严格的工具白名单隔离。"

**架构设计（delegation.ts）：**

```
┌──────────── Supervisor ─────────────┐
│  全量工具集 (12个工具 + delegation)   │
│  拥有对话上下文                      │
│  是唯一能做委派的Agent               │
└────┬────┬────┬────┬─────────────────┘
     │    │    │    │
     ▼    ▼    ▼    ▼
┌────┐ ┌────┐ ┌────┐ ┌────┐
│ SW │ │ CA │ │ SD │ │ Ed │   ← 4个专业子Agent
└────┘ └────┘ └────┘ └────┘

SW = ScriptWriter    → 只能: list/read/create/search 文本节点
CA = ConceptArtist   → 可以: 文本节点 + 图片生成 + 等待结果
SD = StoryboardDesigner → 可以: 文本节点 + 图片/视频生成
Ed = Editor          → 只能: 读取节点 + 时间线编辑
```

**工具权限隔离实现：**

```typescript
// delegation.ts: 每个子Agent的工具白名单
const TOOL_ALLOWLISTS: Record<string, string[]> = {
  ScriptWriter: ["list_canvas_nodes", "read_canvas_node", "create_canvas_node", "search_canvas"],
  ConceptArtist: ["list_canvas_nodes", "read_canvas_node", "create_canvas_node",
                  "create_generation_node", "run_generation_node", "wait_for_generation",
                  "list_models", "search_canvas"],
  // ...
};

// 运行时过滤
function scopeTools(allTools: ToolSet, agentName: string): ToolSet {
  const allowed = TOOL_ALLOWLISTS[agentName];
  const scoped: ToolSet = {};
  for (const name of allowed) {
    if (allTools[name]) scoped[name] = allTools[name];
  }
  return scoped;  // 子Agent只看到被允许的工具
}
```

**子Agent实时进度流式传输（Generator Tool Streaming）：**

```typescript
// delegation.ts: 使用async generator实现流式进度反馈
execute: async function* ({ agent, instruction, workspace_group_id, context })
  : AsyncGenerator<SubAgentProgress, string> {

  yield { status: "started", agent, message: `${agent} is working...` };

  const result = streamText({ model, system: specialist.prompt, tools: scopedTools });

  for await (const part of result.fullStream) {
    if (part.type === "tool-call") {
      accumulatedToolCalls.push({ id, toolName, args, status: "calling" });
      yield { status: "step", agent, step: ++stepCount, toolCalls: [...accumulated] };
    } else if (part.type === "tool-result") {
      // 更新对应tool call的状态和输出
      yield { status: "step", agent, toolCalls: [...accumulated] };
    }
  }

  yield { status: "completed", agent, toolCalls: [...accumulated] };
  return fullText;  // 最终结果返回给Supervisor
}
```

> **面试话术：** "子Agent不能看到对话历史，也不能相互通信 — 所有信息传递必须通过Supervisor显式传递。这个设计参考了微服务的'最小权限原则'：ScriptWriter只能创建文本节点，ConceptArtist能生成图片但不能编辑时间线。这避免了Agent越权操作导致的画布混乱。"

**对标字节面试考点：**

| 考点 | LightPick实现 | 延伸答案 |
|------|----------|---------|
| 多Agent调度方案 | Supervisor统一调度，子Agent无对话上下文 | 优点：简单可控；缺点：所有信息必须显式传递，增加token消耗 |
| 任务拆分逻辑 | Supervisor通过LLM推理自主决定委派谁 | prompt中定义每个Agent的能力边界，LLM选择最合适的 |
| Agent间通信 | 不直接通信，通过CRDT画布间接共享状态 | CRDT保证最终一致性，避免Agent之间的直接依赖 |
| Agent幻觉兜底 | 工具调用+结构化输出，Supervisor验证子Agent的创建报告 | `list_canvas_nodes()` 确认节点确实被创建了 |

---

### 3.3 LLM工程落地 — 提示词工程 + 多模型Provider

**Provider策略模式（registry.ts）：**

```typescript
// 策略模式：根据生成类型+模型名称路由到具体Provider
export function resolveProvider(params: GenerationParams): GenerationProvider {
  switch (params.type) {
    case "video_gen":
      return isGoogleVideoModel(model) ? veoProvider : falVideoProvider;
    case "image_gen":
      return isGoogleImageModel(model) ? googleImageProvider : falImageProvider;
    case "audio_gen":
      return geminiTtsProvider;
    case "text_gen":
      return isGoogleTextModel(model) ? googleTextProvider : textGenProvider;
    case "understand":
      return understandProvider;  // VLM多模态理解
  }
}
```

**统一Provider接口（依赖倒置原则 DIP）：**

```typescript
// provider.ts: 极简接口
export interface GenerationProvider {
  readonly name: string;
  execute(ctx: GenerationContext): Promise<void>;
}

// 所有Provider只需实现 execute(ctx)
// ctx 提供：step() 持久化步骤、R2读写、probe探测、D1资产、Loro通知
```

**以 Veo 视频生成为例 — 多步持久化工作流：**

```typescript
// veo.ts: 4步持久化工作流
// Step 1: 提交 (POST :predictLongRunning → operationName)
const { operationName } = await ctx.step("veo-submit", async () => {
  // R2读取参考帧 → Base64 → Vertex API提交
  return await submitVeoOperation(env, { prompt, image, referenceImages });
});

// Step 2: 轮询 (POST :fetchPredictOperation → 解码视频 → R2上传)
const storageKey = await ctx.step("veo-poll", async () => {
  const { bytes } = await pollVeoOperation(env, modelId, operationName);
  return ctx.uploadBytes(bytes, "video/mp4");
});

// Step 3: 探测 (视频元数据提取)
const probe = await ctx.step("probe-video", async () => ctx.probe("video", storageKey));

// Step 4: 保存 (D1资产行)
await ctx.step("save-asset", async () => ctx.createAsset({ kind: "video", ... }));

// 通知完成 (更新CRDT画布节点状态)
await ctx.notifyCompleted({ assetId });
```

**为什么split submit/poll（面试必讲的Cost Optimization故事）：**

> "Veo的定价是$0.50/秒。之前我们用单个step包裹整个生成过程，但Durable Object会因部署、代码更新等原因被驱逐。单次重试意味着重新提交一个新的生成请求，成本$2-5。拆分成submit+poll后，submit步骤的输出（operationName）被持久化到Workflow DO state，重试只会re-poll同一个operation而不是重新生成，节省了大量成本。"

**多模型LLM Chat配置：**

```typescript
// 支持3大LLM Provider切换 (通过环境变量配置)
// AI_PROVIDER=anthropic / openai / google
// AI_MODEL=claude-sonnet-4-20250514 / gpt-4o / gemini-2.5-flash-lite

// Prompt缓存优化 — 区分OpenAI自动缓存和Anthropic显式缓存
export function cachedSystemPrompt(prompt: string, provider: ProviderType) {
  if (provider === "anthropic") {
    return [{ type: "text", text: prompt, providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } }
    }}];
  }
  return prompt;  // OpenAI自动缓存
}
```

---

### 3.4 CRDT实时协作 — 多Agent共享画布的一致性保证

**面试回答模板：**

> "LightPick使用 Loro CRDT 实现多Agent和多用户在同一画布上的实时协作。每个SupervisorAgent DO维护一个独立的Loro副本（replica），通过WebSocket与ProjectRoom DO（Loro排序器）同步。CRDT的合并是幂等的，保证最终一致性，不需要任何锁或冲突解决逻辑。"

**存储架构（Event-Sourcing + Shallow Snapshot）：**

```
loro:snapshot           → ArrayBuffer    最近一次浅快照
loro:snapshot-seq       → number         快照对应的序列号
loro:next-seq           → number         下一个追加序列号
loro:u:000000000001     → ArrayBuffer    二进制更新 #1
loro:u:000000000002     → ArrayBuffer    二进制更新 #2
...
```

**压缩策略：**

```typescript
const UPDATES_PER_COMPACT = 100;          // 每100个更新触发一次压缩
const UPDATES_HARD_COMPACT_THRESHOLD = 500; // 硬上限，防止压缩卡住

// 压缩 = shallow-snapshot当前状态 + 删除已压缩的update log
// 类比：Redis的RDB+AOF混合持久化
```

**断连恢复（pendingBroadcasts队列）：**

```typescript
// supervisor.ts: 解决"Agent写了节点但ProjectRoom没收到"的问题
private pendingBroadcasts: Uint8Array[] = [];
private static readonly MAX_PENDING_BROADCASTS = 1000;

private broadcastToRoom = (update: Uint8Array): void => {
  if (this.roomWs?.readyState === WebSocket.OPEN) {
    this.roomWs.send(update);
  } else {
    // 队列化，重连后 flush
    this.pendingBroadcasts.push(update);
  }
};

// 重连时：push整个doc state给ProjectRoom（CRDT合并幂等，重复无害）
const ourState = this.doc.export({ mode: "update" });
this.roomWs.send(ourState);
this.flushPendingBroadcasts();
```

> **面试话术：** "这个设计解决了一个真实的生产问题：Supervisor创建了node X并写入本地Loro副本，但ProjectRoom的WebSocket在那一刻断了，导致ProjectRoom没有node X。后续GenerationWorkflow回写node X的状态时报'Node not found'，整个生成链路卡死。解决方案是引入一个pending队列 + 重连时推送全量状态，利用CRDT的幂等合并保证不丢不重。"

---

### 3.5 VLM多模态理解能力

```typescript
// canvas.ts: understand_asset工具 — 对已有图片/视频/音频进行理解
const understandAsset = tool({
  description: "Run comprehensive understanding on an image, video, or audio asset node.",
  execute: async ({ node_id, language }) => {
    const genParams: GenerationParams = {
      type: "understand",      // 路由到 understandProvider
      r2Key: src,              // R2中的资源key
      mimeType: "video/mp4",   // 自动推断
      language,                // 语言hint（如 'zh', 'en'）
    };
    await startGeneration(env, taskId, genParams);
    // 结果写入 node.data.understanding 字段
  },
});
```

> **对标字节考点：** 这就是短剧链路中"VLM做画面理解"的实现 — 给定一个生成好的视频，VLM自动分析内容、生成文字描述、提取语音转录(ASR)，结果回写到CRDT节点供后续Agent（如Editor）使用。

---

### 3.6 生成任务的可靠性工程

**Durable Step Wrapper：**

```typescript
// context.ts: 统一的step抽象
step<T>(name: string, opts: StepOpts, fn: () => Promise<T>): Promise<T> {
  // 默认配置：2次重试 + 指数退避 + 5分钟超时
  return this.stepHandle.do(name, opts, fn);
}

// 每个step的输出被持久化到Workflow DO state
// 重试只重放失败的step，已成功的step直接返回缓存结果
```

**异常兜底和质量管控：**

```typescript
// generation.ts: Workflow级异常处理
try {
  await plugins.generation?.beforeGenerate?.(hookCtx);  // 插件前置钩子
  await provider.execute(ctx);
  await plugins.generation?.afterGenerate?.(hookCtx, {}); // 插件后置钩子
  recordGenerationEvent({ outcome: "success", durationMs });
} catch (err) {
  await plugins.generation?.onFailure?.(hookCtx, err);  // 插件失败钩子
  recordGenerationEvent({ outcome: "failure", errorMessage });
  await ctx.notifyFailed(err);  // 回写失败状态到CRDT节点
  throw err;  // 重抛让Workflow标记为errored
}
```

**面试加分 — 孤儿任务恢复：**

```typescript
// ProjectRoom中：recoverOrphanedTasks()
// 场景：Workflow已完成但NodeProcessor挂了导致状态没回写
// 方案：定时扫描所有pending节点，通过CF Workflow API查询实际状态
```

---

## 四、与字节业务场景的映射

### 4.1 剧本→短视频全链路对应

| 字节番茄小说需求 | LightPick实现 | 技术关键点 |
|----------------|----------|-----------|
| 文字剧本→AI生分镜 | ScriptWriter→ConceptArtist→StoryboardDesigner Agent链 | 多Agent链式协作，上下文传递 |
| AI生成短视频 | falVideoProvider (Sora/Kling/Seedance) + veoProvider (Veo 3.1) | 策略模式统一接口，submit/poll分离节省成本 |
| VLM画面理解 | understandProvider (Gemini视觉理解) | 图文理解、视频ASR |
| 内容审核兜底 | Plugin system beforeGenerate/afterGenerate hooks | 可扩展的审核管道 |
| 内容上架分发 | Asset管理 + R2存储 + D1元数据 | 资产溯源(sources)追踪生产链路 |

### 4.2 架构设计对标

| 字节架构关注点 | LightPick方案 | 延伸讨论 |
|--------------|----------|---------|
| 高并发处理 | Durable Objects per-project隔离，天然水平扩展 | 与K8s Pod水平扩展思路一致，DO按project分片 |
| 分布式一致性 | Loro CRDT (无冲突复制数据类型) | 对比OT(Operational Transform)的优势：离线合并、无中心排序 |
| 消息队列异步 | CF Workflow = 持久化任务队列 + 自动重试 | 类比Kafka的at-least-once语义 |
| 任务编排 | DAG工作流(build/clone/adopt) | 类比Airflow DAG，但运行在CRDT图上 |
| 缓存策略 | Prompt缓存(OpenAI/Anthropic), DO内存缓存model实例 | 节省LLM成本 |

---

## 五、高频面试问答准备

### Q1: Agent如何解决大模型幻觉（剧本逻辑错误）？

**答：** LightPick采用三层防护：
1. **结构化工具调用**：Agent不直接输出文本结果，而是通过 `create_canvas_node()` 等Function Calling工具操作画布。工具有Zod schema验证，确保输出格式正确。
2. **Supervisor验证**：每次子Agent完成任务后，Supervisor会调用 `list_canvas_nodes()` 验证节点是否真的被创建了，不依赖子Agent的自我报告。
3. **VLM视觉回检**：通过 `understand_asset` 工具对生成的图片/视频做反向理解，检查生成结果是否符合prompt描述。如果偏差大，可以 `rerun_generation_node` 重新生成。

### Q2: 多Agent调度方案和任务拆分逻辑？

**答：** 
- **调度方案**：Supervisor-Specialist模式。Supervisor是唯一的决策者和调度者，基于LLM推理选择委派的子Agent。子Agent不能互相通信或自我委派（no lateral delegation, no recursive delegation）。
- **任务拆分**：Supervisor的system prompt定义了每个子Agent的能力边界和使用场景。LLM根据用户意图自动做任务拆分 — 比如"根据故事生成视频"会被拆解为：ScriptWriter写剧本 → ConceptArtist做概念设计 → StoryboardDesigner做分镜 → Editor剪辑。
- **上下文传递**：子Agent看不到对话历史，Supervisor必须把所有需要的信息通过 `instruction` + `context` 参数显式传递。这避免了上下文污染，但增加了token消耗。

### Q3: AI内容生产流水线的异常兜底、质量管控？

**答：**
1. **Durable Workflow保证**：每个生成步骤持久化到CF Workflow DO state，重试只重放失败步骤。Veo视频生成拆分为submit+poll，重试不会重复计费。
2. **Plugin Hook系统**：`beforeGenerate` / `afterGenerate` / `onFailure` 三个钩子支持扩展审核逻辑。
3. **可观测性**：`recordGenerationEvent` 记录每次生成的outcome、耗时、模型、错误信息，用于监控和告警。
4. **孤儿任务恢复**：`recoverOrphanedTasks()` 定时扫描状态为pending但Workflow已结束的节点，避免任务卡死。
5. **级联取消**：`cascadeToken` 机制支持整个DAG的一键取消，避免上游失败后下游继续浪费算力。

### Q4: Golang高并发场景如何优化？（延伸问题）

**答：** 虽然LightPick后端是TypeScript/Cloudflare Workers，但架构思想可直接迁移到Go：
- **per-project隔离** 对应 Go中的 `sync.Map` 或 `channel per goroutine` 模型
- **CRDT无锁协作** 对应 Go中避免 `sync.Mutex` 的无锁并发设计
- **事件溯源持久化** 对应 Go中 Kafka consumer group + checkpoint
- **策略模式Provider** 对应 Go的 `interface` + `struct` 组合

### Q5: 向量数据库在Agent中的应用？

**答：** LightPick当前版本使用全文搜索（`search_canvas` 工具遍历CRDT文档）。如果引入向量数据库（如Milvus/Chroma），可以：
1. **剧本素材检索**：将历史剧本、角色库向量化，Agent创作时做语义相似度检索
2. **风格一致性**：将已生成图片的CLIP embedding存储，新生成时检索相似风格的prompt
3. **知识库增强**：RAG模式，将短剧领域知识注入Agent的上下文

---

## 六、技术亮点总结（面试结尾强调）

### 6.1 我做了什么

1. **设计并实现了多Agent协作框架**：Supervisor-Specialist架构，工具权限隔离，Generator Streaming进度反馈
2. **解决了Agent可靠性的核心问题**：悬挂工具调用修复、陈旧流清理、断连恢复队列
3. **设计了可扩展的AI生成管道**：策略模式Provider、Durable Step持久化、插件化Hook系统
4. **实现了CRDT实时协作**：Event-Sourced Loro持久化、全量状态推送断连恢复、自动压缩

### 6.2 项目数据指标（面试加分）

- 支持 **6种生成类型**（图片/视频/音频/文本/理解/描述）× **11个Provider**
- 单Agent支持 **100步推理链**，每步都有超时和重试
- Loro存储 **每100个更新自动压缩**，加载时间 O(1 snapshot + k updates)
- Provider接入 **只需实现一个接口** `{ name: string, execute(ctx): Promise<void> }`

### 6.3 与字节岗位的匹配度

| 岗位要求 | 我的经验 | 证据 |
|---------|---------|------|
| LLM/VLM智能创作Agent | 设计实现了完整的多Agent协作系统 | supervisor.ts + delegation.ts |
| 剧本→视频全链路 | 实现了文本→图片→视频→音频→时间线全自动化链路 | 11个generation provider |
| 多Agent协作 | Supervisor-Specialist架构 + 工具权限隔离 | TOOL_ALLOWLISTS + scopeTools |
| Function Calling | 12个结构化工具 + Zod schema验证 | canvas.ts + workflow.ts |
| 架构稳定性 | Durable Workflow + CRDT + 断连恢复 | veo.ts split + pendingBroadcasts |
| AI内容生产流水线 | 策略模式 + 插件Hook + 可观测性 | registry.ts + context.ts |

---

## 七、面试现场演示准备

如果面试官要求现场演示，准备以下场景：

1. **基础演示**：输入"帮我生成一张赛博朋克风格的城市图片"，展示Agent的tool call链路
2. **多Agent演示**：输入"根据《重启日》生成完整的视频剧本"，展示Supervisor→ScriptWriter→ConceptArtist的协作流程
3. **DAG工作流演示**：展示canvas上的节点依赖关系，使用 `workflow_op(kind="build")` 一键触发全链路生成
4. **实时协作演示**：打开两个浏览器窗口连接同一项目，展示CRDT实时同步

---

*文档最后更新: 2026-06-09*
*基于LightPick项目源码实际分析，所有代码引用均可在仓库中找到对应*
