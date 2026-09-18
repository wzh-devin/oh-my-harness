# oh-my-harness

oh-my-harness 是基于 pnpm workspace 的 AI 开发工作台。当前仓库包含浏览器端聊天应用，以及供应用直接消费的本地 UI Pro vendor 包。

## Workspace

```text
oh-my-harness/
├── apps/
│   └── web/
│       └── src/
│           ├── app/                 应用装配、布局与路由状态
│           ├── components/          无业务语义的 UI 与 assistant-ui primitives
│           ├── features/
│           │   ├── chat/            Composer、消息、导航、工作区与 mock 会话
│           │   ├── settings/        设置弹窗、模型、插件与设置状态
│           │   └── trace/           Agent 轨迹视图、类型和工具函数
│           ├── pages/               路由级页面
│           ├── lib/                 小型通用函数
│           └── styles/              全局样式与应用外壳样式
├── packages/
│   └── ui-pro/                      已编译的本地 vendor 包，不在应用重构范围
├── package.json
└── pnpm-workspace.yaml
```

每套页面、组件或功能模块通过显式 `index.ts` 暴露公共 API；模块内部直接引用具体文件，跨模块消费者从公共索引导入。Feature 业务组件统一放入所属模块的 `components/`，该目录只包含 `.tsx` 和 `index.ts`；跨文件或公共契约类型由对应 `types/` 维护，组件私有 Props 与局部类型留在 TSX 内。数据、Context、工具函数与测试分别进入对应职责目录。只有真实跨功能复用的无业务基础组件进入根级 `components/ui`。

## Commands

```bash
pnpm dev
pnpm format
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## GitHub 插件连接

Server 使用 Node.js 22.22+，从 `apps/server/.env` 读取本地配置（此文件不会提交）：

```dotenv
OH_MY_HARNESS_MCP_OAUTH_CLIENTS={"https://api.githubcopilot.com/mcp/":{"client_id":"你的 GitHub 应用 Client ID"}}
# 网络需要代理时配置；直连环境省略以下三项。
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1,::1
```

在 GitHub 应用设置中开启 **Enable Device Flow**。OAuth 应用申请 `repo`、`read:org` 和 `offline_access`；GitHub App 使用注册时配置的权限。用户安装 GitHub 插件后进入连接步骤，在 GitHub 官方页面确认短码与权限，无需填写 PAT 或 Client Secret。授权完成后启用插件即可连接 MCP。修改 `.env` 后需重启 Server。

当前会话、模型、插件和 Trace 数据均为只读或页面会话级 mock。真实 Agent runtime、连接和持久化必须位于浏览器外的 Agent API 边界。


### MCP 账号连接（插件和独立服务共用）

安装插件后在“连接服务”中点击“连接账号”或“连接并启用”，再打开服务商授权页。GitHub 使用设备短码，其他远程服务使用 OAuth + PKCE。无需把令牌发送到聊天中。支持服务端动态注册或公共客户端元数据的服务可直接进入授权；仅有平台 App 连接器、未提供公开 MCP 的能力会明确显示限制。

需要预注册应用的服务由部署管理员配置，普通用户只执行账号授权。在 `apps/server/.env` 中配置本应用自己的客户端信息（不要使用市场里其他产品的 Client ID 或占位符）：

```dotenv
OH_MY_HARNESS_PUBLIC_URL=http://127.0.0.1:4318
OH_MY_HARNESS_MCP_OAUTH_CLIENTS={"https://api.githubcopilot.com/mcp/":{"client_id":"your-device-flow-enabled-client-id"},"https://gmailmcp.googleapis.com/mcp/v1":{"client_id":"your-client-id","client_secret":"your-client-secret"},"https://mcp.slack.com/mcp":{"client_id":"your-client-id","client_secret":"your-client-secret"}}
```

服务商差异统一维护在 `apps/server/config/mcp-auth-providers.json`，部署时可用 `OH_MY_HARNESS_MCP_AUTH_PROVIDERS_FILE=/absolute/path/providers.json` 指定完整配置文件，修改后重启 Server。此文件仅包含公开端点、权限范围、账号名称字段、授权参数和配置指引，不保存 Client ID/Secret/Token。GitHub 只是其中一个设备授权配置；新增相同协议的服务无需新增专属 TypeScript 类。配置必须来自部署管理员，不能让市场插件自行覆盖可信授权端点。分发 Server 时须同时包含 `config/` 目录。

设备授权配置示例（以 MCP 地址为键）：

```json
{
  "https://mcp.example.com/mcp": {
    "device": {
      "authorizationUrl": "https://login.example.com/device/code",
      "tokenUrl": "https://login.example.com/token",
      "verificationUrl": "https://login.example.com/device",
      "scopes": ["read"]
    }
  }
}
```

自有客户端仍通过 `OH_MY_HARNESS_MCP_OAUTH_CLIENTS` 中对应地址配置。没有设备配置的远程服务继续使用 MCP SDK 的标准 OAuth 发现；改变设备端点或 Client ID 后必须重新绑定，避免把旧令牌发送到新的授权服务。

在服务商应用中登记 `${OH_MY_HARNESS_PUBLIC_URL}/api/mcp/oauth/callback`，重启 Server 后生效。服务商要求固定回调端口时，配置本应用的公开 URL 和监听端口与其保持一致；插件声明的回调端口不会擅自启动额外监听器。Google Workspace、Slack、Zoom 等仍可能需要管理员启用、应用审核和相应账号权限。Google Workspace 配置参考 <https://developers.google.com/workspace/guides/configure-mcp-servers>，Slack 参考 <https://docs.slack.dev/ai/slack-mcp-server/>，Zoom 参考 <https://developers.zoom.us/docs/mcp/>。

Google 还需要在创建 OAuth 客户端的同一个 Cloud 项目中启用对应 API 和 MCP 服务。例如 Drive 需要 `drive.googleapis.com` 与 `drivemcp.googleapis.com`，Gmail 需要 `gmail.googleapis.com` 与 `gmailmcp.googleapis.com`。账号授权成功不代表这些服务已启用；缺少时工具发现仍可能返回 HTTP 403。启用后在应用中重试连接即可。

HTTPS 部署默认发布 `/api/mcp/oauth/client-metadata` 供支持 CIMD 的服务读取，也可通过 `OH_MY_HARNESS_MCP_CLIENT_METADATA_URL` 指定实际托管的公共元数据地址。Client Secret 只放服务端，不嵌入前端或分发包。OAuth 凭据保存在 `~/.omh/mcp-auth/`，文件权限为 `0600`；所有授权方式共用 `authorizations.json`，运行时不再读取旧的 GitHub 专用凭据文件。断开连接仅撤销本机保存的凭据；服务商侧应用授权可在服务商账号设置中撤销。

没有浏览器授权方式的服务可使用面板里的“使用手动凭据”；本地 MCP 可填写声明的环境变量。授权与启用分开，重新绑定不会擅自启用已停用插件。工具调用遭遇 401 时不会自动重放写操作。

市场清单中的 Client ID 声明不会阻止动态注册；是否需要管理员配置以服务商实际发现信息为准。动态注册成功后立即保存本应用客户端，取消授权或重启后重试不会重复注册。授权资源优先采用服务商最新的受保护资源元数据，并校验其与 MCP 服务同源且路径匹配。

服务商接入限制仍须满足：Figma 仅允许其 MCP Catalog 中的客户端接入，新应用需申请候补名单；Slack 需要可创建应用的工作区。Google 测试模式仅允许配置的测试用户，公开发布还需完成其要求的验证。申请 Client ID、返回授权入口和账号实际连通是三个不同的验证步骤。
