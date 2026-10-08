# oh-my-harness 系统架构图

> 依据当前源码（`apps/`、`packages/`）绘制。配套可离线打开的渲染版本见 `docs/architecture.html`。

## 1. 系统总图：本地优先与进程边界

```mermaid
flowchart LR
  subgraph Local["开发者本机"]
    direction TB
    Browser["浏览器<br/>apps/web (React 19 + Vite)"]

    subgraph Svr["apps/server · Node.js 22+ (Hono, 127.0.0.1:4318)"]
      direction TB
      API["/api 路由层<br/>router + controller + dto"]
      RT["AgentRuntime<br/>Run 编排 · 会话 · 上下文压缩"]
      SVC["McpService · PluginService<br/>SkillImportService · ModelService"]
      INF["基础设施<br/>JSONL 仓库 · SQLite 投影 · WorkspaceStore"]
      API --> RT --> SVC
      INF --> RT
    end

    Data[("~/.omh<br/>0700 / 0600")]
    WSDir[("工作区目录")]
    OS["文件系统 · Bash · Git<br/>(sandbox-exec 约束)"]
  end

  subgraph Remote["外部服务（仅经服务端访问）"]
    LLM["模型 Provider<br/>Anthropic · OpenAI · Google · DeepSeek · OpenRouter"]
    MCPS["远程 MCP Server<br/>SaaS 连接器"]
  end

  Browser -->|"HTTP + SSE<br/>/api/*"| API
  SVC --> Data
  INF --> Data
  RT -->|"读 / 写 / 执行"| OS
  WSDir --- OS
  RT -->|"流式补全 streamSimple"| LLM
  SVC -->|"stdio / streamable-http"| MCPS
  RT -.->|"本地 stdio MCP"| OS
```

关键边界：

- **密钥不出服务端**：浏览器只持有 HTTP 会话，模型凭据与 OAuth 令牌全部落在 `~/.omh`（目录 `0700`、文件 `0600`）。
- **单进程后端**：Web 仅通过 Vite 代理 `/api → 127.0.0.1:4318` 访问，不存在独立网关或数据库服务。
- **外部依赖只有两类**：模型 Provider 与远程 MCP Server，均由服务端发起。

## 2. 包依赖方向（apps → packages，单向）

```mermaid
flowchart TD
  Web["apps/web<br/>浏览器端聊天应用"]
  Server["apps/server<br/>组合根 + HTTP API"]

  Runtime["@oh-my-harness/agent-runtime<br/>Run 编排 · 会话 · 压缩 · 轨迹 · 能力目录 · 附件"]
  Tools["@oh-my-harness/agent-tools<br/>内置工具 · 工作区工具集 · MCP 客户端与授权 · 后台执行"]
  Plugins["@oh-my-harness/agent-plugins<br/>市场目录 · 清单校验 · 安装回滚 · Hook"]
  Policy["@oh-my-harness/agent-policy<br/>工具决策 · 会话级授权"]
  LLM["@oh-my-harness/llm<br/>Provider 注册 · ModelService · 凭据存储"]
  Shared["@oh-my-harness/shared<br/>事件 / 状态 / 错误码枚举（唯一真源）"]
  UIPro["packages/ui-pro<br/>已编译 vendor（不在重构范围）"]

  Web --> Tools
  Web --> Policy
  Web --> Shared
  Web --> UIPro
  Server --> Runtime
  Server --> Tools
  Server --> Plugins
  Server --> LLM
  Server --> Shared
  Runtime --> Tools
  Runtime --> Policy
  Runtime --> Plugins
  Runtime --> LLM
  Runtime --> Shared
  Tools --> Policy
  Tools --> Shared
  Plugins --> Shared
  LLM --> Shared
  Policy --> Shared
```

## 3. 后端组合根：`createApp()` 装配顺序

```mermaid
flowchart TD
  Env["环境<br/>OH_MY_HARNESS_DATA_DIR · server.env<br/>OH_MY_HARNESS_PUBLIC_URL · OH_MY_HARNESS_SERVER_PORT"] --> App["createApp()"]

  App --> AuthCfg["readMcpAuthConfig(dataDirectory)"]
  App --> Cred["FileCredentialStore<br/>credentials.json"]
  App --> PConf["FileProviderConfigStore<br/>provider-config.json"]
  Cred --> Models["ModelService"]
  PConf --> Models
  Models --> OAuth["OAuthSessionService"]

  App --> Repo["createJsonlSessionRepository<br/>sessions/*.jsonl"]
  App --> Idx["SessionIndex<br/>session-index.sqlite（可重建投影）"]
  App --> WS["WorkspaceStore<br/>workspaces.json"]
  App --> FE["FileEditorService"]
  App --> SBX["SandboxSettingsService"]

  App --> Mcp["McpService<br/>mcp.json + mcp-auth/"]
  App --> Plug["PluginService<br/>plugins/"]
  App --> Skill["SkillImportService<br/>skill-imports → skills/"]

  Plug -->|"capabilities() → setManagedServers()"| Mcp

  Models --> RT["AgentRuntime<br/>policy: ToolPolicy<br/>protectedRoots: [dataDirectory]"]
  Repo --> RT
  Idx --> RT
  Mcp --> RT
  Plug --> RT
  SBX --> RT

  RT --> Router["createApiRouter()<br/>+ createSkillImportRouter / McpRouter / PluginRouter"]
  App --> Close["app.close()<br/>runtime → mcp → plugins → skillImports → sessionIndex<br/>SIGINT / SIGTERM"]
```

