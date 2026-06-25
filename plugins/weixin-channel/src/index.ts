#!/usr/bin/env node
/**
 * weixin-channel — a Claude Code channel that bridges personal WeChat
 * (Tencent iLink protocol) into the active Claude Code session.
 *
 *   Inbound:  ILinkClient.poll()  -> notifications/claude/channel
 *             Claude sees <channel source="weixin" user_id="...">text</channel>
 *   Outbound: reply tool          -> ILinkClient.sendTextChunked() -> WeChat
 *
 * This is a CHANNEL, not a standalone bot. Claude runs in the interactive
 * Claude Code session; we only forward messages in and replies out. Claude's
 * own tools (Bash, Edit, ...) execute in the session — tool approvals happen
 * in the local terminal unless you also implement permission relay (see
 * README, "权限中继" section).
 *
 * CRITICAL: this process speaks MCP over stdio. It must NEVER write to stdout
 * (that would corrupt the protocol stream). All diagnostics go to stderr.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ILinkClient,
  loginWithQR,
  MessageType,
  MessageItemType,
  type WeixinMessage,
  type GetUpdatesResp,
} from "weixin-ilink";
import fs from "node:fs";
import path from "node:path";
import {
  loadCredentials,
  loadSyncBuf,
  saveSyncBuf,
  loadContextTokens,
  getContextToken,
  setContextToken,
  loadChannelConfig,
  saveCredentials,
  STATE_DIR,
  type ChannelConfig,
  type Credentials,
} from "./store.js";

const SESSION_EXPIRED_ERRCODE = -14;
const SESSION_PAUSE_MS = 60 * 60 * 1000; // 1 hour

const QR_PNG = path.join(STATE_DIR, "login-qrcode.png");
const QR_URL = path.join(STATE_DIR, "login-qrcode.txt");

const log = (...a: unknown[]) => console.error("[weixin-channel]", ...a);

// --- Server-side QR login: render PNG + push a channel event so Claude ---
// --- displays the QR image in the conversation for the user to scan.    ---
// The MCP subprocess can't print a terminal QR (Claude Code doesn't stream
// server stdout/stderr), so we hand the image to Claude via a notification.
async function serverLogin(mcp: Server): Promise<Credentials> {
  const QRCode = await import("qrcode");
  const result = await loginWithQR({
    onQRCode: async (url) => {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(QR_URL, url);
      } catch {
        // ignore
      }
      // Render the QR as terminal ASCII so Claude can display it inline in a
      // code block — no image file, no path. Generate the string first.
      let ascii = "";
      try {
        ascii = await QRCode.toString(url, { type: "terminal", small: true });
      } catch {
        // ignore
      }
      mcp
        .notification({
          method: "notifications/claude/channel",
          params: {
            content:
              "微信尚未登录。请扫描下方二维码完成登录（在微信中扫码并确认）：\n\n" +
              ascii +
              "\n\n扫码并在微信确认后，登录即完成。若二维码过期，会自动重新生成。",
            meta: { login: "1" },
          },
        })
        .catch(() => {});
    },
    onStatusChange: (status) => {
      if (status === "scanned") {
        mcp
          .notification({
            method: "notifications/claude/channel",
            params: { content: "已扫码，请在微信上确认登录。", meta: { login: "1" } },
          })
          .catch(() => {});
      }
    },
  });
  return saveCredentials(result);
}

// --- Extract readable text from an inbound WeChat message ---

function extractText(msg: WeixinMessage): string {
  if (!msg.item_list?.length) return "";
  for (const item of msg.item_list) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text) {
      const ref = item.ref_msg;
      if (ref?.title) {
        return `[引用: ${ref.title}]\n${item.text_item.text}`;
      }
      return item.text_item.text;
    }
    // Voice ASR transcript
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return "";
}

async function main() {
  let creds = loadCredentials();
  let config!: ChannelConfig;

  // --- MCP server, declared as a channel ---
  const mcp = new Server(
    { name: "weixin", version: "0.1.0" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions:
        'Messages from your WeChat arrive as <channel source="weixin" user_id="...">...</channel>. ' +
        "They are inbound from a human on WeChat — treat the text as their message to you. " +
        'To reply, call the "reply" tool with the user_id from the tag and your response text. ' +
        "Long replies are split into multiple WeChat messages automatically. " +
        "Only reply when a response is warranted. " +
        'If a channel event has login="1", it carries a WeChat login QR code as terminal ASCII art. ' +
        "Display that QR code to the user VERBATIM inside a fenced code block — do not add, remove, " +
        "or modify any character, and do not describe it. Just show the code block so the user can " +
        "scan it with WeChat. Do not call the reply tool for login events.",
    },
  );

  let client: ILinkClient | null = null;

  // --- reply tool: Claude calls this to send a message back to WeChat ---
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "reply",
        description:
          "Send a message back to the WeChat user who messaged you. " +
          "Pass the user_id from the inbound <channel> tag.",
        inputSchema: {
          type: "object",
          properties: {
            user_id: {
              type: "string",
              description: "The from_user_id from the inbound <channel> tag",
            },
            text: {
              type: "string",
              description: "The message text to send back",
            },
          },
          required: ["user_id", "text"],
        },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "reply") {
      const args = (req.params.arguments ?? {}) as { user_id?: string; text?: string };
      const userId = args.user_id;
      const text = args.text;
      if (!userId || !text) {
        return {
          content: [{ type: "text" as const, text: "user_id 和 text 均为必填" }],
          isError: true,
        };
      }
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "weixin channel 未连接（缺少登录凭证）" }],
          isError: true,
        };
      }
      const ctx = getContextToken(userId);
      if (!ctx) {
        return {
          content: [
            {
              type: "text" as const,
              text: `没有 ${userId} 的 context_token，请先让对方发一条消息再回复`,
            },
          ],
          isError: true,
        };
      }
      try {
        const start = Date.now();
        const n = await client.sendTextChunked(userId, text, ctx, config.chunkMaxLength);
        const ms = Date.now() - start;
        log(`reply -> ${userId}: ${text.length} chars, ${n} 条, ${ms}ms`);
        return { content: [{ type: "text" as const, text: `已发送回复 (${n} 条消息, ${ms}ms)` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("reply 失败:", msg);
        return { content: [{ type: "text" as const, text: `发送失败: ${msg}` }], isError: true };
      }
    }
    throw new Error(`unknown tool: ${req.params.name}`);
  });

  // Connect MCP over stdio. After this point stdout is owned by MCP.
  await mcp.connect(new StdioServerTransport());
  log("channel 已注册 (source=weixin)");

  if (!creds) {
    log("未找到凭证，启动扫码登录（二维码将显示在对话中）...");
    try {
      creds = await serverLogin(mcp);
    } catch (e) {
      log("登录失败:", e instanceof Error ? e.message : e);
      log("也可在源仓库运行: npm run login");
      return; // MCP server stays up (channel registered), but no polling
    }
    log("登录成功，继续...");
  }

  config = loadChannelConfig(creds);
  loadContextTokens();
  client = new ILinkClient({ baseUrl: creds!.baseUrl, token: creds!.botToken });
  client.cursor = loadSyncBuf();

  const allowSet = new Set(config.allowedSenders);
  log(
    `账号: ${creds!.accountId}  白名单: ${allowSet.size ? [...allowSet].join(",") : "(未设-接受所有发送者⚠️)"}  分片上限: ${config.chunkMaxLength}`,
  );
  log("开始轮询微信消息...");

  // Background long-poll loop. Never resolves; errors stay inside.
  void pollLoop().catch((err) => log("poll 循环异常退出:", err));

  async function pollLoop() {
    let consecutiveFailures = 0;
    while (true) {
      try {
        const resp: GetUpdatesResp = await client!.poll();

        if ((resp.ret && resp.ret !== 0) || (resp.errcode && resp.errcode !== 0)) {
          if (resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE) {
            log("session 过期，暂停 1 小时后重试。可能需要重新 npm run login");
            await sleep(SESSION_PAUSE_MS);
            continue;
          }
          consecutiveFailures++;
          log(`poll 错误 ret=${resp.ret} errcode=${resp.errcode} (${consecutiveFailures}/3)`);
          if (consecutiveFailures >= 3) {
            consecutiveFailures = 0;
            await sleep(30_000);
          } else {
            await sleep(2_000);
          }
          continue;
        }

        consecutiveFailures = 0;
        saveSyncBuf(client!.cursor);

        for (const msg of resp.msgs ?? []) {
          await handleMessage(msg);
        }
      } catch (err) {
        consecutiveFailures++;
        log(
          "poll 异常:",
          err instanceof Error ? err.message : err,
          `(${consecutiveFailures}/3)`,
        );
        if (consecutiveFailures >= 3) {
          consecutiveFailures = 0;
          await sleep(30_000);
        } else {
          await sleep(2_000);
        }
      }
    }
  }

  async function handleMessage(msg: WeixinMessage): Promise<void> {
    if (msg.message_type !== MessageType.USER) return;
    const fromUser = msg.from_user_id;
    if (!fromUser) return;

    const text = extractText(msg);
    if (!text) {
      log(`[skip] 非文本消息 from ${fromUser}`);
      return;
    }

    // Sender gating — prevent prompt injection from untrusted senders.
    if (allowSet.size > 0 && !allowSet.has(fromUser)) {
      log(`[skip] 非白名单发送者: ${fromUser}`);
      return;
    }

    // Cache context_token; replies need it.
    if (msg.context_token) setContextToken(fromUser, msg.context_token);
    const contextToken = msg.context_token || getContextToken(fromUser);
    if (!contextToken) {
      log(`[error] 没有 context_token for ${fromUser}`);
      return;
    }

    // Typing indicator (non-blocking, non-critical)
    client!.sendTyping(fromUser, contextToken).catch(() => {});

    log(`📩 ${fromUser}: ${text.substring(0, 80)}${text.length > 80 ? "..." : ""}`);

    // Push to the Claude Code session as a channel event.
    await mcp.notification({
      method: "notifications/claude/channel",
      params: {
        content: text,
        meta: { user_id: fromUser },
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  log("启动失败:", err instanceof Error ? err.message : err);
  // Keep the process alive so the MCP transport doesn't break;
  // Claude Code will report the channel as failed to connect.
});
