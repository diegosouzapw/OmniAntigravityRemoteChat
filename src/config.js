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
export const PORTS = [7800, 7801, 7802, 7803];

/** @type {readonly string[]} Chat container IDs, in priority order */
export const CONTAINER_IDS = ['cascade', 'conversation', 'chat'];

/** Excluded CDP target titles (internal pages without chat) */
export const EXCLUDED_TARGET_TITLES = ['launchpad', 'settings'];

// ─── Server ─────────────────────────────────────────────────────────

export const SERVER_PORT = process.env.PORT || 4747;
export const POLL_INTERVAL = 1000;
export const CDP_CALL_TIMEOUT = 30000;

// ─── Auth ───────────────────────────────────────────────────────────

export const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
export const COOKIE_SECRET = process.env.COOKIE_SECRET || 'antigravity_secret_key_1337';
export const AUTH_SALT = process.env.AUTH_SALT || '';
export const AUTH_COOKIE_NAME = 'omni_ag_auth';

// ─── Version ────────────────────────────────────────────────────────

export const VERSION = '0.5.3';
