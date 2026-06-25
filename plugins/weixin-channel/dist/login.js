/**
 * Standalone login script — run `npm run login` in a source checkout.
 *
 * Delegates to runLogin (shared with the channel server's auto-login path).
 * Credentials are saved to ~/.weixin-channel/credentials.json.
 */
import { runLogin } from "./login-flow.js";
async function main() {
    console.log("=== 微信 Channel 登录 (iLink 协议) ===\n");
    const creds = await runLogin();
    console.log("\n✅ 微信连接成功！");
    console.log(`账号 ID: ${creds.accountId}`);
    console.log(`Base URL: ${creds.baseUrl}`);
    if (creds.userId)
        console.log(`用户 ID (自己): ${creds.userId}`);
    console.log("\n登录完成。现在可在 Claude Code 中安装并启用 weixin-channel 插件。\n" +
        "提示：未设白名单时接受所有发送者。要限制，编辑\n" +
        "  ~/.weixin-channel/config.json  的 allowed_senders 数组。");
}
main().catch((err) => {
    console.error("登录失败:", err instanceof Error ? err.message : err);
    process.exit(1);
});
