/**
 * SessionStart hook: if no WeChat credentials exist yet, run the QR login
 * flow IN THE MAIN TERMINAL (hook stdout/stderr is shown to the user, unlike
 * the channel MCP subprocess). The channel server waits for the credential
 * file this writes.
 *
 * Uses dynamic import after chdir(${CLAUDE_PLUGIN_DATA}) so the bare imports
 * (weixin-ilink, qrcode, qrcode-terminal) resolve from the plugin's installed
 * node_modules.
 */
async function main() {
    const dataDir = process.env.CLAUDE_PLUGIN_DATA;
    if (dataDir)
        process.chdir(dataDir);
    const { loadCredentials } = await import("./store.js");
    if (loadCredentials()) {
        return; // already logged in
    }
    console.log("[weixin-channel] 未检测到微信登录凭证，开始扫码登录：\n");
    const { runLogin } = await import("./login-flow.js");
    await runLogin();
    console.log("\n[weixin-channel] 登录成功，继续启动会话。");
}
main().catch((e) => {
    console.error("[weixin-channel] 登录失败:", e instanceof Error ? e.message : e);
    console.error("[weixin-channel] 可在源仓库运行: npm run login");
    // exit 0 so we don't block the session from starting
});
export {};
