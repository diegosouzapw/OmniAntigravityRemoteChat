// @ts-check
/**
 * CDP connection management — discovery, connection, and initialization.
 *
 * @module cdp/connection
 */

import WebSocket from 'ws';
import { PORTS, EXCLUDED_TARGET_TITLES, CDP_CALL_TIMEOUT } from '../config.js';
import { getJson } from '../utils/network.js';
import * as state from '../state.js';

/**
 * Find a single Antigravity CDP endpoint (first workbench window found).
 *
 * @returns {Promise<{port: number, url: string}>}
 * @throws {Error} If no CDP target found on any port
 */
export async function discoverCDP() {
    const errors = [];
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);

            // Priority 1: Standard Workbench
            const workbench = list.find(t => t.url?.includes('workbench.html') || (t.title && t.title.includes('workbench')));
            if (workbench?.webSocketDebuggerUrl) {
                console.log('Found Workbench target:', workbench.title);
                return { port, url: workbench.webSocketDebuggerUrl };
            }

            // Priority 2: Jetski/Launchpad (Fallback)
            const jetski = list.find(t => t.url?.includes('jetski') || t.title === 'Launchpad');
            if (jetski?.webSocketDebuggerUrl) {
                console.log('Found Jetski/Launchpad target:', jetski.title);
                return { port, url: jetski.webSocketDebuggerUrl };
            }

            // Priority 3: Revamped Gemini-based Antigravity (local HTTPS app — title changes per conversation)
            // Credit: Kelvin Tan (@kelverssg)
            const gemini = list.find(t =>
                t.type === 'page' &&
                t.webSocketDebuggerUrl &&
                t.url?.match(/^https?:\/\/127\.0\.0\.1:\d+/)
            );
            if (gemini?.webSocketDebuggerUrl) {
                console.log('Found Gemini Antigravity target:', gemini.title || gemini.url);
                return { port, url: gemini.webSocketDebuggerUrl };
            }
        } catch (e) {
            errors.push(`${port}: ${/** @type {Error} */(e).message}`);
        }
    }
    throw new Error(`CDP not found. ${errors.length ? `Errors: ${errors.join(', ')}` : 'No ports responding'}`);
}

/**
 * Discover ALL available CDP targets across all ports (multi-window).
 * Only includes real editor workbench windows or Gemini Antigravity page targets.
 *
 * @returns {Promise<import('../state.js').CDPTarget[]>}
 */
export async function discoverAllCDP() {
    /** @type {import('../state.js').CDPTarget[]} */
    const allTargets = [];

    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            for (const t of list) {
                if (!t.webSocketDebuggerUrl) continue;

                // Support classic VS Code workbench or Gemini-based Antigravity local app pages
                const isGeminiPage = t.type === 'page' && t.url?.match(/^https?:\/\/127\.0\.0\.1:\d+/);
                const isWorkbench = (t.url?.includes('workbench.html') && !t.url?.includes('jetski')) || isGeminiPage;
                if (!isWorkbench) continue;

                const titleLower = (t.title || '').toLowerCase();
                if (EXCLUDED_TARGET_TITLES.some(ex => titleLower === ex)) continue;

                allTargets.push({
                    id: `${port}:${t.id}`,
                    port,
                    title: t.title || 'Untitled',
                    url: t.url,
                    wsUrl: t.webSocketDebuggerUrl,
                    type: 'workbench'
                });
            }
        } catch (_) { /* port not responding */ }
    }
    return allTargets;
}

/**
 * Connect to a CDP WebSocket endpoint and enable Runtime.
 *
 * @param {string} url - WebSocket debugger URL
 * @returns {Promise<import('../state.js').CDPConnection>}
 */
export async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    /** @type {Map<number, {resolve: Function, reject: Function, timeoutId: ReturnType<typeof setTimeout>}>} */
    const pendingCalls = new Map();
    /** @type {Array<{id: number, name: string, origin: string}>} */
    const contexts = [];
    /** @type {Map<string, Set<(params: any) => void>>} */
    const eventListeners = new Map();

    // Single centralized message handler
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(/** @type {string} */(msg.toString()));

            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);
                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            if (data.method === 'Runtime.executionContextCreated') {
                const ctx = data.params.context;
                if (ctx.auxData?.isDefault) {
                    contexts.unshift(ctx);
                } else {
                    contexts.push(ctx);
                }
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const id = data.params.executionContextId;
                const idx = contexts.findIndex(c => c.id === id);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') {
                contexts.length = 0;
            }

            if (data.method && eventListeners.has(data.method)) {
                for (const handler of eventListeners.get(data.method) || []) {
                    try {
                        handler(data.params);
                    } catch (_) {
                        // Ignore listener errors to preserve the CDP connection.
                    }
                }
            }
        } catch (_) { /* malformed message */ }
    });

    /** @type {(method: string, params?: object) => Promise<any>} */
    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });

    /**
     * @param {string} event
     * @param {(params: any) => void} handler
     */
    const on = (event, handler) => {
        if (!eventListeners.has(event)) {
            eventListeners.set(event, new Set());
        }
        eventListeners.get(event)?.add(handler);
    };

    /**
     * @param {string} event
     * @param {(params: any) => void} handler
     */
    const off = (event, handler) => {
        eventListeners.get(event)?.delete(handler);
    };

    await call('Runtime.enable', {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts, on, off };
}

/**
 * Initialize CDP connection — discover and connect.
 * Updates shared state with the new connection.
 *
 * @returns {Promise<import('../state.js').CDPConnection>}
 */
export async function initCDP() {
    console.log('🔍 Discovering Antigravity CDP endpoint...');
    const cdpInfo = await discoverCDP();
    console.log(`✅ Found Antigravity on port ${cdpInfo.port} `);

    console.log('🔌 Connecting to CDP...');
    const conn = await connectCDP(cdpInfo.url);
    state.setCdpConnection(conn);
    console.log(`✅ Connected! Found ${conn.contexts.length} execution contexts\n`);
    return conn;
}
