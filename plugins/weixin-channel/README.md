# weixin-channel

把**个人微信消息**（腾讯 iLink 协议）双向桥接到 Claude Code 会话的 [channel](https://code.claude.com/docs/zh-CN/channels-reference) 插件。

- **入站**：微信收到的消息作为 `<channel source="weixin" user_id="...">` 事件注入当前 Claude Code 会话，Claude 自动响应。
- **出站**：Claude 调用 `reply` 工具，把回复发回微信。
- **首次登录**：启动会话时若未登录，server 自动跑扫码登录，二维码以**终端字符画**形式经 channel 事件显示在对话里，Claude 原样用代码块呈现，直接扫即可。
- **发送者门控**：可选白名单，未设时接受所有发送者。

> 这是一个 **channel**，不是独立 bot。Claude 跑在你当前交互式 Claude Code 会话里；本插件只负责把微信消息搬进会话、把回复搬回微信。Claude 自带的工具（Bash/Edit…）在会话里执行，工具批准默认在本地终端完成（见下文「权限中继」）。

## 原理

```
微信用户 ──iLink 长轮询──> 本 channel (MCP server, Claude Code 子进程)
                                   │
                                   ▼  notifications/claude/channel
                          <channel source="weixin" user_id="...">消息</channel>
                                   │
                                   ▼
                            Claude Code 会话响应
                                   │
                                   ▼  reply 工具
                          ILinkClient.sendTextChunked ──> 微信
```

未登录时，server 跑 `loginWithQR`，把二维码渲染成终端字符画塞进一条 `login="1"` 的 channel 事件，Claude 收到后原样用代码块显示给用户扫码——因为 MCP 子进程的 stdout/stderr 不会显示在终端，二维码必须借道 channel 事件才能在对话里露出来。

参考实现：[crazynomad/weixin-claude-bot](https://github.com/crazynomad/weixin-claude-bot)（独立 bot，用 Claude Agent SDK）。本插件把它的 iLink 收发能力改造成 Claude Code channel 合约。

## 前置条件

- Claude Code **v2.1.80+**（channel 研究预览）
- Node.js 18+
- 一部装了微信的手机

## 快速开始

### 1. 安装插件

```
/plugin marketplace add zhoujunlin94/cc-marketplace
/plugin install weixin-channel@cc-marketplace
```

运行时依赖（`weixin-ilink` 等）**不需要手动安装**。两条路径都会自动装到 `${CLAUDE_PLUGIN_ROOT}/node_modules`（即插件代码所在目录）：

- **MCP server 入口自举**（`dist/bootstrap.js`）：server 启动时先用 `node:` 内置模块检查依赖是否存在，缺失则在 `import` 真正的 server 之前同步跑 `npm install --omit=dev`。这保证了首次安装、`SessionStart` hook 未跑完等任何时序下 server 都不会因缺依赖而崩。
- `SessionStart` hook（`scripts/install-deps.cjs`）：会话启动时若依赖缺失则重装，避免每次启动都重复检查。

> **为什么装到 `CLAUDE_PLUGIN_ROOT` 而不是 `CLAUDE_PLUGIN_DATA`**：MCP server 代码位于 `${CLAUDE_PLUGIN_ROOT}/dist`，其 bare import（`import 'weixin-ilink'`）的解析规则是**从导入文件所在目录向上找 `node_modules`，与 `process.cwd()` 无关**。`plugin.json` 里 `cwd` 设的是 `CLAUDE_PLUGIN_DATA`，但 Node 的 ESM 解析不看 `cwd`——依赖若装在 data 目录，server 会 `ERR_MODULE_NOT_FOUND` 秒崩（Claude Code 报 `-32000`）。所以必须装到代码所在的 root 目录。

### 2. 启用 channel（按会话）

研究预览期自定义 channel 不在官方允许列表，需用开发标志启动：

```bash
claude --dangerously-load-development-channels plugin:weixin-channel@cc-marketplace
```

启动横幅下方会出现 `Channels (experimental) messages from ... weixin ... inject directly in this session`。

### 3. 扫码登录（首次）

首次启动时 `~/.weixin-channel/credentials.json` 不存在，channel server 自动进入登录流程：

1. server 跑 `loginWithQR`，把二维码字符画通过 `login="1"` 的 channel 事件推给会话。
2. Claude 在对话里**原样用代码块显示二维码**（和 `npm run login` 显示的一样）。
3. 用微信扫码并确认。
4. 凭证写入 `~/.weixin-channel/credentials.json`，server 开始轮询微信消息。

之后再次启动会直接读凭证，无需再扫码。Session 过期（errcode -14）时需删除凭证重新登录：`rm ~/.weixin-channel/credentials.json`。

> 备选：也可在源仓库跑 `npm run login` 登录（二维码直接打印到终端），凭证存同一份文件，channel server 共用。

### 4. 收发消息

用另一个微信给这个 bot 账号发条消息，例如「列出当前目录的文件」。会话里收到 `<channel source="weixin" user_id="...">列出当前目录的文件</channel>`，Claude 处理后调用 `reply` 工具，回复出现在微信里。

## 配置发送者白名单

默认**未设白名单 = 接受所有发送者**（iLink bot 消息总是来自别的用户，「只允许自己」会挡掉一切）。要限制，编辑 `~/.weixin-channel/config.json`：

```json
{
  "allowed_senders": ["wxid_xxx", "wxid_yyy"],
  "chunk_max_length": 500
}
```

`from_user_id` 可在启用后让对方发条消息，从启动日志 `[weixin-channel] 📩 <id>:` 里看到（日志在 stderr，见 `~/.claude/debug/<session-id>.txt`）。

也可在 `/plugin` 启用 channel 时通过 `allowed_senders` userConfig 填（逗号分隔），优先级高于配置文件。

## 权限中继（可选，当前未启用）

本插件当前**未**声明 `claude/channel/permission` 能力：工具批准在本地终端完成。如果你希望把工具批准提示也转发到微信、用 `yes <id>` / `no <id>` 远程批准，按 [channels-reference](https://code.claude.com/docs/zh-CN/channels-reference#relay-permission-prompts) 操作：

1. `plugin.json` 的 `capabilities.experimental` 加 `"claude/channel/permission": {}`。
2. `index.ts` 里 `mcp.setNotificationHandler(PermissionRequestSchema, ...)`，在 handler 中把提示用 `client.sendText()` 发到最近活跃用户。
3. `handleMessage` 里在转发为 channel 事件前，先匹配 `^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i`，命中则发 `notifications/claude/channel/permission` 判决，不再转发为聊天。

注意：声明该能力后，**每次**工具批准都会发到微信，会比较吵。

## 与参考项目的区别

| | weixin-claude-bot（参考） | 本插件（channel） |
| --- | --- | --- |
| Claude 在哪运行 | bot 进程内，用 Claude Agent SDK | 你的交互式 Claude Code 会话 |
| 消息注入 | 不注入，直接 SDK 调用 | `<channel>` 事件注入会话 |
| 回复 | SDK 返回文本，bot 发回 | Claude 调 `reply` 工具发回 |
| 多会话 | 每用户一个 SDK 会话 | 共用你的交互会话 |

## 开发

源仓库结构：

```
plugins/weixin-channel/
├── .claude-plugin/plugin.json   # mcpServers(入口 dist/bootstrap.js) + channels + SessionStart hook
├── scripts/install-deps.cjs     # SessionStart: 装依赖到 ${CLAUDE_PLUGIN_ROOT}（代码所在目录）
├── src/
│   ├── bootstrap.ts             # server 入口：import server 前自举安装依赖（首次必装）
│   ├── index.ts                 # channel MCP server：入站 poll、reply 工具、自动扫码
│   ├── login-flow.ts            # 共用扫码流程（终端字符画 + PNG 兜底）
│   ├── login-hook.ts            # （可选）SessionStart 扫码脚本，当前未挂载
│   ├── login.ts                 # 独立 `npm run login` 脚本
│   ├── store.ts                 # 凭证/游标/context_token/配置 持久化
│   └── vendor.d.ts
├── dist/                        # tsc 产物（需提交，plugin.json 指向 dist/index.js）
├── package.json / tsconfig.json
└── README.md
```

改完源码后：

```bash
cd plugins/weixin-channel
npm install                 # 装依赖（含 dev）
node node_modules/typescript/bin/tsc -p tsconfig.json   # 重新生成 dist
# bump plugin.json / package.json 的 version，再：
claude plugin update "weixin-channel@cc-marketplace"    # 刷新缓存
```

## 注意事项

- iLink 协议是腾讯实验性协议，API 可能随时变更，**不建议用于生产**。
- Session 过期（errcode -14）时 channel 会暂停 1 小时并提示重新登录。
- channel server 绝不写 stdout（会破坏 MCP），所有日志在 stderr（`~/.claude/debug/<session-id>.txt`）。
- 状态目录：`~/.weixin-channel/`（`credentials.json` / `sync-buf.txt` / `context-tokens.json` / `config.json` / `login-qrcode.*`）。
- channel 研究预览期需 `--dangerously-load-development-channels` 启动；自定义 channel 不在官方允许列表。