## 4. HTTP API 分层与安全边界

```mermaid
flowchart LR
  subgraph Front["apps/web features"]
    Chat["chat<br/>composer · message · session · execution"]
    Settings["settings<br/>models · providers · mcp · plugins · skills · sandbox"]
    Trace["trace<br/>timeline · detail · search"]
  end

  subgraph Srv["apps/server /api"]
    direction TB
    Guard["settingsMutationGuard<br/>Origin / Sec-Fetch-Site / Host 白名单<br/>Content-Type · body 上限 · no-store"]
    R1["/health"]
    R2["/ai/providers · /ai/oauth · /ai/completions"]
    R3["/agent/sessions<br/>CRUD · messages · trajectory · fork · attachments"]
    R4["/agent/sessions/:id<br/>messages/stream · events/stream · steer · abort"]
    R5["/agent/sessions/:id/tool-executions<br/>list · stream · stop · restart · remove"]
    R6["/agent/capabilities"]
    R7["/workspaces · file-editor · git"]
    R8["/settings/sandbox"]
    R9["/mcp/* · /plugins/* · /skill-imports/*"]
  end

  Chat --> Guard --> R3
  Guard --> R4
  Guard --> R5
  Guard --> R7
  Settings --> R2
  Settings --> R6
  Settings --> R8
  Settings --> R9
  Trace --> R3
```

## 5. Agent Run 主链路时序

```mermaid
sequenceDiagram
  autonumber
  participant W as Web Composer
  participant R as RunController
  participant RT as AgentRuntime
  participant S as Session (JSONL)
  participant P as ToolPolicy
  participant T as Tools (workspace / MCP / skill / todo)
  participant M as ModelService → Provider

  W->>R: POST messages/stream {content, attachments, permission, skills/plugins/mcp}
  R->>RT: prompt(runInput)
  RT->>S: 读取分支 entries，修复中断的工具调用
  RT->>RT: 能力目录解析 + 插件 Hook（SessionStart / UserPromptSubmit）
  RT->>P: 解析本 Run 的 ToolPermission 与 SandboxMode
  RT->>T: 构造工作区 / MCP / skill resource / todo 工具集
  RT->>M: streamSimple（流式补全）
  M-->>RT: 文本、推理增量与工具调用请求
  RT-->>W: SSE: START · TEXT_DELTA · REASONING_DELTA · TOOL_START · TODO_UPDATED
  RT->>P: beforeToolCall
  alt 需要审批
    P-->>W: TOOL_APPROVAL_REQUIRED
    W->>R: POST tool-approvals/:approvalId（once / session / reject）
    R->>P: resolve()，写入 Session 审计条目
  else 直接放行
    P-->>RT: allow
  end
  RT->>T: 执行工具
  T-->>RT: 结果（超阈值输出旁路到 ToolExecutionManager）
  RT->>S: 追加消息、用量、压缩记录、Run 起止
  RT-->>W: USAGE · CONTEXT_USAGE_UPDATED · DONE
  Note over W,R: 断线后 GET /events/stream 重连仍在运行的 Run
```

## 6. 权限与沙箱模型

```mermaid
flowchart TD
  Call["工具调用请求"] --> Kind{"工具类型"}

  Kind -->|"内置只读 / todo / skill resource"| Allow["直接放行"]
  Kind -->|"工作区文件 / Bash 工具"| Scope{"目标路径范围"}
  Scope -->|"工作区内"| Perm{"ToolPermission"}
  Scope -->|"会话附件目录"| Perm
  Scope -->|"外部路径 / protectedRoots"| Deny["require-approval 或 deny"]
  Perm -->|read-only| RO["只读放行，写操作拒绝"]
  Perm -->|workspace-write| WW["工作区内写放行"]
  Perm -->|full-access| FA["放行，写操作仍需确认"]
  Kind -->|"MCP 工具"| Effect{"manifest 声明的 effect"}
  Effect -->|read| Allow
  Effect -->|write / execute / mcp-call| Deny

  Deny --> Decision["用户决策"]
  Decision -->|approve-once| Run["本 Run 内一次性授权"]
  Decision -->|approve-session| Persist["会话级授权（持久化审计条目）"]
  Decision -->|reject| Stop["拒绝并回传模型"]

  RO --> Sandbox["SandboxMode 落地"]
  WW --> Sandbox
  FA --> Sandbox
  Sandbox --> Mac["macOS: /usr/bin/sandbox-exec"]
  Sandbox --> Other["非 macOS: 降级 danger-full-access<br/>supported=false 如实告知 UI"]
```

