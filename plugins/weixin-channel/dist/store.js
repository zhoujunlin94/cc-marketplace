/**
 * File-based persistence for the weixin channel.
 *
 * State lives in ~/.weixin-channel/ (override with WEIXIN_CHANNEL_STATE_DIR),
 * so the login script (run from a source checkout) and the channel MCP server
 * (spawned by Claude Code from the plugin cache) read and write the SAME files.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export const STATE_DIR = process.env.WEIXIN_CHANNEL_STATE_DIR || path.join(os.homedir(), ".weixin-channel");
function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}
export function credentialsPath() {
    return path.join(STATE_DIR, "credentials.json");
}
export function saveCredentials(creds) {
    ensureDir(STATE_DIR);
    const data = { ...creds, savedAt: new Date().toISOString() };
    fs.writeFileSync(credentialsPath(), JSON.stringify(data, null, 2));
    try {
        fs.chmodSync(credentialsPath(), 0o600);
    }
    catch {
        // chmod may fail on Windows; credentials are still file-permission protected by the OS
    }
    console.error(`[weixin-channel] 凭证已保存到 ${credentialsPath()}`);
    return data;
}
export function loadCredentials() {
    try {
        const raw = fs.readFileSync(credentialsPath(), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
// --- Sync buffer (long-poll cursor, for resume across restarts) ---
function syncBufPath() {
    return path.join(STATE_DIR, "sync-buf.txt");
}
export function loadSyncBuf() {
    try {
        return fs.readFileSync(syncBufPath(), "utf-8");
    }
    catch {
        return "";
    }
}
export function saveSyncBuf(buf) {
    ensureDir(STATE_DIR);
    fs.writeFileSync(syncBufPath(), buf);
}
// --- Context tokens (per-user; required to send a reply back) ---
function contextTokensPath() {
    return path.join(STATE_DIR, "context-tokens.json");
}
let tokenCache = {};
export function loadContextTokens() {
    try {
        tokenCache = JSON.parse(fs.readFileSync(contextTokensPath(), "utf-8"));
    }
    catch {
        tokenCache = {};
    }
}
export function getContextToken(userId) {
    return tokenCache[userId];
}
export function setContextToken(userId, token) {
    tokenCache[userId] = token;
    ensureDir(STATE_DIR);
    fs.writeFileSync(contextTokensPath(), JSON.stringify(tokenCache));
}
const DEFAULT_CHUNK_MAX = 500;
function configPath() {
    return path.join(STATE_DIR, "config.json");
}
function readJsonFile(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
    catch {
        return null;
    }
}
/**
 * Load channel config. Precedence:
 *   1. plugin userConfig (exported as CLAUDE_PLUGIN_OPTION_<KEY> env vars)
 *   2. ~/.weixin-channel/config.json (allowed_senders[], chunk_max_length)
 *   3. defaults (self only, 500 chars)
 */
export function loadChannelConfig(creds) {
    const fileConfig = readJsonFile(configPath());
    let fileAllowed = [];
    if (Array.isArray(fileConfig?.allowed_senders)) {
        fileAllowed = fileConfig.allowed_senders.filter((x) => typeof x === "string");
    }
    // plugin userConfig wins
    const envList = (process.env.CLAUDE_PLUGIN_OPTION_ALLOWED_SENDERS || "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    const allowedSenders = envList.length ? envList : fileAllowed;
    // Empty = accept ALL senders. iLink bot messages always come from OTHER
    // users (you can't message your own bot account), so a "self only" default
    // would silently drop every real message. Set allowed_senders in
    // ~/.weixin-channel/config.json for production gating.
    const resolved = allowedSenders;
    const chunkMaxLength = typeof fileConfig?.chunk_max_length === "number" && fileConfig.chunk_max_length > 0
        ? fileConfig.chunk_max_length
        : DEFAULT_CHUNK_MAX;
    return { allowedSenders: resolved, chunkMaxLength };
}
