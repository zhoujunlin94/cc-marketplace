/**
 * Shared QR login flow.
 *
 * Used by both the standalone `npm run login` script and the channel server's
 * auto-login-on-first-start path.
 *
 * The channel server speaks MCP over stdout and must NEVER write to stdout.
 * Claude Code does not reliably stream MCP-server stderr to the terminal
 * either, so a terminal QR code is not visible when running as a channel.
 * We therefore render the QR code to a PNG file at a fixed path — the user
 * opens that file and scans it. The terminal QR (stderr) and a URL text file
 * are kept as fallbacks for the standalone script path.
 */
import fs from "node:fs";
import path from "node:path";
import { loginWithQR } from "weixin-ilink";
import { saveCredentials, STATE_DIR, type Credentials } from "./store.js";

const QR_PNG = path.join(STATE_DIR, "login-qrcode.png");
const QR_URL = path.join(STATE_DIR, "login-qrcode.txt");

async function writeQrPng(url: string): Promise<void> {
  try {
    const QRCode = await import("qrcode");
    fs.mkdirSync(STATE_DIR, { recursive: true });
    await QRCode.toFile(QR_PNG, url, { width: 256, margin: 1 });
  } catch {
    // ignore — terminal/url fallbacks still work for standalone login
  }
}

export async function runLogin(): Promise<Credentials> {
  const qrterm = (await import("qrcode-terminal")).default;

  const result = await loginWithQR({
    onQRCode: (url) => {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(QR_URL, url);
      } catch {
        // ignore
      }
      console.log("\n[weixin-channel] 请用微信扫描二维码：\n");
      qrterm.generate(url, { small: true });
      console.log(`\n[weixin-channel] 看不到终端二维码？打开图片扫码:`);
      console.log(`[weixin-channel]   ${QR_PNG}`);
      console.log(`[weixin-channel] 或浏览器打开 URL: ${url}`);
      console.log(`[weixin-channel] (URL 也写入 ${QR_URL})\n`);
      // PNG is the reliable fallback.
      void writeQrPng(url);
    },
    onStatusChange: (status) => {
      if (status === "scanned") {
        console.log("[weixin-channel] 已扫码，请在微信上确认...");
      } else if (status === "refreshing") {
        console.log("[weixin-channel] 二维码已过期，正在刷新...");
      }
    },
  });

  return saveCredentials(result);
}
