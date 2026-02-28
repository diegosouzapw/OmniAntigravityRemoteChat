// @ts-check
/**
 * Shared mutable state — centralized to avoid globals scattered across modules.
 *
 * @module state
 */

/**
 * @typedef {Object} CDPConnection
 * @property {import('ws')} ws - WebSocket connection
 * @property {Array<{id: number, name: string, origin: string, auxData?: {frameId?: string, isDefault?: boolean}}>} contexts - Execution contexts
 * @property {(method: string, params?: object) => Promise<any>} call - CDP method caller
 */

/**
 * @typedef {Object} CDPTarget
 * @property {string} id - Unique target identifier (port:targetId)
 * @property {number} port - CDP debug port
 * @property {string} title - Window title
 * @property {string} url - Target URL
 * @property {string} wsUrl - WebSocket debugger URL
 * @property {string} type - Target type (e.g. 'workbench')
 */

/**
 * @typedef {Object} Snapshot
 * @property {string} html - DOM HTML content
 * @property {string} css - Captured CSS rules
 * @property {string} backgroundColor
 * @property {string} color
 * @property {string} fontFamily
 * @property {{scrollTop: number, scrollHeight: number, clientHeight: number, scrollPercent: number}} scrollInfo
 * @property {string} [error] - Error message if capture failed
 * @property {{nodes: number, htmlSize: number, cssSize: number}} stats
 */

/** @type {CDPConnection | null} */
export let cdpConnection = null;

/** @type {Snapshot | null} */
export let lastSnapshot = null;

/** @type {string | null} */
export let lastSnapshotHash = null;

/** @type {CDPTarget[]} Multi-window: all discovered targets */
export let availableTargets = [];

/** @type {string | null} Currently connected target identifier */
export let activeTargetId = null;

/** @type {string} Auth token for session validation */
export let AUTH_TOKEN = 'ag_default_token';

// ─── State Setters ──────────────────────────────────────────────────
// Using explicit setters because ES modules export live bindings,
// but reassignment must happen in the defining module.

/** @param {CDPConnection | null} conn */
export function setCdpConnection(conn) { cdpConnection = conn; }

/** @param {Snapshot | null} snap */
export function setLastSnapshot(snap) { lastSnapshot = snap; }

/** @param {string | null} hash */
export function setLastSnapshotHash(hash) { lastSnapshotHash = hash; }

/** @param {CDPTarget[]} targets */
export function setAvailableTargets(targets) { availableTargets = targets; }

/** @param {string | null} id */
export function setActiveTargetId(id) { activeTargetId = id; }

/** @param {string} token */
export function setAuthToken(token) { AUTH_TOKEN = token; }
