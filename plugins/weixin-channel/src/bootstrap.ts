#!/usr/bin/env node
/**
 * bootstrap — ensure runtime deps exist BEFORE loading the MCP server.
 *
 * Why this exists: the MCP server (dist/index.js) statically imports
 * weixin-ilink / @modelcontextprotocol/sdk / zod at module-load time. If
 * those aren't installed yet — e.g. first run on a new machine where the
 * SessionStart hook (scripts/install-deps.cjs) hasn't completed, or never
 * fired — the server crashes on import and Claude Code marks the MCP as
 * failed. It won't auto-retry even after deps later appear, so the user
 * has to reinstall manually.
 *
 * This bootstrap is the single source of truth for "deps present before
 * server starts": it uses ONLY node: built-ins (so it has no deps itself),
 * installs into ${CLAUDE_PLUGIN_ROOT}/node_modules if missing, then
 * dynamically imports the real server. Order is now guaranteed regardless
 * of hook timing.
 *
 * WHY ${CLAUDE_PLUGIN_ROOT} AND NOT ${CLAUDE_PLUGIN_DATA}: the server code
 * lives in ${CLAUDE_PLUGIN_ROOT}/dist (the plugin cache dir) and statically
 * imports weixin-ilink / @modelcontextprotocol/sdk / zod. ESM bare-import
 * resolution walks upward from the IMPORTING FILE's directory — it does
 * NOT consult process.cwd(). So deps must sit in
 * ${CLAUDE_PLUGIN_ROOT}/node_modules to be found by dist/index.js.
 * Installing into ${CLAUDE_PLUGIN_DATA} (which cwd-based reasoning suggests)
 * does NOT work: Node ignores cwd for ESM resolution, the server crashes
 * with ERR_MODULE_NOT_FOUND before handshake, and Claude Code reports -32000.
 *
 * CRITICAL: this process speaks MCP over stdio. It must NEVER write to
 * stdout (that corrupts the protocol stream). npm output is routed to
 * stderr only — stdio: ['ignore', 'ignore', 'inherit'].
 */
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";

const root = process.env.CLAUDE_PLUGIN_ROOT;
const log = (...a: unknown[]) => console.error("[weixin-channel]", ...a);

if (root) {
  // Deps must live in ${CLAUDE_PLUGIN_ROOT}/node_modules — see file header.
  // weixin-ilink is the sentinel: if it's there, the rest of the install
  // completed too (npm install is atomic per run).
  const sentinel = path.join(root, "node_modules", "weixin-ilink");
  if (!fs.existsSync(sentinel)) {
    try {
      fs.mkdirSync(root, { recursive: true });
      log("installing runtime dependencies (first run)…");
      cp.execSync("npm install --no-audit --no-fund --omit=dev", {
        cwd: root,
        // stdin/stdout ignored — stdout is the MCP stream, must stay clean.
        // stderr inherited so progress/errors surface in the debug log.
        stdio: ["ignore", "ignore", "inherit"],
        timeout: 240_000,
      });
      log("dependencies installed");
    } catch (e) {
      log(
        "dependency install failed:",
        e instanceof Error ? e.message : String(e)
      );
      // Fall through to import; the server will surface a clearer module
      // error if deps are still missing.
    }
  }
} else {
  // Local dev (no CLAUDE_PLUGIN_ROOT): assume deps are already resolvable
  // from the repo's own node_modules; just load the server.
}

await import("./index.js");
