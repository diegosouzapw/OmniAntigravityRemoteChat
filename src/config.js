// @ts-check
/**
 * Shared configuration — constants, env vars, and type definitions.
 * Single source of truth for all magic strings and numbers.
 *
 * @module config
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Project root directory (one level up from src/) */
export const PROJECT_ROOT = join(__dirname, '..');

// ─── CDP Ports ──────────────────────────────────────────────────────

/** @type {number[]} CDP debug ports to scan */
export const PORTS = process.env.CDP_PORTS
    ? process.env.CDP_PORTS.split(',').map(Number).filter(Boolean)
    : [7800, 7801, 7802, 7803];

/** @type {readonly string[]} Chat container IDs, in priority order */
export const CONTAINER_IDS = ['cascade', 'conversation', 'chat'];

/** Excluded CDP target titles (internal pages without chat) */
export const EXCLUDED_TARGET_TITLES = ['launchpad', 'settings'];

// ─── Server ─────────────────────────────────────────────────────────

export const SERVER_PORT = process.env.PORT || 4747;
export const POLL_INTERVAL = 1000;
export const CDP_CALL_TIMEOUT = 30000;
export const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '15mb';
export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || PROJECT_ROOT;
export const AUTO_TUNNEL_PROVIDER = (process.env.AUTO_TUNNEL_PROVIDER || '').toLowerCase();

// ─── Auth ───────────────────────────────────────────────────────────

export const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
export const COOKIE_SECRET = process.env.COOKIE_SECRET || 'antigravity_secret_key_1337';
export const AUTH_SALT = process.env.AUTH_SALT || '';
export const AUTH_COOKIE_NAME = 'omni_ag_auth';

/**
 * @param {string} name
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
function readBooleanEnv(name, fallback = false) {
    const value = String(process.env[name] ?? '').trim().toLowerCase();
    if (!value) return fallback;
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveIntEnv(name, fallback) {
    const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ─── Supervisor ────────────────────────────────────────────────────

export function getSupervisorSuggestMode() {
    return readBooleanEnv('SUPERVISOR_SUGGEST_MODE', false);
}

export function getSupervisorMaxQueue() {
    return readPositiveIntEnv('SUPERVISOR_MAX_QUEUE', 10);
}

// ─── Quota Service ─────────────────────────────────────────────────

export function getQuotaEnabled() {
    return readBooleanEnv('QUOTA_ENABLED', false);
}

export function getQuotaPollInterval() {
    return readPositiveIntEnv('QUOTA_POLL_INTERVAL', 300000);
}

// ─── Screenshot Timeline ───────────────────────────────────────────

export function getScreenshotEnabled() {
    return readBooleanEnv('SCREENSHOT_ENABLED', false);
}

export function getScreenshotInterval() {
    return readPositiveIntEnv('SCREENSHOT_INTERVAL', 60000);
}

export function getScreenshotMax() {
    return readPositiveIntEnv('SCREENSHOT_MAX', 100);
}

// ─── Developer Tools & Mocks ────────────────────────────────────────

export function getDevMocksEnabled() {
    return readBooleanEnv('ENABLE_DEV_MOCKS', process.env.NODE_ENV !== 'production');
}

// ─── Version ────────────────────────────────────────────────────────

export const VERSION = '1.4.1';
