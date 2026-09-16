# agent-plugins

管理插件目录、安装版本、输入配置和启停状态。Runtime 消费插件 Skills，agent-tools 管理其 MCP 连接；插件不依赖 Runtime、Server 或 Web。

## 在页面中使用

设置 → 模型下方的“插件市场”。默认显示市场列表，点击市场后查看该市场提供的插件。

- **安装单个插件**：填写公开 Git HTTPS 仓库、可选分支/标签和插件目录（默认 `.`），读取 `plugin.json` 并审阅清单后确认安装。它显示为“直接安装”，不属于任何市场；后续按原来源手动检查更新。
- **添加插件市场**：填写公开 Git HTTPS 仓库、可选分支/标签与目录文件路径（默认 `marketplace.json`）。支持 GitHub、GitLab、Bitbucket；不接收私有访问令牌。
- **已安装插件**：从市场页顶部进入，统一完成配置、启停、检查更新、回退和卸载。
- 市场可单独刷新与移除。移除市场保留已安装插件；所有更新都需由用户主动确认。

官方目录由当前仓库的 [marketplace/marketplace.json](marketplace/marketplace.json) 维护，发布时再确定远端地址。第三方市场当前使用下述原生格式，不自动适配其他产品的插件格式。

## 维护市场和插件

复制 [代码审查插件](marketplace/plugins/code-review/plugin.json) 的目录，修改名称、版本、说明和 Skill 内容，然后在目录文件登记：

```json
{
  "schemaVersion": 1,
  "name": "team-plugins",
  "plugins": [{
    "name": "code-review",
    "displayName": "代码审查",
    "description": "检查代码变更中的问题。",
    "category": "开发",
    "version": "1.0.0",
    "source": { "kind": "bundled", "path": "plugins/code-review" }
  }]
}
```

`bundled` 路径相对目录文件；通过 Git 添加市场时，条目会固定到这次读取的真实 commit。跨仓库条目使用 `{"kind":"git","url":"https://github.com/owner/repo.git","commit":"完整的40位commit","path":"plugins/code-review"}`。名称与版本必须与插件根目录中的 `plugin.json` 一致；同版本不同内容拒绝覆盖。完整清单格式见 [GitHub 协作](marketplace/plugins/github-collaboration/plugin.json)，展示 Skill、MCP 与凭据输入绑定。

首版支持 Skills、HTTP/stdio MCP 和显式 env/headers 输入绑定。Hooks、自定义 UI、OAuth、自动更新和第三方格式适配尚未提供。安装不会启动程序；启用后才连接 MCP，相关工具调用继续受原有 Policy 约束。

## 数据和验证

服务端 `~/.omh/plugins/` 保存 `state.json`、不可变版本目录、暂存和 `catalog-cache/markets.json`。输入秘密只保存在服务端文件，不经普通 API 回显；损坏配置拒绝覆盖。目录权限为 0700，文件为 0600。测试通过 `OH_MY_HARNESS_DATA_DIR` 隔离。

```sh
pnpm --filter @oh-my-harness/agent-plugins test
pnpm --filter @oh-my-harness/server test
pnpm typecheck
pnpm lint
pnpm build
```
