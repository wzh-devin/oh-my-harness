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

## 本地配置与 MCP 账号连接

Server 使用 Node.js 22.22+。开发与生产启动均从系统用户主目录下的 `~/.omh/` 读取运行配置，不依赖仓库内的 `.env` 或服务商配置文件。目录权限为 `0700`，配置与凭据文件为 `0600`。

| 文件 | 用途 |
| --- | --- |
| `server.env` | 代理、监听端口、公开回调地址等部署环境 |
| `mcp-auth/providers.json` | 服务商授权端点、权限范围、账号字段、附加参数与配置指引 |
| `mcp-auth/clients.json` | 本应用预注册的 Client ID / Client Secret，以 MCP URL 为键 |
| `mcp-auth/authorizations.json` | 应用维护的授权令牌与动态注册结果，请勿手工覆盖 |

模型凭据、Provider 配置、工作区、会话、MCP 服务、插件安装状态和缓存同样存放在 `~/.omh/`。内置官方插件目录属于随应用发布的静态资源，继续在仓库维护。

首次部署可创建私有目录，再编辑所需文件；不要将真实凭据复制到源码或聊天中：

```bash
mkdir -p ~/.omh/mcp-auth
chmod 700 ~/.omh ~/.omh/mcp-auth
# 创建上述配置文件后，为实际存在的文件设置 chmod 600。
```

`~/.omh/server.env` 示例（网络需要代理时才添加代理项）：

```dotenv
OH_MY_HARNESS_PUBLIC_URL=http://127.0.0.1:4318
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1,::1
```

`~/.omh/mcp-auth/clients.json` 使用本应用自己的客户端信息，不使用其他产品的 Client ID 或占位符；下面仅为字段格式示例：

```json
{
  "https://mcp.example.com/mcp": {
    "client_id": "your-client-id",
    "client_secret": "your-client-secret"
  }
}
```

`~/.omh/mcp-auth/providers.json` 按需提供协议发现无法取得的配置，例如设备授权：

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

服务商配置由部署管理员维护，插件清单不能注入或覆盖这些可信端点。可选字段还包括 `setupUrl`、`authorizationParams`（`access_type` / `prompt`）以及 `device.account`（`url` / `nameField` / `headers`）。没有设备配置的远程服务使用 MCP SDK 的标准 OAuth 发现。没有预注册客户端时仍可尝试动态注册或公共客户端元数据；要求预注册的服务会提示管理员配置。

GitHub 设备授权还需在自有应用设置中开启 **Enable Device Flow**，并在上述两个 JSON 文件中配置对应的 MCP 地址、设备授权协议及 Client ID。普通用户安装后通过 GitHub 官方页面确认短码和权限，无需填写 PAT 或 Client Secret。

配置文件可以缺省，应用不会生成内置服务商表；授权 JSON 损坏或不安全时停止启动并保留原件。配置变更后需重启 Server。旧的 `apps/server/.env`、仓库服务商 JSON 和客户端环境变量不再读取；已有部署需先备份并将配置迁至上述位置。设备授权端点或其 Client ID 改变后，旧凭据不可用于新目标，但不会被自动删除；恢复相同配置可恢复原绑定。

需要隔离数据时，在启动进程环境中指定已展开的绝对路径 `OH_MY_HARNESS_DATA_DIR`；其下文件结构相同。此变量不能放在 `server.env` 中改变数据根。显式进程环境优先于 `server.env`，配置由 Node 原生 `--env-file-if-exists` 在启动前载入以保证代理生效，不使用额外启动器。启动命令使用 POSIX Shell（macOS/Linux；Windows 可在 WSL 中运行）。

安装插件后在“连接服务”中点击“连接账号”或“连接并启用”，再打开服务商授权页。插件和独立 MCP 服务共用此流程；仅有平台 App 连接器、未提供公开 MCP 的能力会明确显示限制。

在服务商应用中登记 `${OH_MY_HARNESS_PUBLIC_URL}/api/mcp/oauth/callback`，重启 Server 后生效。服务商要求固定回调端口时，配置本应用的公开 URL 和监听端口与其保持一致；插件声明的回调端口不会擅自启动额外监听器。Google Workspace、Slack、Zoom 等仍可能需要管理员启用、应用审核和相应账号权限。Google Workspace 配置参考 <https://developers.google.com/workspace/guides/configure-mcp-servers>，Slack 参考 <https://docs.slack.dev/ai/slack-mcp-server/>，Zoom 参考 <https://developers.zoom.us/docs/mcp/>。

Google 还需要在创建 OAuth 客户端的同一个 Cloud 项目中启用对应 API 和 MCP 服务。例如 Drive 需要 `drive.googleapis.com` 与 `drivemcp.googleapis.com`，Gmail 需要 `gmail.googleapis.com` 与 `gmailmcp.googleapis.com`。账号授权成功不代表这些服务已启用；缺少时工具发现仍可能返回 HTTP 403。启用后在应用中重试连接即可。

HTTPS 部署默认发布 `/api/mcp/oauth/client-metadata` 供支持 CIMD 的服务读取，也可通过 `OH_MY_HARNESS_MCP_CLIENT_METADATA_URL` 指定实际托管的公共元数据地址。Client Secret 只放服务端，不嵌入前端或分发包。OAuth 凭据保存在 `~/.omh/mcp-auth/`，文件权限为 `0600`；所有授权方式共用 `authorizations.json`，运行时不再读取旧的 GitHub 专用凭据文件。断开连接仅撤销本机保存的凭据；服务商侧应用授权可在服务商账号设置中撤销。

没有浏览器授权方式的服务可使用面板里的“使用手动凭据”；本地 MCP 可填写声明的环境变量。授权与启用分开，重新绑定不会擅自启用已停用插件。工具调用遭遇 401 时不会自动重放写操作。

市场清单中的 Client ID 声明不会阻止动态注册；是否需要管理员配置以服务商实际发现信息为准。动态注册成功后立即保存本应用客户端，取消授权或重启后重试不会重复注册。授权资源优先采用服务商最新的受保护资源元数据，并校验其与 MCP 服务同源且路径匹配。

服务商接入限制仍须满足：Figma 仅允许其 MCP Catalog 中的客户端接入，新应用需申请候补名单；Slack 需要可创建应用的工作区。Google 测试模式仅允许配置的测试用户，公开发布还需完成其要求的验证。申请 Client ID、返回授权入口和账号实际连通是三个不同的验证步骤。