## 7. 能力来源与 `~/.omh` 数据布局

```mermaid
flowchart LR
  subgraph Sources["能力来源（优先级：项目 > 用户 > 插件 > 内置）"]
    Cmd["命令模板<br/>workspace/.agents/commands<br/>~/.omh/commands"]
    Skill["技能<br/>~/.omh/skills<br/>plugins/*/skills"]
    Plug["插件<br/>官方市场 bundled / Git / 目录直装"]
    MCPs["MCP 服务<br/>独立配置 + 插件声明"]
  end

  Cmd --> Catalog["CapabilityService<br/>目录快照"]
  Skill --> Catalog
  Plug --> Catalog
  Catalog --> Prompt["System Prompt 与上下文注入"]
  MCPs --> Toolset["MCP 工具集 → Run 时绑定"]
  Plug --> Hook["插件 Hook（需显式信任）"]
  Hook --> Prompt
```

```text
~/.omh/
├── server.env                 # 部署环境（代理、端口、公开回调地址）
├── credentials.json           # 模型 Provider 凭据（API Key / OAuth）
├── provider-config.json       # Provider 与已选模型
├── workspaces.json            # 注册的工作区
├── file-editor.json           # 默认编辑器
├── sandbox-settings.json      # 沙箱模式
├── session-index.sqlite       # 会话列表投影（可从 JSONL 重建）
├── sessions/*.jsonl           # 会话真相源（消息 + custom 审计条目）
├── attachments/<sessionId>/   # 会话附件
├── skills/ · commands/        # 用户级能力
├── skill-imports/             # 技能导入暂存
├── mcp.json                   # MCP 服务配置
├── mcp-auth/
│   ├── providers.json         # 管理员维护的授权端点（插件不可覆盖）
│   ├── clients.json           # 预注册 Client ID / Secret
│   └── authorizations.json    # 运行时令牌，勿手工编辑
└── plugins/
    ├── state.json · packages/ · data/ · staging/ · catalog-cache/
```

## 8. 插件安装与 MCP 授权

```mermaid
flowchart TD
  subgraph Install["插件安装"]
    Market["官方市场（bundled）"] --> Prep["prepare / prepareDirect"]
    Src["Git 或目录直装"] --> Prep
    Prep --> Inspect["清单校验 + 内容哈希"]
    Inspect --> Commit["commit → packages/<id>/<hash>"]
    Commit --> Recompute["重算能力 → mcp.setManagedServers()"]
    Recompute --> Trust["Hook 需显式信任（hooks/trust）"]
  end

  subgraph Auth["账号连接"]
    Start["POST /mcp/servers/:id/auth/sessions"] --> Method{"授权方式"}
    Method -->|"OAuth 发现"| Cb["GET /api/mcp/oauth/callback"]
    Method -->|"设备授权"| Dev["用户码 + 验证页轮询"]
    Method -->|"手动凭据 / 环境变量"| Man["PUT /auth/credentials"]
    Cb --> Store["mcp-auth/authorizations.json（0600）"]
    Dev --> Store
    Man --> Store
  end

  Trust --> Start
  Store --> Conn["McpService 连接<br/>stdio / streamable-http"]
  Conn --> Tools["工具发现 → Run 时绑定"]
```

## 9. 前端分层

```mermaid
flowchart TD
  App["app/：装配 · 布局 · 路由状态"] --> F1["features/chat"]
  App --> F2["features/settings"]
  App --> F3["features/trace"]
  App --> C["components/ui · assistant-ui primitives<br/>packages/ui-pro"]

  F1 --> S1["composer · message · navigation · session<br/>execution · summary · usage · workspace"]
  F2 --> S2["models · providers · mcp · plugins · skills · sandbox · dialog"]
  F3 --> S3["components · hooks · utils · api"]
  F1 --> Api1["session/api · workspace/api"]
  F2 --> Api2["各自 api/ 目录"]
  F3 --> Api3["trace/api"]
```

## 10. 设计取舍速查

| 决策 | 理由 |
| --- | --- |
| 本地优先，密钥只在服务端 | 凭据不进浏览器与分发包；OAuth 回调固定在本地公开地址 |
| JSONL 为会话真相源，SQLite 仅投影 | 可读、可恢复、可审计；投影可随时重建 |
| 显式 `createApp()` 依赖注入 | 单一组合根，服务可替换为测试替身 |
| 事件协议集中在 `packages/shared` | 前后端共用枚举，避免定义漂移 |
| 工具输出溢出到独立执行日志 | 上下文可控，长任务仍可后台运行 |
| 授权与启用解耦，写操作不自动重放 | 用户意图 ≠ 长期授权 |
| 模拟状态必须可区分 | 未连接的服务不得呈现为已连接 |
