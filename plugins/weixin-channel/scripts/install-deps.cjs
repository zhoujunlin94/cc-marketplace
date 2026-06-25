#!/usr/bin/env node
/**
 * SessionStart hook: install the channel's npm dependencies into the plugin's
 * persistent data dir (${CLAUDE_PLUGIN_DATA}/node_modules) on first run, and
 * re-install when the bundled package.json changes.
 *
 * The MCP server runs as ESM with cwd = ${CLAUDE_PLUGIN_DATA}, so its bare
 * imports (weixin-ilink, @modelcontextprotocol/sdk, zod) resolve from here.
 *
 * Pure CommonJS (.cjs) so it runs with no dependencies and isn't affected by
 * the plugin's "type": "module".
 */
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

const dataDir = process.env.CLAUDE_PLUGIN_DATA;
const root = process.env.CLAUDE_PLUGIN_ROOT;

if (!dataDir || !root) {
  // Not running as an installed plugin (e.g. local dev); nothing to do.
  process.exit(0);
}

const srcPkg = path.join(root, "package.json");
const dstPkg = path.join(dataDir, "package.json");
const dstModules = path.join(dataDir, "node_modules");

function fail(msg) {
  console.error("[weixin-channel] dep install failed:", msg);
  try {
    fs.unlinkSync(dstPkg);
  } catch {
    // ignore
  }
}

try {
  const srcTxt = fs.readFileSync(srcPkg, "utf8");
  let needInstall = true;
  try {
    if (
      fs.existsSync(dstPkg) &&
      fs.readFileSync(dstPkg, "utf8") === srcTxt &&
      fs.existsSync(dstModules)
    ) {
      needInstall = false;
    }
  } catch {
    // fall through to install
  }
  if (needInstall) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(srcPkg, dstPkg);
    cp.execSync("npm install --no-audit --no-fund --omit=dev", {
      cwd: dataDir,
      stdio: "inherit",
    });
    console.error("[weixin-channel] dependencies installed");
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
