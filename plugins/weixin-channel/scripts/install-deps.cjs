#!/usr/bin/env node
/**
 * SessionStart hook: install the channel's npm dependencies into the plugin's
 * CODE dir (${CLAUDE_PLUGIN_ROOT}/node_modules) on first run.
 *
 * WHY ${CLAUDE_PLUGIN_ROOT} AND NOT ${CLAUDE_PLUGIN_DATA}: the MCP server
 * (dist/index.js) lives under ${CLAUDE_PLUGIN_ROOT} and statically imports
 * weixin-ilink / @modelcontextprotocol/sdk / zod. ESM bare-import resolution
 * walks upward from the IMPORTING FILE's directory — it does NOT consult
 * process.cwd(). So deps must sit in ${CLAUDE_PLUGIN_ROOT}/node_modules to
 * be found. ${CLAUDE_PLUGIN_ROOT} already ships a package.json (it's the
 * plugin cache dir), so we just run npm install there — no copy needed.
 *
 * This hook is an optimization: the MCP server's own bootstrap
 * (dist/bootstrap.js) already self-installs deps before importing the server,
 * so first-run correctness does not depend on hook timing. This hook just
 * avoids re-running that check on every session start once deps are present.
 *
 * Pure CommonJS (.cjs) so it runs with no dependencies and isn't affected by
 * the plugin's "type": "module".
 */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

const root = process.env.CLAUDE_PLUGIN_ROOT;

if (!root) {
  // Not running as an installed plugin (e.g. local dev); nothing to do.
  process.exit(0);
}

// weixin-ilink is the sentinel: if present, the install completed.
const sentinel = path.join(root, "node_modules", "weixin-ilink");

function fail(msg) {
  console.error("[weixin-channel] dep install failed:", msg);
}

try {
  if (fs.existsSync(sentinel)) {
    // Already installed. (Plugin updates replace the whole cache dir, which
    // removes node_modules too — so a stale/missing sentinel correctly
    // triggers a reinstall on the next run after an update.)
    process.exit(0);
  }
  fs.mkdirSync(root, { recursive: true });
  cp.execSync("npm install --no-audit --no-fund --omit=dev", {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.error("[weixin-channel] dependencies installed");
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
