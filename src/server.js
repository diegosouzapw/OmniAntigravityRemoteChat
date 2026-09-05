#!/usr/bin/env node
// @ts-check
/**
 * OmniAntigravity Remote Chat — Main Server
 * Mobile remote control for AI coding sessions via CDP mirroring.
 *
 * @module server
 */
import './env.js';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
    sendTelegramNotification,
    sendTypedNotification,
    sendActionRequired,
    sendSuggestionRequired,
    initTelegramBot,
    registerTelegramHooks,
    stopBot as stopTelegramBot
} from './utils/telegram.js';

import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import WebSocket from 'ws';

// ─── Module Imports ─────────────────────────────────────────────────
import {
    PROJECT_ROOT, PORTS, CONTAINER_IDS, SERVER_PORT, POLL_INTERVAL,
    APP_PASSWORD, COOKIE_SECRET, AUTH_SALT, AUTH_COOKIE_NAME, VERSION,
    JSON_BODY_LIMIT, AUTO_TUNNEL_PROVIDER, getDevMocksEnabled
} from './config.js';
import * as state from './state.js';
import { getLocalIP, isLocalRequest, getJson } from './utils/network.js';
import { killPortProcess, launchAntigravity } from './utils/process.js';
import { hashString } from './utils/hash.js';
import { discoverCDP, discoverAllCDP, connectCDP, initCDP } from './cdp/connection.js';
import { inspectUI } from './ui_inspector.js';
import { sessionStats } from './session-stats.js';
import { quotaService } from './quota-service.js';
import { screenshotTimeline } from './screenshot-timeline.js';
import {
    ensureWorkspaceData,
    getGitSummary,
    gitAdd,
    findLatestImplementationPlan,
    gitCommit,
    gitPush,
    listWorkspace,
    loadQuickCommands,
    readWorkspaceFile,
    saveQuickCommands,
    saveUploadedImage,
    saveUploadedAudio,
    terminalManager,
    workspaceRoot,
    uploadsDir
} from './utils/workspace.js';
import {
    aiSupervisor,
    suggestQueue,
    extractPendingCommand,
    detectPendingPromptFromHtml,
    evaluateCommandHeuristics
} from './supervisor.js';
import { CloudflareTunnelManager } from '../scripts/cloudflare-tunnel.js';
import { PinggyTunnelManager } from '../scripts/pinggy-tunnel.js';

// ─── Mutable State ──────────────────────────────────────────────────

/** @type {import('./state.js').CDPConnection | null} */
let cdpConnection = null;

/** @type {import('./state.js').Snapshot | null} */
let lastSnapshot = null;

/** @type {string | null} */
let lastSnapshotHash = null;

/** @type {any | null} */
let currentPendingAction = null;

/** @type {import('./state.js').CDPTarget[]} */
let availableTargets = [];

/** @type {string | null} */
let activeTargetId = null;

/** @type {string} */
let AUTH_TOKEN = 'ag_default_token';


/** @type {import('ws').WebSocketServer | null} */
let websocketServer = null;
/** @type {(() => void) | null} */
let suggestionQueueUnsubscribe = null;
/** @type {(() => void) | null} */
let sessionStatsUnsubscribe = null;
/** @type {(() => void) | null} */
let quotaServiceUnsubscribe = null;
/** @type {(() => void) | null} */
let timelineUnsubscribe = null;
const TELEGRAM_CONFIGURED = Boolean(
    process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID
);

const serverStartedAt = new Date().toISOString();
const MAX_SERVER_LOGS = 250;
/** @type {Array<{level: string, message: string, timestamp: string}>} */
const serverLogs = [];
const tunnelManagers = {
    cloudflare: new CloudflareTunnelManager(),
    pinggy: new PinggyTunnelManager()
};
let tunnelProvider = '';
const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
].join('; ');

/**
 * @param {string} [provider]
 */
function getTunnelManager(provider = tunnelProvider) {
    if (!provider) return null;
    return tunnelManagers[provider] || null;
}

/**
 * @param {string} [provider]
 */
function getTunnelStatus(provider = tunnelProvider) {
    const manager = getTunnelManager(provider);
    if (manager) {
        return manager.getStatus();
    }
    return {
        active: false,
        url: '',
        startedAt: '',
        error: '',
        logs: []
    };
}

function broadcastTunnelStatus() {
    broadcast({
        type: 'tunnel_status',
        status: {
            provider: tunnelProvider,
            ...getTunnelStatus()
        },
        timestamp: new Date().toISOString()
    });
}

/**
 * @param {string} provider
 * @returns {Promise<void>}
 */
async function stopOtherTunnels(provider) {
    const tasks = Object.entries(tunnelManagers)
        .filter(([name]) => name !== provider)
        .map(([, manager]) => manager.stop());
    await Promise.all(tasks);
}

/**
 * @param {string} provider
 * @param {number} port
 * @param {{tls?: boolean, sniServerName?: string}} [options]
 * @returns {Promise<string>}
 */
async function startTunnel(provider, port, options = {}) {
    const manager = getTunnelManager(provider);
    if (!manager) {
        throw new Error(`Unsupported tunnel provider: ${provider}`);
    }

    await stopOtherTunnels(provider);
    tunnelProvider = provider;
    return manager.start(port, options);
}

async function stopActiveTunnel() {
    const manager = getTunnelManager();
    if (!manager) return;
    await manager.stop();
}

const screenStreamState = {
    active: false,
    startedAt: '',
    lastFrameAt: '',
    /** @type {((params: any) => Promise<void>) | null} */
    listener: null
};

/**
 * @param {any} value
 * @returns {string}
 */
function serializeLogArg(value) {
    if (value instanceof Error) {
        return value.stack || value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

for (const level of /** @type {const} */ (['log', 'info', 'warn', 'error'])) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        serverLogs.push({
            level,
            message: args.map(serializeLogArg).join(' '),
            timestamp: new Date().toISOString()
        });
        if (serverLogs.length > MAX_SERVER_LOGS) {
            serverLogs.shift();
        }
        original(...args);
    };
}

/**
 * @param {number} [limit]
 * @returns {Array<{level: string, message: string, timestamp: string}>}
 */
function getServerLogs(limit = 80) {
    return serverLogs.slice(-Math.max(1, limit));
}

/**
 * Track delivered Telegram notifications only when Telegram is configured.
 * `sendTelegramNotification()` returns true when disabled, so we gate metrics here.
 *
 * @param {boolean} sent
 */
function trackTelegramNotification(sent) {
    if (sent && TELEGRAM_CONFIGURED) {
        sessionStats.increment('telegramNotificationsSent');
    }
}

function getSuggestionState() {
    return {
        suggestMode: aiSupervisor.isSuggestModeEnabled(),
        pendingCount: suggestQueue.getPendingCount(),
        suggestions: suggestQueue.getAll()
    };
}

function broadcastSuggestionState() {
    broadcast({
        type: 'suggestion_state',
        ...getSuggestionState(),
        timestamp: new Date().toISOString()
    });
}

function getStatsState() {
    return {
        ...sessionStats.getSummary(),
        pendingSuggestions: suggestQueue.getPendingCount()
    };
}

function broadcastStatsState() {
    broadcast({
        type: 'stats_state',
        stats: getStatsState(),
        timestamp: new Date().toISOString()
    });
}

function getQuotaState() {
    return quotaService.getSummary();
}

function broadcastQuotaState() {
    broadcast({
        type: 'quota_state',
        quota: getQuotaState(),
        timestamp: new Date().toISOString()
    });
}

function getTimelineState() {
    return screenshotTimeline.getSummary();
}

function broadcastTimelineState() {
    broadcast({
        type: 'timeline_state',
        timeline: getTimelineState(),
        timestamp: new Date().toISOString()
    });
}

function getAssistContext() {
    return {
        stats: getStatsState(),
        quota: getQuotaState(),
        pendingSuggestions: suggestQueue.getPendingCount(),
        suggestions: suggestQueue.getPending().slice(0, 3)
    };
}

function getLatestPendingSuggestion() {
    return suggestQueue.getPending()[0] || null;
}

async function captureCurrentScreenshot({ format = 'jpeg', quality = 70 } = {}) {
    if (!cdpConnection) {
        return { success: false, error: 'CDP disconnected' };
    }

    try {
        /** @type {any} */
        const params = { format };
        if (format !== 'png') {
            params.quality = quality;
        }

        const result = await cdpConnection.call('Page.captureScreenshot', params);
        return {
            success: true,
            data: result.data,
            mimeType: format === 'png' ? 'image/png' : 'image/jpeg'
        };
    } catch (e) { const error = /** @type {Error} */ (e);
        return {
            success: false,
            error: error.message
        };
    }
}

/** @param {string} id */
async function approveQueuedSuggestion(id) {
    const suggestion = suggestQueue.find(id);
    if (!suggestion) {
        return { success: false, error: 'Suggestion not found' };
    }

    if (suggestion.status !== 'pending') {
        return { success: false, error: `Suggestion already ${suggestion.status}` };
    }

    if (!cdpConnection) {
        return { success: false, error: 'CDP disconnected' };
    }

    const executed = await completePendingAction(cdpConnection, suggestion.action);
    if (!executed.success) {
        return {
            success: false,
            error: executed.error || 'Failed to execute suggested action',
            executed
        };
    }

    const approved = suggestQueue.approve(id);
    if (suggestion.action === 'accept') {
        sessionStats.increment('actionsApproved');
    } else {
        sessionStats.increment('actionsRejected');
    }
    sessionStats.logAction('suggestion_executed', {
        id,
        action: suggestion.action
    });
    return {
        success: true,
        suggestion: approved,
        executed
    };
}

/** @param {string} id */
function rejectQueuedSuggestion(id) {
    const suggestion = suggestQueue.find(id);
    if (!suggestion) {
        return { success: false, error: 'Suggestion not found' };
    }

    if (suggestion.status !== 'pending') {
        return { success: false, error: `Suggestion already ${suggestion.status}` };
    }

    const rejected = suggestQueue.reject(id);
    sessionStats.logAction('suggestion_rejected_by_user', { id });
    return {
        success: true,
        suggestion: rejected
    };
}

/**
 * Broadcast a JSON payload to connected mobile clients.
 *
 * @param {object} payload
 * @returns {void}
 */
function broadcast(payload) {
    if (!websocketServer) return;
    const serialized = JSON.stringify(payload);
    websocketServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(serialized);
        }
    });
}

/**
 * @returns {number}
 */
function getOpenClientCount() {
    if (!websocketServer) return 0;
    let count = 0;
    websocketServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) count++;
    });
    return count;
}

/**
 * @returns {{active: boolean, startedAt: string, lastFrameAt: string}}
 */
function getScreencastStatus() {
    return {
        active: screenStreamState.active,
        startedAt: screenStreamState.startedAt,
        lastFrameAt: screenStreamState.lastFrameAt
    };
}

/**
 * @returns {Promise<void>}
 */
async function stopScreencast() {
    const wasActive = screenStreamState.active;
    if (cdpConnection && screenStreamState.active) {
        try {
            if (screenStreamState.listener) {
                cdpConnection.off('Page.screencastFrame', screenStreamState.listener);
            }
            await cdpConnection.call('Page.stopScreencast', {});
        } catch (_) {
            // Ignore stop errors during reconnect or target switches.
        }
    }

    screenStreamState.active = false;
    screenStreamState.startedAt = '';
    screenStreamState.lastFrameAt = '';
    screenStreamState.listener = null;
    if (wasActive) {
        sessionStats.increment('screenStreamsStopped');
        sessionStats.logAction('screencast_stopped');
    }
    broadcast({ type: 'screen_status', status: getScreencastStatus() });
}

/**
 * @returns {Promise<{active: boolean, startedAt: string, lastFrameAt: string}>}
 */
async function startScreencast() {
    if (!cdpConnection) {
        throw new Error('CDP disconnected');
    }

    if (screenStreamState.active) {
        return getScreencastStatus();
    }

    await cdpConnection.call('Page.enable', {});

    screenStreamState.listener = async (params) => {
        screenStreamState.lastFrameAt = new Date().toISOString();
        broadcast({
            type: 'screen_frame',
            data: params.data,
            format: 'image/jpeg',
            timestamp: screenStreamState.lastFrameAt
        });
        try {
            await cdpConnection?.call('Page.screencastFrameAck', { sessionId: params.sessionId });
        } catch (_) {
            // Ignore acknowledgements during reconnect.
        }
    };

    cdpConnection.on('Page.screencastFrame', screenStreamState.listener);
    await cdpConnection.call('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1280,
        maxHeight: 900,
        everyNthFrame: 1
    });

    screenStreamState.active = true;
    screenStreamState.startedAt = new Date().toISOString();
    screenStreamState.lastFrameAt = '';
    sessionStats.increment('screenStreamsStarted');
    sessionStats.logAction('screencast_started');
    broadcast({ type: 'screen_status', status: getScreencastStatus() });
    return getScreencastStatus();
}

/**
 * @returns {Promise<void>}
 */
async function maybeStartAutoTunnel(options = {}) {
    const provider = AUTO_TUNNEL_PROVIDER;
    const manager = getTunnelManager(provider);
    if (!manager) return;
    if (manager.getStatus().active) return;

    try {
        const url = await startTunnel(provider, Number(SERVER_PORT), options);
        console.log(`☁️ ${provider} tunnel ready: ${url}`);
    } catch (e) { const error = /** @type {Error} */ (e);
        console.warn(`⚠️ ${provider} tunnel failed: ${error.message}`);
    }
}

// ─── CDP Action Functions ───────────────────────────────────────────
// These functions contain large template-literal scripts injected into
// the browser via CDP Runtime.evaluate. They stay in this file because
// the template strings reference interpolated variables from their
// closure scope, making extraction fragile.

// (connectCDP moved to src/cdp/connection.js)

/**
 * Capture the current chat DOM as an HTML snapshot with CSS styles.
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<import('./state.js').Snapshot | null>}
 */
/**
 * Scan all CDP contexts for full-page error/modal dialogs that exist OUTSIDE
 * the main chat container (e.g. quota reached, agent terminated, rate limit).
 * Inspired by tody-agent/AntigravityMobile chat-stream.mjs:checkErrorDialogs.
 *
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<{error: string, type: string} | null>}
 */
async function checkErrorDialogs(cdp) {
    const DIALOG_SCRIPT = `(function() {
        try {
            const dialogs = document.querySelectorAll(
                '[role="dialog"], .dialog-shadow, .monaco-dialog-box, ' +
                '[class*="dialog"], [class*="notification-toast"], ' +
                '[class*="error-widget"], .notifications-toasts'
            );
            for (const d of dialogs) {
                if (d.offsetParent === null && !d.closest('[class*="toast"]')) continue;
                const text = (d.innerText || '').toLowerCase();
                const len = text.length;
                if (len < 5 || len > 2000) continue;

                if (text.includes('terminated due to error') || text.includes('agent terminated')) {
                    return { error: 'Agent terminated due to error', type: 'terminated' };
                }
                if (text.includes('model quota reached') || text.includes('quota exhausted') || text.includes('usage limit')) {
                    return { error: 'Model quota reached', type: 'quota' };
                }
                if (text.includes('rate limit') || text.includes('too many requests') || text.includes('rate_limit_error')) {
                    return { error: 'Rate limit exceeded', type: 'rate_limit' };
                }
                if (text.includes('high traffic') || text.includes('overloaded')) {
                    return { error: 'High traffic / server overloaded', type: 'high_traffic' };
                }
                if (text.includes('internal server error') || text.includes('something went wrong')) {
                    return { error: 'Internal server error', type: 'server_error' };
                }
                if (text.includes('network error') || text.includes('connection lost')) {
                    return { error: 'Network error / connection lost', type: 'network_error' };
                }
            }
            return null;
        } catch(e) { return null; }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: DIALOG_SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { /* context may be gone */ }
    }
    return null;
}

/** @type {Map<string, string|null>} */
const localIconCache = new Map();

/**
 * Replace local file paths in img src tags with base64 data URIs.
 * This guarantees local icon files (e.g. Antigravity file icons) render properly on remote/mobile clients.
 * @param {string} html
 * @returns {string}
 */
function inlineLocalSnapshotImages(html) {
    if (!html || typeof html !== 'string') return html;

    return html.replace(/<img([^>]+)src=["']([^"']+)["']([^>]*)>/gi, (match, prefix, src, suffix) => {
        if (!src || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
            return match;
        }

        let filePath = src;
        if (filePath.startsWith('file://')) {
            try {
                filePath = fileURLToPath(filePath);
            } catch {
                filePath = filePath.replace(/^file:\/\//, '');
            }
        }
        filePath = decodeURIComponent(filePath);

        if (localIconCache.has(filePath)) {
            const cached = localIconCache.get(filePath);
            if (!cached) return match;
            return `<img${prefix}src="${cached}"${suffix}>`;
        }

        try {
            if (fs.existsSync(filePath)) {
                const ext = filePath.split('.').pop()?.toLowerCase() || '';
                let mime = 'application/octet-stream';
                if (ext === 'svg') mime = 'image/svg+xml';
                else if (ext === 'png') mime = 'image/png';
                else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
                else if (ext === 'gif') mime = 'image/gif';
                else if (ext === 'webp') mime = 'image/webp';

                const buf = fs.readFileSync(filePath);
                const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
                if (localIconCache.size > 200) localIconCache.clear();
                localIconCache.set(filePath, dataUri);
                return `<img${prefix}src="${dataUri}"${suffix}>`;
            }
        } catch (_) {}

        localIconCache.set(filePath, null);
        return match;
    });
}

async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        const INTERACTIVE_TEXT_PATTERNS = [
            /^thought/i,
            /^thinking/i,
            /^run$/i,
            /^reject$/i,
            /^accept$/i,
            /^allow$/i,
            /^deny$/i,
            /^review changes$/i,
            /^files with changes$/i,
            /^continue$/i,
            /^cancel$/i,
            /^retry$/i,
            /^show more$/i,
            /^show less$/i,
            /^expand$/i,
            /^collapse$/i,
            /^copy$/i
        ];
        const normalizeText = (value) => (value || '').split('\\n')[0].replace(/\\s+/g, ' ').trim();
        const isInteractiveCandidate = (el) => {
            if (typeof el.matches === 'function' && (
                el.matches('label[for^="ask-opt-"], label, [data-testid^="interaction-"], [role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]')
            )) {
                return true;
            }
            if (typeof el.closest === 'function' && (
                el.closest('label[for^="ask-opt-"], button[data-testid^="interaction-"]')
            )) {
                return true;
            }
            const text = normalizeText(el.textContent || el.innerText || '');
            if (!text || text.length > 120) return false;
            if (['BUTTON', 'A', 'SUMMARY'].includes(el.tagName)) return true;
            if (el.getAttribute('role') === 'button') return true;
            if (el.children.length > 0) return false;
            return INTERACTIVE_TEXT_PATTERNS.some((pattern) => pattern.test(text));
        };

        // Smart container detection: try multiple IDs with fallback chain
        const CONTAINER_IDS = ['cascade', 'conversation', 'chat'];
        let cascade = null;
        for (const id of CONTAINER_IDS) {
            cascade = document.getElementById(id);
            if (cascade) break;
        }
        if (!cascade) {
            // Debug info
            const body = document.body;
            const childIds = Array.from(body.children).map(c => c.id).filter(id => id).join(', ');
            return { error: 'chat container not found', debug: { hasBody: !!body, availableIds: childIds } };
        }
        
        const cascadeStyles = window.getComputedStyle(cascade);
        
        // Find the main scrollable container
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };
        
        // Clone cascade to modify it without affecting the original
        const clone = cascade.cloneNode(true);

        // Synchronize live interactive selection states (radio/checkboxes/options) into clone
        try {
            const origInputs = cascade.querySelectorAll('input[type="radio"], input[type="checkbox"]');
            origInputs.forEach(orig => {
                const isChecked = !!orig.checked;
                let targetInput = null;
                if (orig.id) {
                    try { targetInput = clone.querySelector('#' + CSS.escape(orig.id)); } catch (_) {}
                }
                if (!targetInput && orig.name && orig.value) {
                    try { targetInput = clone.querySelector('input[name="' + CSS.escape(orig.name) + '"][value="' + CSS.escape(orig.value) + '"]'); } catch (_) {}
                }
                if (targetInput) {
                    if (isChecked) {
                        targetInput.setAttribute('checked', '');
                        const targetLabel = targetInput.closest('label') || (targetInput.id ? clone.querySelector('label[for="' + CSS.escape(targetInput.id) + '"]') : null);
                        if (targetLabel) {
                            targetLabel.setAttribute('data-checked', 'true');
                            targetLabel.classList.add('omni-selected');
                        }
                    } else {
                        targetInput.removeAttribute('checked');
                        const targetLabel = targetInput.closest('label') || (targetInput.id ? clone.querySelector('label[for="' + CSS.escape(targetInput.id) + '"]') : null);
                        if (targetLabel) {
                            targetLabel.removeAttribute('data-checked');
                            targetLabel.classList.remove('omni-selected');
                        }
                    }
                }
            });

            // Also check Antigravity's native label selection classes (bg-secondary vs hover:bg-secondary)
            const origLabels = cascade.querySelectorAll('label[for^="ask-opt-"]');
            origLabels.forEach(origLabel => {
                const forId = origLabel.getAttribute('for');
                if (!forId) return;
                let targetLabel = null;
                try { targetLabel = clone.querySelector('label[for="' + CSS.escape(forId) + '"]'); } catch (_) {}
                if (!targetLabel) return;
                const isSelectedClass = origLabel.classList.contains('bg-secondary') && !origLabel.classList.contains('hover:bg-secondary');
                if (isSelectedClass) {
                    targetLabel.setAttribute('data-checked', 'true');
                    targetLabel.classList.add('omni-selected');
                    targetLabel.querySelector('input')?.setAttribute('checked', '');
                }
            });
        } catch (_) {}

        const wrapper = document.createElement('div');
        wrapper.appendChild(clone);
        
        // Append floating dialogs/modals that are outside the cascade
        try {
            const dialogs = document.querySelectorAll(
                '[role="dialog"], .dialog-shadow, .monaco-dialog-box, ' +
                '[class*="dialog"], [class*="notification-toast"], ' +
                '[class*="error-widget"], .notifications-toasts, ' +
                '.monaco-menu-container, [class*="context-view"]'
            );
            
            const addedDialogs = new Set();
            dialogs.forEach(d => {
                if (cascade.contains(d)) return;
                if (d.offsetParent === null && !d.closest('[class*="toast"]')) return;
                if (addedDialogs.has(d) || Array.from(addedDialogs).some(parent => parent.contains(d))) return;
                
                const dClone = d.cloneNode(true);
                dClone.style.position = 'fixed';
                dClone.style.zIndex = '9999';
                wrapper.appendChild(dClone);
                addedDialogs.add(d);
            });
        } catch (e) {}
        
        // Aggressively remove the entire interaction/input/review area
        try {
            // 1. Identify common interaction wrappers by class combinations
            const interactionSelectors = [
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '.p-1.bg-gray-500\\/10',
                '.outline-solid.justify-between',
                '[contenteditable="true"]'
            ];

            interactionSelectors.forEach(selector => {
                wrapper.querySelectorAll(selector).forEach(el => {
                    try {
                        // Never remove an active interaction question or action prompt
                        if (el.querySelector?.('[data-testid="interaction-continue-button"], [data-testid="interaction-skip-button"]') ||
                            (typeof el.getAttribute === 'function' && el.getAttribute('data-testid')?.startsWith('interaction-'))) {
                            return;
                        }

                        // For the editor, we want to remove its interaction container
                        if (selector === '[contenteditable="true"]') {
                            const area = el.closest('.relative.flex.flex-col.gap-8') || 
                                         el.closest('.flex.grow.flex-col.justify-start.gap-8') ||
                                         el.closest('div[id^="interaction"]') ||
                                         el.parentElement?.parentElement;
                            if (area && !area.querySelector?.('[data-testid="interaction-continue-button"]') && area !== wrapper && area !== clone) {
                                area.remove();
                            } else {
                                el.remove();
                            }
                        } else {
                            el.remove();
                        }
                    } catch(e) {}
                });
            });

            // 2. Text-based cleanup for stray status bars
            const allElements = wrapper.querySelectorAll('*');
            allElements.forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('review changes') || text.includes('files with changes') || text.includes('context found')) {
                        if (el.children.length < 10 || el.querySelector('button') || el.classList?.contains('justify-between')) {
                            el.style.display = 'none';
                            el.remove();
                        }
                    }
                } catch (e) {}
            });

            // 3. Base64 image conversion — convert local SVGs/images to data URIs
            //    This prevents broken images when accessing via ngrok/remote
            wrapper.querySelectorAll('img[src], svg').forEach(el => {
                try {
                    if (el.tagName === 'SVG') {
                        const svgData = new XMLSerializer().serializeToString(el);
                        const img = document.createElement('img');
                        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
                        img.style.cssText = el.style.cssText || '';
                        img.width = el.getAttribute('width') || el.clientWidth || 16;
                        img.height = el.getAttribute('height') || el.clientHeight || 16;
                        img.className = el.className?.baseVal || '';
                        el.replaceWith(img);
                    } else if (el.src && !el.src.startsWith('data:') && !el.src.startsWith('http')) {
                        // Local file references — try canvas conversion
                        try {
                            const canvas = document.createElement('canvas');
                            canvas.width = el.naturalWidth || el.width || 16;
                            canvas.height = el.naturalHeight || el.height || 16;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(el, 0, 0);
                            el.src = canvas.toDataURL('image/png');
                        } catch(canvasErr) {}
                    }
                } catch(imgErr) {}
            });

            const textGroups = new Map();
            Array.from(wrapper.querySelectorAll('button, [role="button"], a, summary, label, input, span, div, p')).forEach(el => {
                try {
                    if (!isInteractiveCandidate(el)) return;
                    const text = normalizeText(el.textContent || el.innerText || '');
                    if (!textGroups.has(text)) {
                        textGroups.set(text, []);
                    }
                    textGroups.get(text).push(el);
                } catch (_) {}
            });

            textGroups.forEach((elements, text) => {
                elements.forEach((el, idx) => {
                    el.setAttribute('data-omni-text', text);
                    el.setAttribute('data-omni-idx', String(idx));
                    el.setAttribute('data-omni-total', String(elements.length));
                });
            });
        } catch (globalErr) { }
        
        const html = wrapper.innerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    rules.push(rule.cssText);
                }
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');

        let agentActivity = '';
        let isGenerating = false;
        try {
            // Check for cancel/stop button in Antigravity IDE
            const cancelBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
                              document.querySelector('button[aria-label*="Cancel"], button[aria-label*="Stop"]') ||
                              document.querySelector('button svg.lucide-square')?.closest('button');
            if (cancelBtn && (cancelBtn.offsetParent !== null || cancelBtn.getClientRects().length > 0)) {
                isGenerating = true;
            }

            // Also check Preact side panel isRunning state
            const root = document.querySelector('.antigravity-agent-side-panel');
            if (root && root.__k) {
                function checkRunning(vn) {
                    if (!vn || isGenerating) return;
                    if (vn.__c && vn.__c.props?.isRunning) {
                        isGenerating = true;
                        return;
                    }
                    if (Array.isArray(vn.__k)) vn.__k.forEach(checkRunning);
                }
                checkRunning(root.__k);
            }

            let agentActivity = 'Idle';

            const loadingEl = document.querySelector('[data-testid="agent-loading"]') ||
                              document.querySelector('[class*="agent-loading"]') ||
                              document.querySelector('[aria-label*="Thinking"]') ||
                              document.querySelector('.monaco-progress-container.active');
            if (loadingEl && (loadingEl.offsetParent !== null || loadingEl.getClientRects().length > 0)) {
                const txt = (loadingEl.textContent || loadingEl.innerText || '').trim();
                if (txt && !txt.toLowerCase().startsWith('worked for')) {
                    agentActivity = txt;
                    isGenerating = true;
                }
            }

            if (!isGenerating) {
                const spinner = document.querySelector('.codicon-loading, .progress-item, [class*="spinner"]');
                if (spinner && (spinner.offsetParent !== null || spinner.getClientRects().length > 0)) {
                    isGenerating = true;
                    agentActivity = 'Working...';
                }
            }

            if (isGenerating && (!agentActivity || agentActivity === 'Idle')) {
                agentActivity = 'Working...';
            }

            if (!isGenerating) {
                agentActivity = 'Idle';
            }
            let agentError = null;
            let quotaWarning = null;
            try {
                const errEl = document.querySelector('[data-testid="error-banner"], .agent-error-callout, .notification-toast-error, .monaco-alert.error, [class*="error-widget"]');
                if (errEl && (errEl.offsetParent !== null || errEl.getClientRects().length > 0)) {
                    agentError = (errEl.textContent || '').trim();
                }
                const quotaEl = document.querySelector('[data-testid="quota-warning"], [class*="quota-banner"]');
                if (quotaEl && (quotaEl.offsetParent !== null || quotaEl.getClientRects().length > 0)) {
                    quotaWarning = (quotaEl.textContent || '').trim();
                }
            } catch (_) {}
        } catch (actErr) {}

        return {
            html: html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo: scrollInfo,
            agentActivity: agentActivity || (isGenerating ? 'Working...' : 'Idle'),
            isGenerating: isGenerating,
            agentError: typeof agentError !== 'undefined' ? agentError : null,
            quotaWarning: typeof quotaWarning !== 'undefined' ? quotaWarning : null,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length
            }
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            // console.log(`Trying context ${ctx.id} (${ctx.name || ctx.origin})...`);
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });

            if (result.exceptionDetails) {
                // console.log(`Context ${ctx.id} exception:`, result.exceptionDetails);
                continue;
            }

            if (result.result && result.result.value) {
                const val = result.result.value;
                if (val.error) {
                    // console.log(`Context ${ctx.id} script error:`, val.error);
                    // if (val.debug) console.log(`   Debug info:`, JSON.stringify(val.debug));
                } else {
                    if (val.html) {
                        val.html = inlineLocalSnapshotImages(val.html);
                    }
                    return val;
                }
            }
        } catch (e) {
            console.log(`Context ${ctx.id} connection error:`, e.message);
        }
    }

    return null;
}

/**
 * Inject a message into the Antigravity chat editor and submit it.
 * Supports Lexical editor (Gemini-based Antigravity), DOM staging verification,
 * and busy checking.
 * Credit: Kelvin Tan (@kelverssg) for Gemini Lexical selectors, staging checks, and busy check.
 *
 * @param {import('./state.js').CDPConnection} cdp
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.checkBusy=false]
 * @returns {Promise<{ok: boolean, method?: string, reason?: string, error?: string, domStatus?: string, queued?: boolean}>}
 */
export async function injectMessage(cdp, text, { checkBusy = false } = {}) {
    // Use JSON.stringify for robust escaping (handles ", \, newlines, backticks, unicode, etc.)
    const safeText = JSON.stringify(text);

    const EXPRESSION = `(async () => {
        // Busy check — stop/cancel button visible (VS Code era + Gemini era)
        // Credit: Kelvin Tan (@kelverssg)
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]')
                    || document.querySelector('button[aria-label="Stop"]')
                    || document.querySelector('button[aria-label="Cancel"]');
        if (${checkBusy} && cancel && cancel.offsetParent !== null) {
            return { ok: false, reason: "busy", domStatus: "editor-found" };
        }

        // Editor: Gemini Antigravity (Lexical) → VS Code fallback
        // Credit: Kelvin Tan (@kelverssg)
        const editor = document.querySelector('[data-lexical-editor="true"][contenteditable="true"]')
                    || document.querySelector('[aria-label="Message input"]')
                    || [...document.querySelectorAll('#conversation [contenteditable="true"], #chat [contenteditable="true"], #cascade [contenteditable="true"], [contenteditable="true"][data-lexical-editor="true"], [contenteditable="true"]')]
                        .filter(el => el.offsetParent !== null).at(-1);
        if (!editor) return { ok: false, error: "editor_not_found", domStatus: "attempted" };

        const textToInsert = ${safeText};

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);

        let inserted = false;
        try { inserted = !!document.execCommand?.("insertText", false, textToInsert); } catch {}
        if (!inserted) {
            editor.textContent = textToInsert;
            editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: textToInsert, composed: true }));
            editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: textToInsert, composed: true }));
        }

        // Wait for Lexical / Preact to register input state
        await new Promise(r => setTimeout(r, 120));

        // Staging check (Lexical input boundary verification)
        // Credit: Kelvin Tan (@kelverssg)
        const editorText = editor.innerText || editor.textContent || "";
        const normalizeForStaging = value => value.replace(/[\s\\\x60]/g, '');
        const actual = normalizeForStaging(editorText);
        const expected = normalizeForStaging(textToInsert);
        const minExpected = Math.floor(expected.length * 0.85);
        const head = expected.slice(0, Math.min(80, expected.length));
        const tail = expected.slice(Math.max(0, expected.length - 80));
        const staged = expected.length === 0
            || actual.includes(expected)
            || (actual.length >= minExpected && actual.includes(head) && actual.includes(tail));
        if (!staged) {
            return { ok: false, error: "staging_failed", domStatus: "editor_found_unverified" };
        }

        // Priority 1: Gemini Antigravity "Send message" button inside side panel
        // Credit: Kelvin Tan (@kelverssg)
        const box = document.getElementById('antigravity.agentSidePanelInputBox');
        const geminiSendBtn = (box ? [...box.querySelectorAll('button')] : [...document.querySelectorAll('button')])
            .find(b => b.getAttribute('aria-label') === 'Send message');
        if (geminiSendBtn && !geminiSendBtn.disabled && (geminiSendBtn.offsetParent !== null || geminiSendBtn.getClientRects().length > 0)) {
            geminiSendBtn.click();
            return { ok: true, domStatus: "verified-present", method: "click_send" };
        }

        // Priority 2: Standard DOM send/queue button
        const submit = document.querySelector(
            'button[data-testid="send-button"], ' +
            'button[data-testid="queue-button"], ' +
            '[data-tooltip-id="input-send-button-send-tooltip"], ' +
            '[data-tooltip-id="input-send-button-queue-tooltip"], ' +
            'button[aria-label="Send message"], ' +
            'button[aria-label="Queue message"], ' +
            'button[aria-label*="Send"], ' +
            'button[aria-label*="Queue"], ' +
            'svg.lucide-arrow-right, ' +
            'svg[data-icon="arrow_forward"]'
        )?.closest('button') || document.querySelector('button[data-testid="send-button"]');

        if (submit && !submit.disabled && (submit.offsetParent !== null || submit.getClientRects().length > 0)) {
            submit.click();
            await new Promise(r => setTimeout(r, 60));
            try {
                editor.focus();
                document.execCommand?.("selectAll", false, null);
                document.execCommand?.("delete", false, null);
            } catch (_) {}
            return { ok: true, domStatus: "verified-present", method: "click_submit" };
        }

        // Priority 3: Trigger Enter key (submits when idle, queues when agent is working)
        const isCancelVisible = !!(
            document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
            document.querySelector('button[aria-label="Stop"]') ||
            document.querySelector('button[aria-label="Cancel"]')
        );
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
        editor.dispatchEvent(new KeyboardEvent("keypress", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
        editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
        
        return { ok: true, domStatus: "verified-present", method: "enter_keypress", queued: isCancelVisible };
    })()`;

    // Target the main (default) execution context first and exclusively for DOM submissions
    const defaultCtx = cdp.contexts?.find(c => c.auxData?.isDefault) || cdp.contexts?.[0];
    if (defaultCtx) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: defaultCtx.id,
                timeout: 5000
            });

            if (result.result && result.result.value) {
                const val = result.result.value;
                // If Enter was dispatched via DOM, also ensure hardware-level Enter key event via CDP
                if (val.method === "enter_keypress") {
                    try {
                        await cdp.call("Input.dispatchKeyEvent", {
                            type: "rawKeyDown",
                            key: "Enter",
                            code: "Enter",
                            windowsVirtualKeyCode: 13,
                            nativeVirtualKeyCode: 13,
                            unmodifiedText: "\r",
                            text: "\r"
                        });
                        await cdp.call("Input.dispatchKeyEvent", {
                            type: "keyUp",
                            key: "Enter",
                            code: "Enter",
                            windowsVirtualKeyCode: 13,
                            nativeVirtualKeyCode: 13
                        });
                    } catch (_) {}
                }
                return val;
            }
        } catch (e) {
            console.warn("[InjectMessage] Default context evaluate failed:", e.message);
        }
    }

    // Fallback: evaluate in remaining execution contexts
    for (const ctx of (cdp.contexts || [])) {
        if (ctx.id === defaultCtx?.id) continue;
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id,
                timeout: 5000
            });
            if (result.result?.value) return result.result.value;
        } catch {}
    }

    return { ok: false, reason: "no_context", domStatus: "attempted" };
}

/**
 * Method 2: Scan all open tabs across configured CDP ports to find and inject into active chat.
 * Credit: Kelvin Tan (@kelverssg)
 *
 * @param {string} text
 * @param {object} [options]
 * @returns {Promise<{ok: boolean, method?: string, reason?: string, error?: string, tab?: string, method2?: boolean, domStatus?: string}>}
 */
export async function injectMessageAnyTab(text, options = {}) {
    let lastResult = { ok: false, error: 'editor_not_found_all_tabs', domStatus: 'attempted' };
    for (const port of PORTS) {
        let list;
        try { list = await getJson(`http://127.0.0.1:${port}/json/list`); } catch { continue; }
        for (const tab of list) {
            if (!tab.webSocketDebuggerUrl) continue;
            let conn;
            try { conn = await connectCDP(tab.webSocketDebuggerUrl); } catch { continue; }
            try {
                const result = await injectMessage(conn, text, options);
                conn.ws.close();
                lastResult = { ...result, tab: tab.title || tab.id, method2: true };
                if (result.ok !== false) return lastResult;
            } catch {
                conn.ws.close();
            }
        }
    }
    return lastResult;
}

// ── Concurrency Serialization & Deduplication ─────────────────────
// Credit: Kelvin Tan (@kelverssg)
// Serializes /send requests through an atomic promise chain to prevent
// concurrent requests from destructively interleaving in the shared DOM editor.
// Also provides 120s duplicate suppression and busy backoff.
export const SEND_DEDUPE_MS = 120_000;
export const SEND_BACKOFF_MS = [1000, 2000, 4000];
export const recentSends = new Map(); // hash -> ts of last SUCCESSFUL injection

export function sendHash(s) {
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export function isRecentDuplicate(hash) {
    const now = Date.now();
    for (const [k, ts] of recentSends) {
        if (now - ts > SEND_DEDUPE_MS) recentSends.delete(k);
    }
    return recentSends.has(hash);
}

let sendLock = Promise.resolve();
export function withSendLock(fn) {
    const run = sendLock.then(fn, fn);
    sendLock = run.then(() => {}, () => {}); // a rejection must never poison the chain
    return run.catch(err => ({ threw: err }));
}

/**
 * Set the functionality mode (Fast vs Planning).
 * @param {import('./state.js').CDPConnection} cdp
 * @param {'Fast' | 'Planning'} mode
 * @returns {Promise<{success?: boolean, alreadySet?: boolean, error?: string}>}
 */
async function setMode(cdp, mode) {
    if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };

    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the current mode indicator.
            // It will have text 'Fast' or 'Planning'.
            // It might not be a <button>, could be a <div> with cursor-pointer.
            
            // 1. Get all elements with text 'Fast' or 'Planning'
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                // Must have single text node child to avoid parents
                if (el.children.length > 0) return false;
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });

            // 2. Find the one that looks interactive (cursor-pointer)
            // Traverse up from text node to find clickable container
            let modeBtn = null;
            
            for (const el of candidates) {
                let current = el;
                // Go up max 4 levels
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                        modeBtn = current;
                        break;
                    }
                    current = current.parentElement;
                }
                if (modeBtn) break;
            }

            if (!modeBtn) return { error: 'Mode indicator/button not found' };

            // Check if already set
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };

            // 3. Click to open menu
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 4. Find the dialog
            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            
            // Fallback: Just look for any new visible container if role=dialog is missing
            if (!visibleDialog) {
                // Maybe it's not role=dialog? Look for a popover-like div
                 visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText.includes('${mode}') &&
                               !d.innerText.includes('Files With Changes'); // Anti-context menu
                    });
            }

            if (!visibleDialog) return { error: 'Dropdown not opened or options not visible' };

            // 5. Click the option
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${mode}'
            );

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }
            
            return { error: 'Mode option text not found in dialog. Dialog text: ' + visibleDialog.innerText.substring(0, 50) };

        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

/**
 * Stop the current AI generation.
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<{success?: boolean, method?: string, error?: string}>}
 */
async function stopGeneration(cdp) {
    const EXP = `(async () => {
        // Priority 1: Native Preact component cancelInvocation
        try {
            const root = document.querySelector(".antigravity-agent-side-panel");
            if (root && root.__k) {
                let xmu = null;
                function walk(vn) {
                    if (!vn || xmu) return;
                    if (vn.__c && typeof vn.__c.props?.cancelInvocation === 'function') {
                        xmu = vn.__c;
                        return;
                    }
                    if (Array.isArray(vn.__k)) vn.__k.forEach(walk);
                }
                walk(root.__k);
                if (xmu && typeof xmu.props.cancelInvocation === 'function') {
                    await xmu.props.cancelInvocation();
                    return { success: true, method: 'preact_cancel' };
                }
            }
        } catch (_) {}

        // Priority 2: Look for the cancel button
        const cancel = document.querySelector(
            '[data-tooltip-id="input-send-button-cancel-tooltip"], ' +
            'button[aria-label*="Cancel"], ' +
            'button[aria-label*="Stop"]'
        );
        if (cancel && (cancel.offsetParent !== null || cancel.getClientRects().length > 0)) {
            cancel.click();
            return { success: true, method: 'click_cancel' };
        }
        
        // Priority 3: Look for a square icon in the send button area
        const stopBtn = document.querySelector('button svg.lucide-square, button svg.codicon-stop')?.closest('button');
        if (stopBtn && (stopBtn.offsetParent !== null || stopBtn.getClientRects().length > 0)) {
            stopBtn.click();
            return { success: true, method: 'fallback_square' };
        }

        return { error: 'No active generation found to stop' };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

/**
 * Click a DOM element via deterministic targeting with occurrence index.
 * @param {import('./state.js').CDPConnection} cdp
 * @param {{selector?: string, index?: number, textContent?: string, omniIndex?: number}} params
 * @returns {Promise<{success?: boolean, matchCount?: number, index?: number, omniIndex?: number, error?: string}>}
 */
async function clickElement(cdp, { selector, index = 0, textContent, omniIndex }) {
    const safeSelector = JSON.stringify(selector || '*');
    const safeTextContent = textContent ? JSON.stringify(textContent) : 'null';
    const safeIndex = Number.isFinite(index) ? index : 0;
    const safeOmniIndex = Number.isFinite(omniIndex) ? omniIndex : -1;
    const EXP = `(async () => {
        try {
            const selector = ${safeSelector};
            const searchText = ${safeTextContent};
            const explicitIndex = ${safeIndex};
            const omniIndex = ${safeOmniIndex};
            const normalizeText = (value) => (value || '').split('\\n')[0].replace(/\\s+/g, ' ').trim();
            const isVisible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length > 0));
            const matchesSearchText = (el) => {
                if (!searchText) return true;
                const exact = normalizeText(el.textContent || el.innerText || '');
                if (exact === searchText) return true;
                const fullText = (el.textContent || el.innerText || '').trim();
                return fullText.includes(searchText);
            };
            const isClickable = (el) => {
                if (!el) return false;
                if (['BUTTON', 'A', 'SUMMARY', 'LABEL', 'INPUT'].includes(el.tagName)) return true;
                if (['button', 'radio', 'checkbox'].includes(el.getAttribute('role'))) return true;
                if (typeof el.onclick === 'function') return true;
                const style = window.getComputedStyle(el);
                return style.cursor === 'pointer';
            };
            const findClickableTarget = (el) => {
                let current = el;
                for (let i = 0; current && i < 6; i += 1) {
                    if (isClickable(current)) return current;
                    current = current.parentElement;
                }
                return el;
            };
            
            const CONTAINER_IDS = ['cascade', 'conversation', 'chat'];
            let scope = null;
            for (const id of CONTAINER_IDS) {
                scope = document.getElementById(id);
                if (scope) break;
            }
            if (!scope) scope = document.body;
            
            let elements = [];
            try {
                elements = Array.from(scope.querySelectorAll(selector));
            } catch (_) {
                elements = Array.from(scope.querySelectorAll('*'));
            }
            elements = elements.filter(isVisible);
            
            if (searchText) {
                elements = elements.filter(matchesSearchText);
            }

            if (elements.length === 0 && searchText) {
                elements = Array.from(
                    scope.querySelectorAll('label, input, button, [role="button"], a, summary, span, div, p')
                )
                    .filter(isVisible)
                    .filter(matchesSearchText);
            }
            
            if (elements.length > 1) {
                elements = elements.filter(el => {
                    return !elements.some(other => other !== el && el.contains(other));
                });
            }

            const targetIndex = omniIndex >= 0 ? omniIndex : explicitIndex;
            const target = elements[targetIndex];

            if (target) {
                const clickable = findClickableTarget(target);
                clickable.click();

                // If this is a label or wraps an input, trigger change/click on input
                try {
                    const childInput = clickable.tagName === 'LABEL'
                        ? (clickable.querySelector('input') || (clickable.getAttribute('for') ? document.getElementById(clickable.getAttribute('for')) : null))
                        : (clickable.tagName === 'INPUT' ? clickable : null);
                    if (childInput && childInput.type && ['radio', 'checkbox'].includes(childInput.type)) {
                        if (childInput.type === 'radio') {
                            childInput.checked = true;
                        } else {
                            childInput.checked = !childInput.checked;
                        }
                        childInput.dispatchEvent(new Event('change', { bubbles: true }));
                        childInput.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                } catch (_) {}

                try {
                    const rect = clickable.getBoundingClientRect();
                    const clientX = rect.left + rect.width / 2;
                    const clientY = rect.top + rect.height / 2;
                    ['mousedown', 'mouseup', 'click'].forEach(type => {
                        clickable.dispatchEvent(new MouseEvent(type, {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX,
                            clientY,
                            button: 0
                        }));
                    });
                } catch (_) {}

                return {
                    success: true,
                    matchCount: elements.length,
                    index: explicitIndex,
                    omniIndex: targetIndex
                };
            }
            
            return { error: 'Element not found at requested index', candidates: elements.length, omniIndex: targetIndex };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Click failed in all contexts' };
}

/**
 * Sync phone scroll position to the desktop chat container.
 * @param {import('./state.js').CDPConnection} cdp
 * @param {{scrollTop?: number, scrollPercent?: number}} params
 * @returns {Promise<{success?: boolean, scrolled?: number, error?: string}>}
 */
async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    // Try to scroll the chat container in Antigravity
    const EXPRESSION = `(async () => {
        try {
            // Find the main scrollable chat container
            const scrollables = [...document.querySelectorAll('#conversation [class*="scroll"], #chat [class*="scroll"], #cascade [class*="scroll"], #conversation [style*="overflow"], #chat [style*="overflow"], #cascade [style*="overflow"]')]
                .filter(el => el.scrollHeight > el.clientHeight);
            
            // Also check for the main chat area
            const chatArea = document.querySelector('#conversation .overflow-y-auto, #chat .overflow-y-auto, #cascade .overflow-y-auto, #conversation [data-scroll-area], #chat [data-scroll-area], #cascade [data-scroll-area]');
            if (chatArea) scrollables.unshift(chatArea);
            
            if (scrollables.length === 0) {
                // Fallback: scroll the main container element
                const cascade = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            // Use percentage-based scrolling for better sync
            if (${scrollPercent} !== undefined) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed in all contexts' };
}

/**
 * Set the AI model via the model selector dropdown.
 * @param {import('./state.js').CDPConnection} cdp
 * @param {string} modelName
 * @returns {Promise<{success?: boolean, method?: string, error?: string}>}
 */
async function setModel(cdp, modelName) {
    const safeModelName = JSON.stringify(String(modelName || ''));
    const EXP = `(async () => {
        try {
            const requestedModel = ${safeModelName};
            const normalize = (s) => String(s || '').toLowerCase().replace(/[()]/g, '').replace(/\\s+/g, ' ').trim();
            const normTarget = normalize(requestedModel);
            const tokens = normTarget.split(' ').filter(Boolean);

            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model", "Flash", "Pro", "Sonnet", "Opus"];
            
            let modelBtn = null;
            
            // Strategy 1: Look for active model selector button in bottom composer/toolbar
            const buttonCandidates = Array.from(document.querySelectorAll('button')).filter(b => {
                const txt = (b.innerText || '').trim();
                return /^(Gemini|Claude|GPT)/i.test(txt) && txt.length < 40 && !txt.includes('Ran\\n') && !txt.includes('http');
            });
            if (buttonCandidates.length > 0) {
                // The active composer model button is the last one in DOM order
                modelBtn = buttonCandidates[buttonCandidates.length - 1];
            }

            // Strategy 2: Look for data-tooltip-id patterns
            if (!modelBtn) {
                modelBtn = document.querySelector('[data-tooltip-id*="model"], [data-tooltip-id*="provider"]');
            }
            
            // Strategy 3: Traverse from text nodes up to clickable parents
            if (!modelBtn) {
                const allEls = Array.from(document.querySelectorAll('*'));
                const textNodes = allEls.filter(el => {
                    if (el.children.length > 0) return false;
                    const txt = (el.textContent || '').trim();
                    return /^(Gemini|Claude|GPT)/i.test(txt) && txt.length < 35 && !txt.includes('Ran\\n');
                });

                for (const el of textNodes) {
                    let current = el;
                    for (let i = 0; i < 5; i++) {
                        if (!current) break;
                        if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                            modelBtn = current;
                            break;
                        }
                        current = current.parentElement;
                    }
                    if (modelBtn) break;
                }
            }

            if (!modelBtn) return { error: 'Model selector button not found' };

            // Click to open menu
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // Find the menu container (Radix/custom popover container)
            const menuContainer = Array.from(document.querySelectorAll('div')).find(d =>
                d.className.includes('bg-card') && d.innerText?.includes('Model') && d.offsetHeight > 0
            ) || document.body;

            const menuItems = Array.from(menuContainer.querySelectorAll('[class*="cursor-pointer"], [class*="text-[13px]"], [role="menuitem"], [role="option"], button'))
                .filter(el => {
                    if (el === modelBtn) return false;
                    const txt = (el.innerText || '').trim();
                    return /^(Gemini|Claude|GPT)/i.test(txt) && txt.length < 50;
                });

            // 1. Exact normalized match
            let target = menuItems.find(el => normalize(el.innerText) === normTarget);

            // 2. Substring normalized match
            if (!target) {
                target = menuItems.find(el => {
                    const n = normalize(el.innerText);
                    return n.includes(normTarget) || normTarget.includes(n);
                });
            }

            // 3. Token containment match (all tokens match)
            if (!target && tokens.length >= 2) {
                target = menuItems.find(el => {
                    const n = normalize(el.innerText);
                    return tokens.every(t => n.includes(t));
                });
            }

            // 4. Family + major version match (e.g. Gemini 3.8 matches Gemini 3.8 Flash Medium)
            if (!target && tokens.length >= 2) {
                const coreTokens = tokens.slice(0, 2);
                target = menuItems.find(el => {
                    const n = normalize(el.innerText);
                    return coreTokens.every(t => n.includes(t));
                });
            }

            if (target) {
                target.scrollIntoView({ block: 'center' });
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true, selected: target.innerText?.trim() };
            }

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));

            return { error: 'Model "' + requestedModel + '" not found in list. Visible items: ' + menuItems.map(m => m.innerText.trim()).join(', ') };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

/**
 * Start a new chat by clicking the + button at the top toolbar.
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<{success?: boolean, method?: string, count?: number, error?: string}>}
 */
async function startNewChat(cdp) {
    const EXP = `(async () => {
        try {
            // Priority 1: Exact selector from user (data-tooltip-id="new-conversation-tooltip")
            const exactBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
            if (exactBtn) {
                exactBtn.click();
                return { success: true, method: 'data-tooltip-id' };
            }

            // Fallback: Use previous heuristics
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
            
            // Find all buttons with plus icons
            const plusButtons = allButtons.filter(btn => {
                if (btn.offsetParent === null) return false; // Skip hidden
                const hasPlusIcon = btn.querySelector('svg.lucide-plus') || 
                                   btn.querySelector('svg.lucide-square-plus') ||
                                   btn.querySelector('svg[class*="plus"]');
                return hasPlusIcon;
            });
            
            // Filter only top buttons (toolbar area)
            const topPlusButtons = plusButtons.filter(btn => {
                const rect = btn.getBoundingClientRect();
                return rect.top < 200;
            });

            if (topPlusButtons.length > 0) {
                 topPlusButtons.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                 topPlusButtons[0].click();
                 return { success: true, method: 'filtered_top_plus', count: topPlusButtons.length };
            }
            
            // Fallback: aria-label
             const newChatBtn = allButtons.find(btn => {
                const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
                const title = btn.getAttribute('title')?.toLowerCase() || '';
                return (ariaLabel.includes('new') || title.includes('new')) && btn.offsetParent !== null;
            });
            
            if (newChatBtn) {
                newChatBtn.click();
                return { success: true, method: 'aria_label_new' };
            }
            
            return { error: 'New chat button not found' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}
/**
 * Click the history button and scrape the conversation list.
 * Accurately extracts conversations from Antigravity Jetski fast-pick or side-panels.
 * Prevents Explorer / file tree false positives.
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<{success?: boolean, chats: Array<{id?: string, chatId?: string, title: string, workspace?: string, date: string, active?: boolean}>, debug?: object, error?: string}>}
 */
async function getChatHistory(cdp) {
    const EXP = `(async () => {
        try {
            const chats = [];
            const seenIds = new Set();
            const seenTitles = new Set();

            // 1. Check if fast-pick or conversation listbox is ALREADY open and visible
            let fastPick = document.querySelector('.jetski-fast-pick');
            let isVisible = fastPick && (fastPick.offsetParent !== null || window.getComputedStyle(fastPick).display !== 'none');

            // 2. If not open, locate the history toggle button and open it
            if (!isVisible) {
                let historyBtn = document.querySelector(
                    '[data-past-conversations-toggle="true"], ' +
                    '[data-tooltip-id="history-tooltip"], ' +
                    '[data-tooltip-id*="conversation-history"], ' +
                    '[data-tooltip-id*="history"], ' +
                    '[data-tooltip-id*="past-conversations"]'
                );

                // Priority 2: Look for button ADJACENT to the new chat button
                if (!historyBtn) {
                    const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"], [data-tooltip-id*="new-chat"]');
                    if (newChatBtn?.parentElement) {
                        const siblings = Array.from(newChatBtn.parentElement.children).filter(el => el !== newChatBtn);
                        historyBtn = siblings.find(el => 
                            el.getAttribute('data-tooltip-id')?.includes('history') ||
                            el.querySelector('svg.lucide-history, svg.lucide-clock, svg.lucide-clock-rotate-left, svg[class*="history"], svg[class*="clock"]')
                        );
                    }
                }

                // Priority 3: Scan buttons/links with explicit history iconography (NEVER folder icon)
                if (!historyBtn) {
                    const allButtons = Array.from(document.querySelectorAll('a, button, [role="button"]'));
                    for (const btn of allButtons) {
                        if (btn.offsetParent === null) continue;
                        const label = (btn.getAttribute('data-tooltip-id') || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
                        if (label.includes('file') || label.includes('explorer') || label.includes('folder')) continue;
                        if (label.includes('history') || label.includes('past conversation')) {
                            historyBtn = btn;
                            break;
                        }
                        const hasHistoryIcon = btn.querySelector('svg.lucide-clock') ||
                                               btn.querySelector('svg.lucide-history') ||
                                               btn.querySelector('svg.lucide-clock-rotate-left') ||
                                               btn.querySelector('svg[class*="clock"]') ||
                                               btn.querySelector('svg[class*="history"]');
                        if (hasHistoryIcon) {
                            historyBtn = btn;
                            break;
                        }
                    }
                }

                if (!historyBtn) {
                    return { error: 'History button not found', chats: [] };
                }

                // Click once to open
                historyBtn.click();

                // Wait for fast pick to appear
                for (let i = 0; i < 20; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    fastPick = document.querySelector('.jetski-fast-pick');
                    if (fastPick && (fastPick.offsetParent !== null || window.getComputedStyle(fastPick).display !== 'none')) {
                        break;
                    }
                }
            }

            if (fastPick) {
                // Scrape conversation options from Antigravity fast-pick
                const options = Array.from(fastPick.querySelectorAll('[role="option"], [id^="fastpick-item-"]'));
                for (const opt of options) {
                    if (opt.id && opt.id.startsWith('fastpick-show-more')) continue;
                    const text = opt.innerText?.trim() || '';
                    if (text.startsWith('Show ') && text.includes('more')) continue;

                    const fullId = opt.id || '';
                    const chatId = fullId.startsWith('fastpick-item-') ? fullId.replace('fastpick-item-', '') : fullId;

                    // Title extraction
                    const titleSpan = opt.querySelector('.truncate > span') || opt.querySelector('.truncate') || opt.querySelector('span');
                    const title = titleSpan?.textContent?.trim() || text.split('\\n')[0] || '';
                    if (!title || title.length < 2) continue;

                    // Workspace extraction
                    const wsBdi = opt.querySelector('bdi > span') || opt.querySelector('bdi') || opt.querySelector('.opacity-50');
                    const workspace = wsBdi?.textContent?.trim() || '';

                    // Relative timestamp extraction
                    const dateSpan = opt.querySelector('span.ml-4, span[class*="ml-4"]') || opt.querySelector('span.text-xs.opacity-50.ml-4');
                    let date = dateSpan?.textContent?.trim() || '';
                    if (!date || date === workspace || date.includes('/')) {
                        date = 'Recent';
                    }

                    // Active state
                    const isActive = opt.getAttribute('aria-selected') === 'true' ||
                                     !!opt.closest('.flex-col')?.querySelector('.text-muted-foreground')?.textContent?.includes('Current');

                    const dedupeKey = chatId || title;
                    if (seenIds.has(dedupeKey)) continue;
                    seenIds.add(dedupeKey);

                    chats.push({
                        id: fullId,
                        chatId: chatId,
                        title: title,
                        workspace: workspace,
                        date: date,
                        active: isActive
                    });

                    if (chats.length >= 60) break;
                }
            }

            // Fallback for non-fastpick side panels (strictly scoped inside a dialog/popup, never <html>)
            if (chats.length === 0) {
                const searchInput = Array.from(document.querySelectorAll('input')).find(i => {
                    const ph = (i.placeholder || '').toLowerCase();
                    return (ph.includes('search') && ph.includes('convo')) || ph.includes('conversation');
                });
                if (searchInput) {
                    let container = searchInput.parentElement;
                    while (container && container !== document.body && container !== document.documentElement) {
                        const style = window.getComputedStyle(container);
                        if (style.position === 'fixed' || style.position === 'absolute' || parseInt(style.zIndex, 10) > 10) {
                            break;
                        }
                        container = container.parentElement;
                    }
                    if (container && container !== document.body && container !== document.documentElement) {
                        const items = Array.from(container.querySelectorAll('[role="option"], [data-conversation-id]'));
                        for (const item of items) {
                            const title = item.innerText?.split('\\n')[0]?.trim();
                            if (title && !seenTitles.has(title)) {
                                seenTitles.add(title);
                                chats.push({
                                    id: item.id || '',
                                    chatId: item.id || '',
                                    title: title,
                                    date: 'Recent',
                                    active: item.getAttribute('aria-selected') === 'true'
                                });
                            }
                        }
                    }
                }
            }

            return {
                success: true,
                chats,
                debug: {
                    chatsFound: chats.length,
                    fastPickFound: !!fastPick
                }
            };
        } catch (e) {
            return { error: e.toString(), chats: [] };
        }
    })()`;

    let lastError = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                const val = res.result.value;
                if (val.success && val.chats && val.chats.length > 0) return val;
                if (val.success) return val;
                if (val.error) lastError = val.error;
            }
            if (res.exceptionDetails) {
                lastError = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    return { error: 'Context failed: ' + (lastError || 'No contexts available'), chats: [] };
}

/**
 * Select a specific chat from the history panel by title or conversation ID.
 * @param {import('./state.js').CDPConnection} cdp
 * @param {string} [chatTitle]
 * @param {string} [chatId]
 * @returns {Promise<{success?: boolean, method?: string, error?: string}>}
 */
async function selectChat(cdp, chatTitle, chatId) {
    const safeChatTitle = JSON.stringify(chatTitle || '');
    const safeChatId = JSON.stringify(chatId || '');

    const EXP = `(async () => {
        try {
            const targetTitle = ${safeChatTitle};
            const targetId = ${safeChatId};

            // 1. Ensure history modal is open and visible
            let fastPick = document.querySelector('.jetski-fast-pick');
            const isVisible = fastPick && (fastPick.offsetParent !== null || window.getComputedStyle(fastPick).display !== 'none');

            if (!isVisible) {
                let historyBtn = document.querySelector(
                    '[data-past-conversations-toggle="true"], ' +
                    '[data-tooltip-id="history-tooltip"], ' +
                    '[data-tooltip-id*="conversation-history"], ' +
                    '[data-tooltip-id*="history"], ' +
                    '[data-tooltip-id*="past-conversations"]'
                );

                if (!historyBtn) {
                    const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"], [data-tooltip-id*="new-chat"]');
                    if (newChatBtn?.parentElement) {
                        const siblings = Array.from(newChatBtn.parentElement.children).filter(el => el !== newChatBtn);
                        historyBtn = siblings.find(el => 
                            el.getAttribute('data-tooltip-id')?.includes('history') ||
                            el.querySelector('svg.lucide-history, svg.lucide-clock, svg.lucide-clock-rotate-left, svg[class*="history"], svg[class*="clock"]')
                        );
                    }
                }

                if (historyBtn) {
                    historyBtn.click();
                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 100));
                        fastPick = document.querySelector('.jetski-fast-pick');
                        if (fastPick && (fastPick.offsetParent !== null || window.getComputedStyle(fastPick).display !== 'none')) {
                            break;
                        }
                    }
                }
            }

            let clicked = false;
            let method = '';

            // Strategy 1: Find by exact ID
            if (targetId) {
                const byId = document.getElementById(targetId) || 
                             document.getElementById('fastpick-item-' + targetId) ||
                             document.querySelector('[id*="' + targetId + '"]');
                if (byId && typeof byId.click === 'function') {
                    byId.click();
                    clicked = true;
                    method = 'chatId_match';
                }
            }

            // Strategy 2: Find option by title inside fastPick
            if (!clicked && fastPick) {
                const options = Array.from(fastPick.querySelectorAll('[role="option"], [id^="fastpick-item-"]'));
                const match = options.find(opt => {
                    const text = (opt.innerText || '').toLowerCase();
                    const target = (targetTitle || '').toLowerCase();
                    return target && (text.includes(target) || target.includes(text) || text.includes(target.slice(0, 20)));
                });

                if (match) {
                    match.click();
                    clicked = true;
                    method = 'fastpick_title_match';
                }
            }

            // Strategy 3: Fast-pick search input fallback
            if (!clicked && fastPick && targetTitle) {
                const searchInput = fastPick.querySelector('input');
                if (searchInput) {
                    searchInput.focus();
                    searchInput.value = targetTitle.slice(0, 30);
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 200));
                    const firstOption = fastPick.querySelector('[role="option"], [id^="fastpick-item-"]');
                    if (firstOption) {
                        firstOption.click();
                        clicked = true;
                        method = 'fastpick_search_match';
                    }
                }
            }

            if (!clicked) {
                return { error: 'Chat not found: ' + (targetTitle || targetId) };
            }

            // Check if a confirmation quick-pick appeared (e.g. "Open in current window" for cross-workspace convos)
            let confirmedQuickPick = false;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 100));
                const qi = document.querySelector('.quick-input-widget');
                if (qi && (qi.offsetParent !== null || window.getComputedStyle(qi).display !== 'none')) {
                    const rows = Array.from(qi.querySelectorAll('.monaco-list-row, .quick-input-list-entry'));
                    const openCurrent = rows.find(el => el.innerText && (el.innerText.includes('Open in current window') || el.innerText.includes('current workspace')));
                    if (openCurrent) {
                        openCurrent.click();
                        confirmedQuickPick = true;
                        break;
                    } else if (rows.length > 0) {
                        rows[0].click();
                        confirmedQuickPick = true;
                        break;
                    }
                    const input = qi.querySelector('input');
                    if (input) {
                        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
                        confirmedQuickPick = true;
                        break;
                    }
                }
            }

            // Wait for conversation DOM to render
            for (let j = 0; j < 15; j++) {
                await new Promise(r => setTimeout(r, 100));
                const conv = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                if (conv && conv.innerText && conv.innerText.trim().length > 20) break;
            }

            return {
                success: true,
                method,
                confirmedQuickPick
            };
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    let lastError = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                const val = res.result.value;
                if (val.success) return val;
                if (val.error) lastError = val.error;
            }
            if (res.exceptionDetails) {
                lastError = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    return { error: lastError || 'Context failed' };
}

/**
 * Check if a chat is currently open (has a cascade/conversation element).
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<{hasChat: boolean, hasMessages: boolean, editorFound: boolean}>}
 */
async function hasChatOpen(cdp) {
    const EXP = `(() => {
    const chatContainer = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
    const hasMessages = chatContainer && chatContainer.querySelectorAll('[class*="message"], [data-message]').length > 0;
    return {
        hasChat: !!chatContainer,
        hasMessages: hasMessages,
        editorFound: !!(chatContainer && chatContainer.querySelector('[data-lexical-editor="true"]'))
    };
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                const val = res.result.value;
                if (val.hasChat || val.hasMessages || val.editorFound) {
                    return val;
                }
            }
        } catch (e) { }
    }
    return { hasChat: false, hasMessages: false, editorFound: false };
}

/**
 * Get the current app state — active mode and AI model.
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<{mode: string, model: string, error?: string} | {error: string}>}
 */
async function getAppState(cdp) {
    const EXP = `(async () => {
    try {
        const state = { mode: 'Unknown', model: 'Unknown' };

        // 1. Get Mode (Fast/Planning)
        // Strategy: Find the clickable mode button which contains either "Fast" or "Planning"
        // It's usually a button or div with cursor:pointer containing the mode text
        const allEls = Array.from(document.querySelectorAll('*'));

        // Find elements that are likely mode buttons
        for (const el of allEls) {
            if (el.children.length > 0) continue;
            const text = (el.innerText || '').trim();
            if (text !== 'Fast' && text !== 'Planning') continue;

            // Check if this or a parent is clickable (the actual mode selector)
            let current = el;
            for (let i = 0; i < 5; i++) {
                if (!current) break;
                const style = window.getComputedStyle(current);
                if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                    state.mode = text;
                    break;
                }
                current = current.parentElement;
            }
            if (state.mode !== 'Unknown') break;
        }

        // Fallback: Just look for visible text
        if (state.mode === 'Unknown') {
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            if (textNodes.some(el => el.innerText.trim() === 'Planning')) state.mode = 'Planning';
            else if (textNodes.some(el => el.innerText.trim() === 'Fast')) state.mode = 'Fast';
        }

        // 2. Get Model
        // Strategy: First check active model button in bottom composer/toolbar
        const buttonCandidates = Array.from(document.querySelectorAll('button')).filter(b => {
            const txt = (b.innerText || '').trim();
            return /^(Gemini|Claude|GPT)/i.test(txt) && txt.length < 40 && !txt.includes('Ran\\n') && !txt.includes('http') && !txt.includes('curl');
        });

        if (buttonCandidates.length > 0) {
            state.model = buttonCandidates[buttonCandidates.length - 1].innerText.trim();
        } else {
            // Fallback: Leaf text nodes starting with a known model name
            const textNodes2 = allEls.filter(el => el.children.length === 0 && el.innerText);
            let modelEl = textNodes2.find(el => {
                const txt = el.innerText.trim();
                return /^(Gemini|Claude|GPT)/i.test(txt) && txt.length < 40 && !txt.includes('http') && !txt.includes('curl');
            });
            if (modelEl) {
                state.model = modelEl.innerText.trim();
            }
        }

        return state;
    } catch (e) { return { error: e.toString() }; }
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                const val = res.result.value;
                if (val.mode !== 'Unknown' || val.model !== 'Unknown') return val;
            }
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

/**
 * Identify and click the waiting action button (Accept/Run/Allow vs Reject/Deny)
 * @param {import('./state.js').CDPConnection} cdp
 * @param {'accept' | 'reject'} action
 * @returns {Promise<{success?: boolean, error?: string}>}
 */
async function completePendingAction(cdp, action) {
    const isAccept = action === 'accept';
    const EXP = `(async () => {
        try {
            const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
            const acceptTexts = ['run command', 'allow', 'accept', 'run', 'yes', 'confirm',
                                 'allow once', 'allow this conversation', 'continue', 'proceed'];
            const rejectTexts = ['reject', 'deny', 'cancel', 'no', 'abort'];

            // SAFETY: Never click permanent permission buttons
            // These grant persistent permissions that bypass future prompts
            const dangerousTexts = ['always run', 'always allow', 'ask every time',
                                    'trust workspace', 'trust this workspace'];
            
            const targetTexts = ${isAccept} ? acceptTexts : rejectTexts;
            
            // Filter all visible buttons
            const visibleBtns = allBtns.filter(btn => btn.offsetParent !== null);
            
            // Find target buttons (may be multiple accept buttons for simultaneous actions)
            const targetBtns = visibleBtns.filter(btn => {
                const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                // Block dangerous permanent permissions
                if (dangerousTexts.some(d => text.includes(d))) return false;
                return targetTexts.some(t => text === t || text.startsWith(t));
            });
            
            if (targetBtns.length === 0) {
                return { error: 'Action button not found' };
            }
            
            // Click with incremental delays to avoid race conditions
            // when multiple accept buttons appear simultaneously
            let clicked = 0;
            for (let i = 0; i < targetBtns.length; i++) {
                const delay = i * 800; // 800ms between clicks
                if (delay > 0) await new Promise(r => setTimeout(r, delay));
                targetBtns[i].click();
                clicked++;
            }
            return { success: true, buttonsClicked: clicked };
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) {}
    }
    return { error: 'Context failed' };
}

/**
 * Track IDs of actions already acted on (approved, rejected, reviewed, or dismissed)
 * to prevent background polling loops from resurrecting static DOM elements.
 * @type {Set<string>}
 */
export const actedActionIds = new Set();

/**
 * Enhanced prompt detection across CDP contexts for:
 * 1. Interactive questions (ask_question modal)
 * 2. Terminal commands (run command / reject)
 * 3. Implementation plan validation (Proceed)
 *
 * @param {import('./state.js').CDPConnection} cdp
 * @returns {Promise<any | null>}
 */
export async function scanInteractivePrompts(cdp) {
    if (!cdp || !cdp.contexts || cdp.contexts.length === 0) return null;

    const SCRIPT = `(() => {
        try {
            const isVisible = (el) => {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            };

            const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(isVisible);
            
            const dangerousTexts = ['always run', 'always allow', 'ask every time', 'trust workspace', 'trust this workspace'];

            const simpleHash = (str) => {
                let hash = 5381;
                for (let i = 0; i < str.length; i++) {
                    hash = ((hash << 5) + hash) + str.charCodeAt(i);
                }
                return Math.abs(hash).toString(36);
            };

            // 1. Interactive Question (Antigravity cascade step or modal dialog with Submit/Continue & Skip)
            const submitBtn = allBtns.find(b => {
                if (b.getAttribute('data-testid') === 'interaction-continue-button') return true;
                const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
                return /^(submit|valider|send|confirm|continue)/i.test(t) || /(?:submit|valider|send|confirm|continue)\s*[↵\n]/i.test(t);
            });
            const skipBtn = allBtns.find(b => {
                if (b.getAttribute('data-testid') === 'interaction-skip-button') return true;
                const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
                return /^(skip|passer|ignore)/i.test(t);
            });

            let questionContainer = null;
            if (submitBtn && skipBtn) {
                questionContainer = submitBtn.closest('[tabindex="-1"], [class*="no-focus-ring"], .outline-none.flex.flex-col, [role="dialog"], [class*="modal"], [class*="dialog"], [class*="card"]')
                    || submitBtn.parentElement?.parentElement
                    || submitBtn.parentElement?.parentElement?.parentElement
                    || document.body;
            } else {
                const dialog = document.querySelector('[role="dialog"], .monaco-dialog-box, .dialog-box, [class*="dialog"], [class*="modal"]') ||
                               document.querySelector('[data-testid="question-widget"]');
                const questionCards = Array.from(document.querySelectorAll('.rounded-xl.border.border-border, [class*="rounded"][class*="border"]')).filter(c => {
                    const hasQuestionHeader = /\d+\s+questions?/i.test(c.innerText);
                    if (!hasQuestionHeader) return false;
                    if (c.querySelector('[contenteditable="true"], [data-lexical-editor="true"]')) return false;
                    return true;
                });
                const inlineCard = questionCards.length > 0 ? questionCards[questionCards.length - 1] : null;
                questionContainer = (dialog && isVisible(dialog)) ? dialog : inlineCard;
            }

            const isConfirmedQuestion = !!(submitBtn && skipBtn);
            if (questionContainer && (isConfirmedQuestion || !questionContainer.querySelector('[contenteditable="true"], [data-lexical-editor="true"]'))) {
                // Header / question title
                const headerEl = questionContainer.querySelector('.text-sm, h1, h2, h3, h4, p, .title, [class*="title"], [class*="question"]')
                    || questionContainer.querySelector('span, div');

                // Step progress / question counter (e.g. "1 of 2")
                const counterSpan = Array.from(questionContainer.querySelectorAll('span, div')).find(el => /\b\d+\s+of\s+\d+\b/i.test((el.innerText || '').trim()));
                const counterPrefix = counterSpan ? ('[' + counterSpan.innerText.trim() + '] ') : '';

                // Detect multi-select
                const isMulti = !!questionContainer.querySelector('[role="checkbox"], input[type="checkbox"]')
                    || /multi-select/i.test(questionContainer.innerText);

                // Find option labels or elements (excluding write-in)
                const allLabels = Array.from(questionContainer.querySelectorAll('label'));
                const optionLabels = allLabels.filter(lbl => {
                    const forAttr = lbl.getAttribute('for') || lbl.getAttribute('htmlFor') || '';
                    if (forAttr.includes('__write_in__')) return false;
                    const text = (lbl.innerText || lbl.textContent || '').trim();
                    if (!text || /^(submit|valider|send|continue|skip)/i.test(text)) return false;
                    return true;
                });

                let options = [];
                if (optionLabels.length > 0) {
                    options = optionLabels.map((lbl, idx) => {
                        const input = lbl.querySelector('input') || (lbl.getAttribute('for') ? questionContainer.querySelector('#' + lbl.getAttribute('for')) : null);
                        const spans = Array.from(lbl.querySelectorAll('span'));
                        let text = '';
                        if (spans.length >= 2) {
                            text = spans[spans.length - 1].innerText.trim();
                        } else if (spans.length === 1) {
                            text = spans[0].innerText.trim();
                        } else {
                            text = (lbl.innerText || lbl.textContent || '').trim();
                        }
                        text = text.replace(/^[A-Z]\s+/, '').trim();

                        return {
                            id: idx,
                            optId: input?.value || String.fromCharCode(65 + idx),
                            text: text || ('Option ' + (idx + 1)),
                            checked: input ? input.checked : (lbl.getAttribute('aria-checked') === 'true' || lbl.classList.contains('bg-secondary'))
                        };
                    }).filter(o => o.text.length > 0);
                } else {
                    const optionEls = Array.from(questionContainer.querySelectorAll('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"], [class*="option"], [class*="choice"], .cursor-pointer'))
                        .filter(el => {
                            const t = (el.innerText || el.textContent || '').trim();
                            if (!t) return false;
                            if (/^(submit|valider|send|ok|confirm|envoyer|skip|passer|ignore|continue)/i.test(t)) return false;
                            if (/\d+\s+questions?/i.test(t)) return false;
                            if (headerEl && t === headerEl.innerText.trim()) return false;
                            if (el.tagName === 'BUTTON' && (el === submitBtn || el === skipBtn)) return false;
                            return true;
                        });
                    options = optionEls.map((opt, idx) => {
                        const input = opt.tagName === 'INPUT' ? opt : opt.querySelector('input');
                        const text = (opt.innerText || opt.textContent || '').trim();
                        return {
                            id: idx,
                            text: text || ('Option ' + (idx + 1)),
                            checked: input ? input.checked : opt.getAttribute('aria-checked') === 'true'
                        };
                    }).filter(o => o.text.length > 0);
                }

                if (options.length > 0 || (submitBtn && skipBtn)) {
                    const writeInInput = questionContainer.querySelector('input[type="text"], textarea')
                        || questionContainer.querySelector('[id*="__write_in__"]');

                    const targetSubmit = submitBtn || Array.from(questionContainer.querySelectorAll('button, [role="button"]'))
                        .find(b => {
                            if (b.getAttribute('data-testid') === 'interaction-continue-button') return true;
                            return /submit|valider|send|ok|confirm|envoyer|continue/i.test((b.innerText || b.getAttribute('aria-label') || '').trim());
                        });
                    const targetSkip = skipBtn || allBtns.find(b => {
                        if (b.getAttribute('data-testid') === 'interaction-skip-button') return true;
                        return /^(skip|passer|ignore)$/i.test((b.innerText || b.getAttribute('aria-label') || '').trim());
                    });

                    const rawQuestionTitle = (headerEl?.innerText || 'Interactive Decision').trim();
                    const cleanQuestionTitle = rawQuestionTitle.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ');
                    const finalTitle = counterPrefix + cleanQuestionTitle;

                    const promptKey = finalTitle + options.map(o => o.text).join('|');

                    const rawSubmitText = targetSubmit ? (targetSubmit.innerText || targetSubmit.getAttribute('aria-label') || 'Submit').replace(/[↵\r\n]/g, '').trim() : 'Submit';
                    const rawSkipText = targetSkip ? (targetSkip.innerText || targetSkip.getAttribute('aria-label') || 'Skip').trim() : 'Skip';

                    return {
                        id: 'question-' + simpleHash(promptKey),
                        type: 'question',
                        title: finalTitle,
                        isMultiSelect: isMulti,
                        options: options,
                        hasWriteIn: !!writeInInput || !!questionContainer.querySelector('label[for*="__write_in__"]'),
                        submitText: rawSubmitText || 'Submit',
                        skipText: rawSkipText || 'Skip'
                    };
                }
            }

            // 2. Terminal Command Approval
            const runBtn = allBtns.find(btn => {
                const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                if (dangerousTexts.some(d => text.includes(d))) return false;
                return text === 'run command' || text === 'run';
            });

            if (runBtn) {
                const rejectBtn = allBtns.find(btn => {
                    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                    const rejectTexts = ['reject', 'deny', 'cancel', 'no', 'abort'];
                    return rejectTexts.some(r => text === r || text.startsWith(r));
                });

                const container = runBtn.closest('.chat-row, .monaco-list-row, div[class*="row"], div[class*="message"]') || runBtn.parentElement?.parentElement;
                let commandSnippet = '';
                if (container) {
                    const codeEl = container.querySelector('code, pre, [class*="terminal"], [class*="command"]');
                    if (codeEl) {
                        commandSnippet = (codeEl.innerText || codeEl.textContent || '').trim();
                    } else {
                        const txt = container.innerText || '';
                        const m = txt.match(/CommandLine:\\s*([^\\n\\r]+)/i);
                        if (m) commandSnippet = m[1].trim();
                    }
                }

                return {
                    id: 'cmd-' + simpleHash(commandSnippet || 'pending-cmd'),
                    type: 'command',
                    title: 'Command Execution',
                    command: commandSnippet || 'Terminal execution pending...',
                    acceptText: (runBtn.innerText || 'Run command').trim(),
                    rejectText: rejectBtn ? (rejectBtn.innerText || 'Reject').trim() : 'Reject'
                };
            }

            // 3. Plan Validation (Proceed button)
            const proceedBtn = allBtns.find(btn => {
                const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                return text === 'proceed' || text.startsWith('proceed with plan');
            });

            if (proceedBtn) {
                // If agent is actively running/generating (stop button visible), plan is not awaiting approval
                const isAgentWorking = allBtns.some(b => {
                    const t = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    return t === 'stop' || t === 'cancel' || t === 'stop generation';
                });
                if (isAgentWorking) {
                    return null;
                }

                const reviewBtn = allBtns.find(btn => {
                    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                    return text === 'review';
                });

                return {
                    id: 'plan-approval',
                    type: 'plan',
                    title: 'Plan Approval',
                    summary: "Implementation plan is ready. Review details or proceed with execution.",
                    proceedText: (proceedBtn.innerText || 'Proceed with Plan').trim(),
                    reviewText: reviewBtn ? (reviewBtn.innerText || 'Review').trim() : 'Review',
                    hasPreview: true
                };
            }

            return null;
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                const prompt = res.result.value;
                if (prompt.error) {
                    console.warn(`[scanInteractivePrompts] Script error in context ${ctx.id}:`, prompt.error);
                    continue;
                }
                if (prompt.type === 'command') {
                    const heuristics = evaluateCommandHeuristics(prompt.command);
                    prompt.riskLevel = heuristics.riskLevel || 'warning';
                    prompt.riskReason = heuristics.reason;
                }
                if (prompt.type === 'plan') {
                    try {
                        const plan = await findLatestImplementationPlan();
                        if (plan) {
                            prompt.id = 'plan-' + Math.floor(plan.updatedAt / 1000).toString(36) + '-' + hashString(plan.content.slice(0, 100));
                            prompt.planPath = plan.path;
                            prompt.updatedAt = plan.updatedAt;
                        }
                    } catch (_) {}
                }

                // Check if this action ID was already acted on by the user
                if (actedActionIds.has(prompt.id)) {
                    return null;
                }

                return prompt;
            }
        } catch (e) {}
    }
    return null;
}

/**
 * Execute user action response in Antigravity via CDP.
 *
 * @param {import('./state.js').CDPConnection} cdp
 * @param {{actionId?: string, type: 'command' | 'question' | 'plan', decision?: string, selectedOptions?: any[], writeInText?: string}} payload
 * @returns {Promise<{success?: boolean, error?: string, executed?: string}>}
 */
export async function executeActionResponse(cdp, payload) {
    if (!cdp || !cdp.contexts || cdp.contexts.length === 0) {
        return { error: 'No CDP contexts available' };
    }

    const { type, decision, selectedOptions, writeInText } = payload || {};

    const EXP = `(async () => {
        try {
            const isVisible = (el) => {
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            };

            const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(isVisible);
            
            const dangerousTexts = ['always run', 'always allow', 'ask every time', 'trust workspace', 'trust this workspace'];

            if ('${decision}' === 'proceed' || ('${type}' === 'plan' && '${decision}' !== 'review' && '${decision}' !== 'later' && '${decision}' !== 'dismiss')) {
                const proceedBtn = allBtns.find(b => {
                    const text = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    return text === 'proceed' || text.startsWith('proceed with plan') || text.includes('proceed');
                }) || Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
                    const t = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    return t === 'proceed' || t.includes('proceed');
                });
                if (proceedBtn) {
                    proceedBtn.click();
                    return { success: true, executed: 'proceed' };
                }
                return { error: 'Proceed button not found in active Antigravity window' };
            }

            if ('${type}' === 'plan' && '${decision}' === 'review') {
                const reviewBtn = allBtns.find(b => {
                    const text = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    return text === 'review';
                });
                if (reviewBtn) {
                    reviewBtn.click();
                    return { success: true, executed: 'review_clicked' };
                }
                return { success: true, executed: 'review' };
            }

            if ('${type}' === 'command') {
                const isAccept = '${decision}' === 'accept';
                const acceptTexts = ['run command', 'run', 'allow', 'allow once', 'continue', 'proceed'];
                const rejectTexts = ['reject', 'deny', 'cancel', 'no', 'abort'];
                const targetTexts = isAccept ? acceptTexts : rejectTexts;

                const targetBtn = allBtns.find(btn => {
                    const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim().toLowerCase();
                    if (dangerousTexts.some(d => text.includes(d))) return false;
                    return targetTexts.some(t => text === t || text.startsWith(t));
                });

                if (targetBtn) {
                    targetBtn.click();
                    return { success: true, executed: isAccept ? 'accept' : 'reject' };
                }
                return { error: 'Command action button not found' };
            }

            if ('${type}' === 'question') {
                const isSkip = '${decision}' === 'skip';
                const skipBtn = allBtns.find(b => {
                    if (b.getAttribute('data-testid') === 'interaction-skip-button') return true;
                    const text = (b.innerText || b.getAttribute('aria-label') || '').trim().toLowerCase();
                    return /^(skip|passer|ignore)/i.test(text);
                });
                if (isSkip) {
                    if (skipBtn) {
                        skipBtn.click();
                        return { success: true, executed: 'skip' };
                    }
                    return { error: 'Skip button not found' };
                }

                const submitBtn = allBtns.find(b => {
                    if (b.getAttribute('data-testid') === 'interaction-continue-button') return true;
                    const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
                    return /^(submit|valider|send|confirm|continue)/i.test(t) || /(?:submit|valider|send|confirm|continue)\s*[↵\n]/i.test(t);
                });

                let root = null;
                if (submitBtn && skipBtn) {
                    root = submitBtn.closest('.outline-none.flex.flex-col, .outline-none, [class*="no-focus-ring"], [role="dialog"], [class*="modal"], [class*="dialog"], [class*="card"], div.fixed, div.absolute')
                        || submitBtn.parentElement?.parentElement?.parentElement
                        || submitBtn.parentElement?.parentElement
                        || document.body;
                } else {
                    const questionCards = Array.from(document.querySelectorAll('.rounded-xl.border.border-border, [class*="rounded"][class*="border"]')).filter(c => {
                        return /\d+\s+questions?/i.test(c.innerText);
                    });
                    const inlineCard = questionCards.length > 0 ? questionCards[questionCards.length - 1] : null;
                    const dialog = document.querySelector('[role="dialog"], .monaco-dialog-box, .dialog-box') ||
                                   document.querySelector('[data-testid="question-widget"]');
                    root = inlineCard || (dialog && isVisible(dialog) ? dialog : (submitBtn ? submitBtn.parentElement?.parentElement : null));
                }
                if (!root) {
                    root = document.body;
                }

                const selectedIndices = ${JSON.stringify(selectedOptions || [])};
                const writeIn = ${JSON.stringify(writeInText || '')};

                // Find option labels excluding write-in
                const allLabels = Array.from(root.querySelectorAll('label'));
                const optionLabels = allLabels.filter(lbl => {
                    const forAttr = lbl.getAttribute('for') || lbl.getAttribute('htmlFor') || '';
                    if (forAttr.includes('__write_in__')) return false;
                    const text = (lbl.innerText || lbl.textContent || '').trim();
                    if (!text || /^(submit|valider|send|continue|skip)/i.test(text)) return false;
                    return true;
                });

                if (selectedIndices.length > 0 && optionLabels.length > 0) {
                    selectedIndices.forEach(sel => {
                        let targetLabel = null;
                        if (typeof sel === 'number') {
                            targetLabel = optionLabels[sel];
                        } else {
                            targetLabel = optionLabels.find(l => (l.innerText || l.textContent || '').toLowerCase().includes(String(sel).toLowerCase()));
                        }
                        if (targetLabel) {
                            const input = targetLabel.querySelector('input') || (targetLabel.getAttribute('for') ? root.querySelector('#' + targetLabel.getAttribute('for')) : null);
                            if (input) {
                                input.checked = true;
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            targetLabel.click();
                        }
                    });
                } else if (selectedIndices.length > 0) {
                    const optionEls = Array.from(root.querySelectorAll('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"], .cursor-pointer'))
                        .filter(el => {
                            const t = (el.innerText || el.textContent || '').trim();
                            return t && !/^(submit|valider|send|skip|passer|continue)/i.test(t) && !/\d+\s+questions?/i.test(t);
                        });
                    selectedIndices.forEach(sel => {
                        let targetOpt = typeof sel === 'number' ? optionEls[sel] : optionEls.find(o => (o.innerText || o.textContent || '').toLowerCase().includes(String(sel).toLowerCase()));
                        if (targetOpt) {
                            const input = targetOpt.tagName === 'INPUT' ? targetOpt : targetOpt.querySelector('input');
                            if (input) {
                                input.checked = true;
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                            targetOpt.click();
                        }
                    });
                }

                if (writeIn) {
                    const writeInLabel = root.querySelector('label[for*="__write_in__"]');
                    if (writeInLabel) writeInLabel.click();
                    const writeInput = root.querySelector('textarea, input[type="text"]');
                    if (writeInput) {
                        writeInput.focus();
                        const proto = writeInput instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                        if (setter) {
                            setter.call(writeInput, writeIn);
                        } else {
                            writeInput.value = writeIn;
                        }
                        writeInput.dispatchEvent(new Event('input', { bubbles: true }));
                        writeInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }

                const finalSubmit = submitBtn ||
                    Array.from(root.querySelectorAll('button, [role="button"]')).find(b => {
                        if (b.getAttribute('data-testid') === 'interaction-continue-button') return true;
                        return /^(submit|valider|send|ok|confirm|envoyer|continue)/i.test((b.innerText || b.getAttribute('aria-label') || '').trim());
                    }) ||
                    Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
                        if (b.getAttribute('data-testid') === 'interaction-continue-button') return true;
                        return /^(submit|valider|send|ok|confirm|envoyer|continue)/i.test((b.innerText || b.getAttribute('aria-label') || '').trim());
                    });
                
                if (finalSubmit) {
                    finalSubmit.click();
                    const isContinue = (finalSubmit.innerText || '').toLowerCase().includes('continue');
                    return { success: true, executed: isContinue ? 'continue' : 'submit' };
                }

                return { success: true, executed: 'options_applied' };
            }

            return { error: 'Unknown action type' };
        } catch (err) {
            return { error: err.toString() };
        }
    })()`;

    let lastError = 'Failed to execute action in CDP context';
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) {
                return res.result.value;
            }
            if (res.result?.value?.error) {
                lastError = res.result.value.error;
            }
            if (res.exceptionDetails?.text || res.exceptionDetails?.exception?.description) {
                lastError = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    return { error: lastError };
}

// hashString → src/utils/hash.js

// isLocalRequest → src/utils/network.js
// initCDP → src/cdp/connection.js

/**
 * Background polling with exponential backoff and CDP status broadcast.
 * @param {import('ws').WebSocketServer} wss
 * @returns {Promise<void>}
 */
async function startPolling(wss) {
    let lastErrorLog = 0;
    let isConnecting = false;
    let reconnectDelay = 2000; // Start at 2s, max 30s
    const MAX_RECONNECT_DELAY = 30000;
    let reconnectAttempts = 0;
    let heartbeatInterval = null;
    let lastNotificationTime = 0;
    let lastActionNotificationTime = 0;
    let lastAutoApprovalTime = 0;
    let lastDialogErrorTime = 0;

    // WebSocket ping/pong heartbeat (every 30s)
    heartbeatInterval = setInterval(() => {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.ping();
            }
        });
    }, 30000);

    // Broadcast CDP status to all mobile clients
    /** @param {string} status */
function broadcastCDPStatus(status) {
        broadcast({ type: 'cdp_status', status, timestamp: new Date().toISOString() });
    }

    const poll = async () => {
        // Periodically refresh available targets list (multi-window)
        try {
            availableTargets = await discoverAllCDP();
            if (!activeTargetId && availableTargets.length > 0) {
                const currentMatch = cdpConnection?.ws?.url ? availableTargets.find(t => t.wsUrl === cdpConnection.ws.url) : null;
                activeTargetId = currentMatch ? currentMatch.id : availableTargets[0].id;
            }
        } catch (e) { /* ignore */ }

        if (!cdpConnection || (cdpConnection.ws && cdpConnection.ws.readyState !== WebSocket.OPEN)) {
            if (!isConnecting) {
                console.log('🔍 Looking for Antigravity CDP connection...');
                isConnecting = true;
                broadcastCDPStatus('reconnecting');
            }
            if (cdpConnection) {
                console.log('🔄 CDP connection lost. Attempting to reconnect...');
                await stopScreencast();
                cdpConnection = null;
            }
            try {
                cdpConnection = await initCDP();
                if (cdpConnection) {
                    console.log('✅ CDP Connection established from polling loop');
                    isConnecting = false;
                    reconnectDelay = 2000; // Reset backoff
                    reconnectAttempts = 0;
                    sessionStats.increment('reconnections');
                    sessionStats.logAction('cdp_reconnected');
                    broadcastCDPStatus('connected');
                }
            } catch (e) { const err = /** @type {Error} */ (e);
                reconnectAttempts++;
                reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
                if (reconnectAttempts % 5 === 0) {
                    console.log(`   ⏳ Reconnect attempt #${reconnectAttempts} (next in ${Math.round(reconnectDelay/1000)}s)`);
                }
            }
            setTimeout(poll, reconnectDelay);
            return;
        }

        try {
            // ─── Dialog Error Scanner (outside chat container) ────────
            // Scans for full-page modal errors in ALL CDP contexts
            // Pattern from tody-agent/AntigravityMobile:checkErrorDialogs
            const nowTime = Date.now();
            if (nowTime - lastDialogErrorTime > 30000) { // 30s cooldown
                try {
                    const dialogError = await checkErrorDialogs(cdpConnection);
                    if (dialogError) {
                        lastDialogErrorTime = nowTime;
                        sessionStats.increment('dialogErrorsDetected');
                        sessionStats.logError(dialogError.type, dialogError.error);
                        const typeEmoji = {
                            terminated: '💀', quota: '📊', rate_limit: '⏱️',
                            high_traffic: '🔥', server_error: '💥', network_error: '🌐'
                        };
                        const emoji = typeEmoji[dialogError.type] || '🚨';
                        console.log(`${emoji} Dialog error detected: [${dialogError.type}] ${dialogError.error}`);
                        broadcast({
                            type: 'notification',
                            event: 'dialog_error',
                            errorType: dialogError.type,
                            message: `${emoji} ${dialogError.error}`,
                            timestamp: new Date().toISOString()
                        });
                        sendTelegramNotification(`${emoji} <b>Antigravity Alert:</b> ${dialogError.error}`).then((sent) => {
                            trackTelegramNotification(sent);
                        }).catch(() => {});
                    }
} catch (dialogErr) {
                    // non-critical — don't break polling
                }
            }

            const snapshot = await captureSnapshot(cdpConnection);
            if (snapshot && !snapshot.error) {
                sessionStats.increment('snapshotsProcessed');
                const hash = hashString(snapshot.html);
                const htmlLower = (snapshot.html || '').toLowerCase();

                // 1. Check for Pending Actions (Interactive Decision, Command Approval, or Plan Validation)
                let detectedPrompt = null;
                if (cdpConnection && cdpConnection.contexts && cdpConnection.contexts.length > 0) {
                    detectedPrompt = await scanInteractivePrompts(cdpConnection);
                } else if (snapshot.html) {
                    detectedPrompt = detectPendingPromptFromHtml(snapshot.html);
                }

                if (detectedPrompt) {
                    if (actedActionIds.has(detectedPrompt.id)) {
                        detectedPrompt = null;
                    }
                }

                if (detectedPrompt) {
                    const isNewPrompt = !currentPendingAction || currentPendingAction.id !== detectedPrompt.id;
                    currentPendingAction = detectedPrompt;
                    state.setCurrentPendingAction(detectedPrompt);

                    if (isNewPrompt) {
                        console.log(`⚡ Action prompt broadcast: [${detectedPrompt.type}] ${detectedPrompt.title} (ID: ${detectedPrompt.id})`);
                        broadcast({
                            type: 'action_required',
                            action: detectedPrompt,
                            timestamp: new Date().toISOString()
                        });

                        if (nowTime - lastActionNotificationTime > 15000) {
                            lastActionNotificationTime = nowTime;
                            const teleMsg = detectedPrompt.type === 'command'
                                ? `⚠️ <b>Antigravity Action Required:</b> Command approval [${(detectedPrompt.riskLevel || 'warning').toUpperCase()}]\n<code>${(detectedPrompt.command || '').slice(0, 150)}</code>`
                                : detectedPrompt.type === 'plan'
                                    ? `📋 <b>Antigravity Plan Ready:</b> Implementation plan awaits execution approval.`
                                    : `❓ <b>Antigravity Question:</b> ${detectedPrompt.title}`;
                            sendTelegramNotification(teleMsg).then((sent) => {
                                trackTelegramNotification(sent);
                            }).catch(() => {});
                        }
                    }

                    // For terminal commands, retain supervisor integration
                    if (detectedPrompt.type === 'command') {
                        if (aiSupervisor.isSuggestModeEnabled()) {
                            const commandText = detectedPrompt.command || extractPendingCommand(snapshot.html);
                            if (!suggestQueue.hasPendingCommand(commandText)) {
                                try {
                                    const review = await aiSupervisor.reviewPendingAction({ html: snapshot.html });
                                    const result = suggestQueue.add({
                                        action: review.suggestedAction,
                                        command: review.commandText,
                                        reason: review.reason,
                                        source: review.source,
                                        summary: review.summary
                                    });
                                    if (result.created) {
                                        console.log(`📝 Supervisor queued suggestion (${review.suggestedAction}) for pending action`);
                                    }
                                } catch (e) {
                                    const error = /** @type {Error} */ (e);
                                    console.warn(`Supervisor suggest-mode review failed: ${error.message}`);
                                }
                            }
                        } else if (nowTime - lastAutoApprovalTime > 15000) {
                            try {
                                const decision = await aiSupervisor.shouldApprove({ html: snapshot.html });
                                if (decision.approved) {
                                    const approval = await completePendingAction(cdpConnection, 'accept');
                                    if (approval.success) {
                                        lastAutoApprovalTime = nowTime;
                                        lastActionNotificationTime = nowTime;
                                        sessionStats.increment('actionsApproved');
                                        sessionStats.increment('actionsAutoApproved');
                                        sessionStats.logAction('action_auto_approved', {
                                             reason: decision.reason
                                        });
                                        broadcast({
                                            type: 'notification',
                                            event: 'action_auto_approved',
                                            message: `Local supervisor approved the pending action (${decision.reason}).`,
                                            timestamp: new Date().toISOString()
                                        });
                                        sendTelegramNotification('✅ <b>Antigravity Supervisor:</b> safe auto-approval granted.').then((sent) => {
                                            trackTelegramNotification(sent);
                                        }).catch(() => {});
                                        currentPendingAction = null;
                                        state.setCurrentPendingAction(null);
                                        broadcast({
                                            type: 'action_resolved',
                                            actionId: detectedPrompt.id,
                                            timestamp: new Date().toISOString()
                                        });
                                    }
                                }
                            } catch (e) {
                                const error = /** @type {Error} */ (e);
                                console.warn(`Supervisor check failed: ${error.message}`);
                            }
                        }
                    }
                } else if (currentPendingAction && !currentPendingAction.id?.includes('mock')) {
                    const resolvedId = currentPendingAction.id;
                    currentPendingAction = null;
                    state.setCurrentPendingAction(null);
                    broadcast({
                        type: 'action_resolved',
                        actionId: resolvedId,
                        timestamp: new Date().toISOString()
                    });
                }

                // 2. Check for Quota or Termination with specific cooldown
                // Only alert on active UI error banners / quota banners, NEVER on historical chat text!
                if (nowTime - lastNotificationTime > 60000) { // 1 min cooldown
                    let notifyType = null;
                    let notifyMessage = '';
                    if (snapshot.quotaWarning) {
                        notifyType = 'quota_error';
                        notifyMessage = snapshot.quotaWarning || 'Model Quota Exceeded!';
                        sessionStats.increment('quotaWarnings');
                        sessionStats.logError('quota', notifyMessage);
                    } else if (snapshot.agentError) {
                        notifyType = 'agent_error';
                        notifyMessage = snapshot.agentError || 'Agent Terminated or Blocked!';
                        sessionStats.logError('agent_error', notifyMessage);
                    }
                    
                    if (notifyType) {
                        lastNotificationTime = nowTime;
                        broadcast({
                            type: 'notification',
                            event: notifyType,
                            message: notifyMessage,
                            timestamp: new Date().toISOString()
                        });
                        console.log(`⚠️ Alert triggered: ${notifyMessage}`);
                        
                        const emoji = notifyType === 'task_completed' ? '✅' : '🚨';
                        sendTelegramNotification(`${emoji} <b>Antigravity Notification:</b> ${notifyMessage}`).then((sent) => {
                            trackTelegramNotification(sent);
                        }).catch(() => {});
                    }
                }
                // ---------------------------------------------------------------

                if (hash !== lastSnapshotHash) {
                    lastSnapshot = snapshot;
                    lastSnapshotHash = hash;
                    sessionStats.increment('snapshotUpdatesBroadcast');
                    broadcast({
                        type: 'snapshot_update',
                        agentActivity: snapshot.agentActivity || 'Idle',
                        isGenerating: Boolean(snapshot.isGenerating),
                        timestamp: new Date().toISOString()
                    });

                    console.log(`📸 Snapshot updated(hash: ${hash})`);
                }
            } else {
                const now = Date.now();
                if (!lastErrorLog || now - lastErrorLog > 10000) {
                    const errorMsg = snapshot?.error || 'No valid snapshot captured (check contexts)';
                    sessionStats.logError('snapshot_capture', errorMsg);
                    console.warn(`⚠️  Snapshot capture issue: ${errorMsg} `);
                    if (errorMsg.includes('container not found')) {
                        console.log('   (Tip: Ensure an active chat is open in Antigravity)');
                    }
                    if (cdpConnection.contexts.length === 0) {
                        console.log('   (Tip: No active execution contexts found. Try interacting with the Antigravity window)');
                    }
                    lastErrorLog = now;
                }
            }
        } catch (e) { const err = /** @type {Error} */ (e);
            console.error('Poll error:', err.message);
        }

        setTimeout(poll, POLL_INTERVAL);
    };

    poll();
}

// Create Express app
async function createServer() {
    const app = express();
    await ensureWorkspaceData();

    // Check for SSL certificates
    const keyPath = join(PROJECT_ROOT, 'certs', 'server.key');
    const certPath = join(PROJECT_ROOT, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    let server;
    let httpsServer = null;

    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        httpsServer = https.createServer(sslOptions, app);
        server = httpsServer;
    } else {
        server = http.createServer(app);
    }

    const wss = new WebSocketServer({ server });
    websocketServer = wss;
    await screenshotTimeline.init();
    if (!suggestionQueueUnsubscribe) {
        suggestionQueueUnsubscribe = suggestQueue.subscribe((event, payload) => {
            if (event === 'added') {
                sessionStats.increment('suggestionsCreated');
                sessionStats.logAction('suggestion_created', {
                    action: payload.action,
                    reason: payload.reason
                });
            } else if (event === 'approved') {
                sessionStats.increment('suggestionsApproved');
                sessionStats.logAction('suggestion_approved', {
                    action: payload.action
                });
            } else if (event === 'rejected') {
                sessionStats.increment('suggestionsRejected');
                sessionStats.logAction('suggestion_rejected', {
                    action: payload.action
                });
            } else if (event === 'expired' && payload?.command) {
                sessionStats.logAction('suggestion_expired', {
                    command: payload.command
                });
            }

            if (event === 'added') {
                broadcast({
                    type: 'suggestion',
                    event: 'new_suggestion',
                    suggestion: payload,
                    pendingCount: suggestQueue.getPendingCount(),
                    timestamp: new Date().toISOString()
                });
                sendSuggestionRequired(payload).then((sent) => {
                    trackTelegramNotification(sent);
                }).catch(() => {});
            } else {
                broadcast({
                    type: 'suggestion',
                    event,
                    suggestion: payload?.id ? payload : null,
                    pendingCount: suggestQueue.getPendingCount(),
                    timestamp: new Date().toISOString()
                });
            }

            broadcastSuggestionState();
        });
    }
    if (!sessionStatsUnsubscribe) {
        sessionStatsUnsubscribe = sessionStats.subscribe(() => {
            broadcastStatsState();
        });
    }
    if (!quotaServiceUnsubscribe) {
        quotaServiceUnsubscribe = quotaService.subscribe((event, summary) => {
            broadcastQuotaState();
            if (event !== 'updated' || !Array.isArray(summary?.alerts) || !summary.alerts.length) {
                return;
            }

            const lines = summary.alerts.slice(0, 4).map((model) =>
                `• <b>${model.name}</b>: ${model.usagePercent}% used`
            );
            sendTypedNotification(
                'warning',
                [
                    '⚠️ <b>Model quota alert</b>',
                    ...lines,
                    summary.lastUpdated
                        ? `Updated: ${new Date(summary.lastUpdated).toLocaleTimeString()}`
                        : ''
                ].filter(Boolean).join('\n')
            ).then((sent) => {
                trackTelegramNotification(sent);
            }).catch(() => {});
        });
    }
    if (!timelineUnsubscribe) {
        timelineUnsubscribe = screenshotTimeline.subscribe((event, summary, payload) => {
            if (event === 'captured' && payload?.entry) {
                sessionStats.increment('timelineCaptures');
                sessionStats.logAction('timeline_capture_saved', {
                    reason: payload.entry.reason,
                    filename: payload.entry.filename
                });
            } else if (event === 'cleared') {
                sessionStats.logAction('timeline_cleared', {
                    cleared: payload?.cleared || 0
                });
            }

            broadcastTimelineState();
        });
    }
    quotaService.start();
    quotaService.refresh().catch(() => {});
    screenshotTimeline.start({
        getSnapshotHash: () => lastSnapshotHash || '',
        captureScreenshot: () => captureCurrentScreenshot({
            format: 'jpeg',
            quality: 70
        })
    });
    terminalManager.on('output', (entry) => {
        broadcast({ type: 'terminal_output', entry });
    });
    terminalManager.on('exit', (terminalState) => {
        broadcast({ type: 'terminal_state', state: terminalState });
    });
    Object.entries(tunnelManagers).forEach(([provider, manager]) => {
        manager.on('url', () => {
            tunnelProvider = provider;
            broadcastTunnelStatus();
        });
        manager.on('exit', () => {
            if (tunnelProvider === provider) {
                broadcastTunnelStatus();
            }
        });
    });

    // Initialize session security & token
    AUTH_TOKEN = hashString(APP_PASSWORD + AUTH_SALT + Date.now().toString());

    // Check for --launch argument
    if (process.argv.includes('--launch')) {
        console.log('CLI flag --launch detected. Spawning new Antigravity instance...');
        try {
            await launchAntigravity();
        } catch (e) {
            console.error('Failed to auto-launch Antigravity:', e.message);
        }
    }

    app.use(compression());
    app.use(express.json({ limit: JSON_BODY_LIMIT }));
    app.use(cookieParser(COOKIE_SECRET));
    app.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
        next();
    });

    // Ngrok Bypass Middleware
    app.use((req, res, next) => {
        // Tell ngrok to skip the "visit" warning for API requests
        res.setHeader('ngrok-skip-browser-warning', 'true');
        next();
    });

    // Auth Middleware
    app.use((req, res, next) => {
        const publicPaths = ['/login', '/login.html', '/favicon.ico', '/manifest.json', '/sw.js', '/js/login.js'];
        if (
            publicPaths.includes(req.path) ||
            req.path.startsWith('/css/') ||
            req.path.startsWith('/icons/')
        ) {
            return next();
        }

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            return next();
        }

        // Magic Link / QR Code Auto-Login
        if (req.query.key === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            // Remove the key from the URL by redirecting to the base path
            return res.redirect('/');
        }

        const token = req.signedCookies[AUTH_COOKIE_NAME];
        if (token === AUTH_TOKEN) {
            return next();
        }

        // If it's an API request, return 401, otherwise redirect to login
        if (req.xhr || req.headers.accept?.includes('json') || req.path.startsWith('/snapshot') || req.path.startsWith('/send')) {
            res.status(401).json({ error: 'Unauthorized' });
        } else {
            res.redirect('/login.html');
        }
    });

    app.get('/admin', (req, res) => {
        res.sendFile(join(PROJECT_ROOT, 'public', 'admin.html'));
    });

    app.get('/minimal', (req, res) => {
        res.sendFile(join(PROJECT_ROOT, 'public', 'minimal.html'));
    });

    app.get('/sw.js', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
        res.sendFile(join(PROJECT_ROOT, 'public', 'sw.js'));
    });

    app.get('/login.html', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.sendFile(join(PROJECT_ROOT, 'public', 'login.html'));
    });

    app.use('/uploads', express.static(uploadsDir));
    app.use(express.static(join(PROJECT_ROOT, 'public')));

    // Login endpoint
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE_NAME);
        res.json({ success: true });
    });

    // Get current snapshot
    app.get('/snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({
            ...lastSnapshot,
            agentActivity: lastSnapshot.agentActivity || 'Idle',
            pendingAction: currentPendingAction
        });
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            cdpConnected: cdpConnection?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: hasSSL,
            clients: getOpenClientCount(),
            tunnel: {
                provider: tunnelProvider,
                ...getTunnelStatus()
            },
            version: VERSION
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = join(PROJECT_ROOT, 'certs', 'server.key');
        const certPath = join(PROJECT_ROOT, 'certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: hasSSL,
            certsExist: certsExist,
            message: hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            const { execSync } = await import('child_process');
            execSync('node scripts/generate_ssl.js', { cwd: PROJECT_ROOT, stdio: 'pipe' });
            res.json({
                success: true,
                message: 'SSL certificates generated! Restart the server to enable HTTPS.'
            });
        } catch (e) {
            res.status(500).json({
                success: false,
                error: e.message
            });
        }
    });

    // Debug UI Endpoint
    app.get('/debug-ui', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
        const uiTree = await inspectUI(cdpConnection);
        console.log('--- UI TREE ---');
        console.log(uiTree);
        console.log('---------------');
        res.type('json').send(uiTree);
    });

    // Set Mode
    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(cdpConnection, mode);
        res.json(result);
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(cdpConnection, model);
        res.json(result);
    });

    // Available Models (dynamic from Language Server / fallback to modern defaults)
    app.get('/api/models', async (req, res) => {
        const DEFAULT_MODELS = [
            'Gemini 3.8 Flash High',
            'Gemini 3.7 Flash Medium',
            'Gemini 3.6 Flash Medium',
            'Gemini 3.1 Pro High',
            'Gemini 3.1 Pro Low',
            'Claude Sonnet 4.6 (Thinking)',
            'Claude Opus 4.6 (Thinking)',
            'GPT-OSS 120B (Medium)'
        ];

        try {
            let summary = quotaService.getSummary();
            if (!summary || !Array.isArray(summary.models) || summary.models.length === 0) {
                summary = await quotaService.refresh();
            }

            if (summary && Array.isArray(summary.models) && summary.models.length > 0) {
                const dynamicModels = Array.from(new Set(
                    summary.models
                        .map(m => m.label || m.name)
                        .filter(Boolean)
                ));

                if (dynamicModels.length > 0) {
                    return res.json({
                        models: dynamicModels,
                        source: 'language-server',
                        total: dynamicModels.length
                    });
                }
            }
        } catch (_) {}

        res.json({
            models: DEFAULT_MODELS,
            source: 'default',
            total: DEFAULT_MODELS.length
        });
    });

    // Stop Generation
    app.post('/stop', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(cdpConnection);
        res.json(result);
    });

    // Get latest implementation plan for preview
    app.get('/api/plan', async (req, res) => {
        try {
            const plan = await findLatestImplementationPlan();
            if (!plan) {
                return res.status(404).json({ error: 'No implementation plan found' });
            }
            res.json({ success: true, ...plan });
        } catch (e) {
            const error = /** @type {Error} */ (e);
            res.status(500).json({ error: error.message });
        }
    });

    // Get currently pending action
    app.get('/api/action/pending', (req, res) => {
        res.json({ action: currentPendingAction });
    });

    // Respond to an interactive action (command, question, plan)
    app.post('/api/action/respond', async (req, res) => {
        const { actionId, type, decision, selectedOptions, writeInText, feedback, comment } = req.body || {};
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });

        if (actionId) {
            actedActionIds.add(actionId);
        }
        if (currentPendingAction?.id) {
            actedActionIds.add(currentPendingAction.id);
        }

        if (decision === 'later' || decision === 'dismiss') {
            if (currentPendingAction) {
                const resolvedId = actionId || currentPendingAction.id;
                currentPendingAction = null;
                state.setCurrentPendingAction(null);
                broadcast({
                    type: 'action_resolved',
                    actionId: resolvedId,
                    timestamp: new Date().toISOString()
                });
            }
            return res.json({ success: true, executed: 'later' });
        }

        const isMockAction = actionId?.includes('mock') || currentPendingAction?.id?.includes('mock');
        const reviewText = (feedback || comment || writeInText || '').trim();

        if (isMockAction) {
            const resolvedId = actionId || currentPendingAction?.id;
            if (decision === 'review') {
                if (reviewText) {
                    try {
                        await injectMessage(cdpConnection, reviewText);
                        sessionStats.increment('messagesSent');
                        sessionStats.logAction('plan_review_submitted', { length: reviewText.length, mock: true });
                    } catch (_) {}
                }
                sessionStats.logAction('interactive_action_responded', { actionId: resolvedId, type, decision: 'review', mock: true });
            } else {
                if (decision === 'accept' || decision === 'proceed' || decision === 'submit') {
                    sessionStats.increment('actionsApproved');
                } else if (decision === 'reject' || decision === 'skip') {
                    sessionStats.increment('actionsRejected');
                }
                sessionStats.logAction('interactive_action_responded', { actionId: resolvedId, type, decision, mock: true });
            }

            currentPendingAction = null;
            state.setCurrentPendingAction(null);
            broadcast({
                type: 'action_resolved',
                actionId: resolvedId,
                timestamp: new Date().toISOString()
            });

            return res.json({ success: true, executed: decision, feedbackSent: !!reviewText, mock: true });
        }

        if (type === 'plan' && decision === 'review') {
            try {
                await executeActionResponse(cdpConnection, { type: 'plan', decision: 'review' });
            } catch (_) {}

            if (reviewText) {
                await injectMessage(cdpConnection, reviewText);
                sessionStats.increment('messagesSent');
                sessionStats.logAction('plan_review_submitted', { length: reviewText.length });
            }

            sessionStats.logAction('interactive_action_responded', { actionId, type, decision: 'review' });

            // Clear pending action and broadcast resolution
            const resolvedId = actionId || currentPendingAction?.id;
            currentPendingAction = null;
            state.setCurrentPendingAction(null);
            broadcast({
                type: 'action_resolved',
                actionId: resolvedId,
                timestamp: new Date().toISOString()
            });

            return res.json({ success: true, executed: 'review', feedbackSent: !!reviewText });
        }

        const result = await executeActionResponse(cdpConnection, req.body);
        if (result.success) {
            if (decision === 'accept' || decision === 'proceed' || decision === 'submit') {
                sessionStats.increment('actionsApproved');
            } else if (decision === 'reject' || decision === 'skip') {
                sessionStats.increment('actionsRejected');
            }
            sessionStats.logAction('interactive_action_responded', { actionId, type, decision });

            // Clear pending action and broadcast resolution
            const resolvedId = actionId || currentPendingAction?.id;
            currentPendingAction = null;
            state.setCurrentPendingAction(null);
            broadcast({
                type: 'action_resolved',
                actionId: resolvedId,
                timestamp: new Date().toISOString()
            });
        } else {
            if (actionId) actedActionIds.delete(actionId);
            if (currentPendingAction?.id) actedActionIds.delete(currentPendingAction.id);
        }
        res.json(result);
    });

    // Interact with pending actions (Accept/Reject legacy fallback)
    app.post('/api/interact-action', async (req, res) => {
        const { action } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await completePendingAction(cdpConnection, action);
        if (result.success) {
            if (action === 'accept') {
                sessionStats.increment('actionsApproved');
            } else if (action === 'reject') {
                sessionStats.increment('actionsRejected');
            }
            sessionStats.logAction('manual_pending_action', { action });
            if (currentPendingAction) {
                const resolvedId = currentPendingAction.id;
                actedActionIds.add(resolvedId);
                currentPendingAction = null;
                state.setCurrentPendingAction(null);
                broadcast({
                    type: 'action_resolved',
                    actionId: resolvedId,
                    timestamp: new Date().toISOString()
                });
            }
        }
        res.json(result);
    });

    // Trigger a mock interactive action for testing mobile remote view (Dev Mode Only)
    app.post('/api/action/mock', async (req, res) => {
        if (!getDevMocksEnabled()) {
            return res.status(403).json({ error: 'Mock routes are disabled in production. Set ENABLE_DEV_MOCKS=true to enable.' });
        }
        const { type = 'plan' } = req.body || {};
        let mockAction;

        if (type === 'plan') {
            const plan = await findLatestImplementationPlan();
            const actionId = `plan-mock-${Date.now().toString(36)}`;
            actedActionIds.delete(actionId);

            mockAction = {
                id: actionId,
                type: 'plan',
                title: 'Plan Approval (Mock Test)',
                summary: 'Mock implementation plan ready to test preview modal, review submission, and reply later.',
                proceedText: 'Proceed with Plan',
                reviewText: 'Review',
                hasPreview: true,
                planPath: plan?.path || 'implementation_plan.md',
                updatedAt: plan?.updatedAt || Date.now()
            };
        } else if (type === 'command') {
            const actionId = `cmd-mock-${Date.now().toString(36)}`;
            actedActionIds.delete(actionId);
            mockAction = {
                id: actionId,
                type: 'command',
                title: 'Command Execution (Mock Test)',
                command: 'npm run test:unit',
                acceptText: 'Run command',
                rejectText: 'Reject',
                riskLevel: 'safe',
                riskReason: 'Safe test command execution'
            };
        } else if (type === 'question') {
            const actionId = `question-mock-${Date.now().toString(36)}`;
            actedActionIds.delete(actionId);
            mockAction = {
                id: actionId,
                type: 'question',
                title: 'Design Choice (Mock Test)',
                isMultiSelect: false,
                options: [
                    { id: 0, text: 'Option A: Glassmorphism UI', checked: true },
                    { id: 1, text: 'Option B: Minimal Dark Mode', checked: false }
                ],
                hasWriteIn: true,
                submitText: 'Submit',
                skipText: 'Skip'
            };
        }

        currentPendingAction = mockAction;
        state.setCurrentPendingAction(mockAction);
        broadcast({
            type: 'action_required',
            action: mockAction,
            timestamp: new Date().toISOString()
        });

        res.json({ success: true, action: mockAction });
    });

    // Trigger mock status for testing status indicators (Dev Mode Only)
    app.post('/api/status/mock', async (req, res) => {
        if (!getDevMocksEnabled()) {
            return res.status(403).json({ error: 'Mock routes are disabled in production. Set ENABLE_DEV_MOCKS=true to enable.' });
        }
        const { mode = 'cycle', text, durationMs = 12000 } = req.body || {};
        broadcast({
            type: 'status_test',
            mode,
            text,
            durationMs,
            timestamp: new Date().toISOString()
        });
        res.json({ success: true, mode, text, durationMs });
    });

    app.get('/api/suggestions', (req, res) => {
        res.json(getSuggestionState());
    });

    app.get('/api/suggestions/pending', (req, res) => {
        res.json({
            suggestMode: aiSupervisor.isSuggestModeEnabled(),
            pendingCount: suggestQueue.getPendingCount(),
            suggestions: suggestQueue.getPending()
        });
    });

    app.post('/api/suggestions/:id/approve', async (req, res) => {
        const result = await approveQueuedSuggestion(String(req.params.id || ''));
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    });

    app.post('/api/suggestions/:id/reject', (req, res) => {
        const result = rejectQueuedSuggestion(String(req.params.id || ''));
        if (!result.success) {
            return res.status(400).json(result);
        }
        res.json(result);
    });

    app.delete('/api/suggestions', (req, res) => {
        const cleared = suggestQueue.clear();
        res.json({ success: true, cleared });
    });

    app.get('/api/stats', (req, res) => {
        res.json(getStatsState());
    });

    app.get('/api/quota', async (req, res) => {
        const summary = await quotaService.refresh();
        res.json(summary);
    });

    app.get('/api/timeline', async (req, res) => {
        await screenshotTimeline.init();
        res.json(getTimelineState());
    });

    app.get('/api/timeline/:filename', async (req, res) => {
        const file = await screenshotTimeline.resolveFile(String(req.params.filename || ''));
        if (!file) {
            return res.status(404).json({ error: 'Screenshot not found' });
        }

        res.type(file.entry.mimeType || 'image/jpeg');
        res.sendFile(file.path);
    });

    app.post('/api/timeline/capture', async (req, res) => {
        try {
            const result = await screenshotTimeline.captureNow({
                reason: String(req.body?.reason || 'manual'),
                snapshotHash: lastSnapshotHash || '',
                force: true
            });
            res.json(result);
        } catch (e) { const error = /** @type {Error} */ (e);
            sessionStats.logError('timeline_capture', error.message);
            res.status(error.message.includes('CDP disconnected') ? 503 : 500).json({
                error: error.message,
                ...getTimelineState()
            });
        }
    });

    app.delete('/api/timeline', async (req, res) => {
        const result = await screenshotTimeline.clear();
        res.json(result);
    });

    app.get('/api/assist/history', (req, res) => {
        res.json({ messages: aiSupervisor.getAssistHistory() });
    });

    app.delete('/api/assist/history', (req, res) => {
        aiSupervisor.clearAssistHistory();
        sessionStats.logAction('assist_history_cleared');
        res.json({ success: true, messages: [] });
    });

    app.post('/api/assist/chat', async (req, res) => {
        const message = String(req.body?.message || '').trim();
        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        try {
            const result = await aiSupervisor.chatWithUser(message, getAssistContext());
            sessionStats.logAction('assist_chat_message', {
                source: result.source,
                length: message.length
            });
            res.json(result);
        } catch (e) { const error = /** @type {Error} */ (e);
            sessionStats.logError('assist_chat', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // Send message
    // Protected by withSendLock serialization, 120s deduplication, and busy backoff
    // Credit: Kelvin Tan (@kelverssg)
    app.post('/send', async (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!cdpConnection) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const msgHash = sendHash(message);

        const outcome = await withSendLock(async () => {
            if (isRecentDuplicate(msgHash)) {
                console.log(`[dedupe] suppressed duplicate /send within ${SEND_DEDUPE_MS / 1000}s (hash ${msgHash})`);
                return { deduped: true };
            }

            // Inject message with busy backoff if the editor is currently working
            let result;
            for (let i = 0; ; i++) {
                result = await injectMessage(cdpConnection, message, { checkBusy: true });
                if (result.ok !== false || result.reason !== 'busy' || i >= SEND_BACKOFF_MS.length) break;
                console.log(`[backoff] editor busy — retry ${i + 1}/${SEND_BACKOFF_MS.length} in ${SEND_BACKOFF_MS[i]}ms`);
                await new Promise(r => setTimeout(r, SEND_BACKOFF_MS[i]));
            }

            // If still busy after backoffs, try once without checkBusy so it queues as normal
            if (!result.ok && result.reason === 'busy') {
                result = await injectMessage(cdpConnection, message, { checkBusy: false });
            }

            // Method 2 fallback check (if primary tab returned editor_not_found)
            if (!result.ok && result.error === 'editor_not_found') {
                console.log('[cdp] editor_not_found on primary tab — scanning all tabs (method 2)');
                result = await injectMessageAnyTab(message);
            }

            // Only a successful transmission opens a deduplication window
            if (result.ok !== false) {
                recentSends.set(msgHash, Date.now());
            }

            return { result };
        });

        if (outcome.threw) {
            const e = outcome.threw;
            console.error(`[send] injection threw — answering 500 rather than hanging the caller: ${e?.stack || e}`);
            return res.status(500).json({
                success: false,
                method: 'error',
                details: { ok: false, error: String(e?.message || e), domStatus: 'attempted' }
            });
        }

        if (outcome.deduped) {
            return res.json({
                success: true,
                method: 'deduped',
                details: { ok: true, deduped: true, reason: 'duplicate_suppressed', hash: msgHash }
            });
        }

        const result = outcome.result;
        if (result.ok !== false) {
            sessionStats.increment('messagesSent');
            sessionStats.logAction('message_sent', {
                length: message.length,
                queued: Boolean(result.queued)
            });
        }

        // Always return 200 - the message usually goes through even if CDP reports issues
        // The client will refresh and see if the message appeared
        res.json({
            success: result.ok !== false,
            queued: Boolean(result.queued),
            method: result.method || 'attempted',
            details: result
        });
    });

    // Quick Commands
    app.get('/api/quick-commands', async (req, res) => {
        try {
            const commands = await loadQuickCommands();
            res.json({ commands });
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(500).json({ error: error.message });
        }
    });

    // Workspace file browser
    app.get('/api/fs/ls', async (req, res) => {
        try {
            const data = await listWorkspace(String(req.query.path || '.'));
            res.json(data);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/fs/cat', async (req, res) => {
        try {
            const data = await readWorkspaceFile(String(req.query.path || ''));
            res.json(data);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    // Remote terminal
    app.get('/api/terminal/history', (req, res) => {
        res.json(terminalManager.getState());
    });

    app.post('/api/terminal/run', async (req, res) => {
        try {
            const data = await terminalManager.run(String(req.body.command || ''));
            res.json(data);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/terminal/stop', async (req, res) => {
        const result = await terminalManager.stop();
        res.json(result);
    });

    // Git panel
    app.get('/api/git/status', async (req, res) => {
        try {
            const summary = await getGitSummary();
            res.json(summary);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/git/add', async (req, res) => {
        try {
            const result = await gitAdd(Array.isArray(req.body.paths) ? req.body.paths : []);
            res.json(result);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/git/commit', async (req, res) => {
        try {
            const result = await gitCommit(String(req.body.message || ''));
            res.json(result);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/git/push', async (req, res) => {
        try {
            const result = await gitPush();
            res.json(result);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    // Screencast status + controls
    app.get('/api/screencast/status', (req, res) => {
        res.json(getScreencastStatus());
    });
    app.post('/api/screencast/start', async (req, res) => {
        try {
            const status = await startScreencast();
            res.json(status);
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    app.post('/api/screencast/stop', async (req, res) => {
        await stopScreencast();
        res.json(getScreencastStatus());
    });

    // Media upload bridges (image, voice memo, unified media)
    let lastUploadHash = '';
    let lastUploadTime = 0;
    let lastUploadResult = null;

    // Unified Atomic Media Upload (Image + Audio + Prompt in a single request)
    app.post('/api/upload-media', async (req, res) => {
        try {
            const { image, audio, prompt = '', inject = true, submit = true } = req.body || {};

            if (!image && !audio) {
                return res.status(400).json({ error: 'Either image or audio payload is required' });
            }

            // Deduplication guard: ignore exact duplicate media requests within 4 seconds
            const imgKey = image?.data ? `${image.name || ''}-${image.data.length}-${String(image.data).slice(0, 40)}` : '';
            const audioKey = audio?.data ? `${audio.name || ''}-${audio.data.length}-${String(audio.data).slice(0, 40)}` : '';
            const uploadHash = `media-${imgKey}-${audioKey}`;
            const now = Date.now();
            if (uploadHash === lastUploadHash && (now - lastUploadTime) < 4000) {
                console.warn('[Upload-Media] Deduplicating identical upload request within 4s window');
                return res.json(lastUploadResult || { success: true, duplicate: true });
            }
            lastUploadHash = uploadHash;
            lastUploadTime = now;

            let savedImage = null;
            let savedAudio = null;

            if (image?.data) {
                const cleanImgData = String(image.data).replace(/^data:[^;]+;base64,/, '');
                savedImage = await saveUploadedImage({
                    name: image.name,
                    mimeType: image.mimeType,
                    data: cleanImgData
                });
            }

            if (audio?.data) {
                const cleanAudioData = String(audio.data).replace(/^data:[^;]+;base64,/, '');
                savedAudio = await saveUploadedAudio({
                    name: audio.name,
                    mimeType: audio.mimeType,
                    data: cleanAudioData,
                    durationSeconds: audio.durationSeconds
                });
            }

            let injection = null;
            if (inject) {
                if (!cdpConnection) {
                    return res.status(503).json({ error: 'CDP not connected', image: savedImage, audio: savedAudio });
                }

                let imageAttachedNatively = false;
                let audioAttachedNatively = false;

                try {
                    const defaultCtx = cdpConnection.contexts.find(c => c.auxData?.isDefault) || cdpConnection.contexts[0];
                    const attachResult = await cdpConnection.call("Runtime.evaluate", {
                        contextId: defaultCtx?.id,
                        expression: `(async () => {
                            const results = { image: false, audio: false };
                            try {
                                const root = document.querySelector(".antigravity-agent-side-panel");
                                if (!root) return results;

                                ${savedImage ? `
                                // 1. Attach image via native input change handler or setMediaAttachments
                                const imgB64 = ${JSON.stringify(savedImage.dataUrl.split(',')[1])};
                                const imgBinaryStr = atob(imgB64);
                                const imgBytes = new Uint8Array(imgBinaryStr.length);
                                for (let i = 0; i < imgBinaryStr.length; i++) imgBytes[i] = imgBinaryStr.charCodeAt(i);
                                const imgFile = new File([imgBytes], ${JSON.stringify(savedImage.fileName)}, { type: ${JSON.stringify(savedImage.mimeType || 'image/png')} });

                                const inp = document.querySelector("input[type=file]");
                                if (inp && inp.l?.changefalse) {
                                    try {
                                        inp.l.changefalse({ target: { files: [imgFile] } });
                                        results.image = true;
                                    } catch (_) {}
                                }
                                await new Promise(r => setTimeout(r, 120));
                                ` : ''}

                                // 2. Find Preact inputBoxRef
                                let inputBoxRef = null;
                                function walk(vnode) {
                                    if (!vnode || inputBoxRef) return;
                                    if (vnode.__c?.props?.inputBoxRef) {
                                        inputBoxRef = vnode.__c.props.inputBoxRef;
                                        return;
                                    }
                                    if (Array.isArray(vnode.__k)) vnode.__k.forEach(walk);
                                }
                                if (root.__k) walk(root.__k);

                                if (inputBoxRef?.current?.setMediaAttachments) {
                                    ${savedImage ? `
                                    if (!results.image) {
                                        const imgItem = {
                                            $typeName: "exa.codeium_common_pb.Media",
                                            mimeType: ${JSON.stringify(savedImage.mimeType || 'image/png')},
                                            payload: { case: "inlineData", value: imgBytes },
                                            description: ${JSON.stringify(savedImage.fileName)}
                                        };
                                        inputBoxRef.current.setMediaAttachments(prev => [...(prev || []), imgItem]);
                                        results.image = true;
                                    }
                                    ` : ''}

                                    ${savedAudio ? `
                                    const audioB64 = ${JSON.stringify(savedAudio.dataUrl.split(',')[1])};
                                    const audioBinaryStr = atob(audioB64);
                                    const audioBytes = new Uint8Array(audioBinaryStr.length);
                                    for (let i = 0; i < audioBinaryStr.length; i++) audioBytes[i] = audioBinaryStr.charCodeAt(i);

                                    const audioItem = {
                                        $typeName: "exa.codeium_common_pb.Media",
                                        mimeType: ${JSON.stringify(savedAudio.mimeType)},
                                        payload: { case: "inlineData", value: audioBytes },
                                        durationSeconds: ${Number(savedAudio.durationSeconds) || 0},
                                        description: ${JSON.stringify(savedAudio.fileName)}
                                    };
                                    inputBoxRef.current.setMediaAttachments(prev => [...(prev || []), audioItem]);
                                    results.audio = true;
                                    ` : ''}

                                    await new Promise(r => setTimeout(r, 150));
                                }

                                return results;
                            } catch (err) {
                                return { error: err.message, ...results };
                            }
                        })()`,
                        returnByValue: true,
                        awaitPromise: true
                    });

                    const val = attachResult?.result?.value || {};
                    imageAttachedNatively = !!val.image;
                    audioAttachedNatively = !!val.audio;
                } catch (e) {
                    console.warn("[Upload-Media] Native attachment error:", e.message);
                }

                if (submit) {
                    const userPrompt = prompt ? String(prompt).trim() : '';
                    let composedPrompt = userPrompt;
                    if (savedImage && !imageAttachedNatively) {
                        composedPrompt += (composedPrompt ? '\n\n' : '') + `[Attached image: ${savedImage.fileName}](${savedImage.absolutePath})`;
                    }
                    if (savedAudio && !audioAttachedNatively) {
                        composedPrompt += (composedPrompt ? '\n\n' : '') + `[Voice memo: ${savedAudio.fileName}](${savedAudio.absolutePath})`;
                    }

                    injection = await injectMessage(cdpConnection, composedPrompt);

                    // Clean up file input if used
                    try {
                        await cdpConnection.call("Runtime.evaluate", {
                            expression: `(() => {
                                const inp = document.querySelector("input[type=file]");
                                if (inp) inp.value = "";
                            })()`,
                            returnByValue: true
                        });
                    } catch {}
                } else {
                    injection = { ok: true, staged: true, imageAttachedNatively, audioAttachedNatively };
                }
            }

            if (inject && injection && injection.ok === false) {
                return res.status(500).json({
                    success: false,
                    error: injection.error || injection.reason || 'Failed to inject media into session',
                    image: savedImage,
                    audio: savedAudio,
                    injection
                });
            }

            const result = {
                success: true,
                image: savedImage,
                audio: savedAudio,
                injection
            };
            lastUploadResult = result;
            console.log(`[Upload-Media] Success (image: ${!!savedImage}, audio: ${!!savedAudio}, submit: ${submit})`);
            res.json(result);

            if (inject && injection && injection.ok !== false) {
                sessionStats.increment('uploadsInjected');
                sessionStats.logAction('media_uploaded', {
                    hasImage: !!savedImage,
                    hasAudio: !!savedAudio
                });
            }
        } catch (e) {
            const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    // Image upload bridge
    app.post('/api/upload-image', async (req, res) => {
        try {
            const { data, mimeType, name, prompt = '', inject = true, submit = true } = req.body || {};
            if (!data) {
                return res.status(400).json({ error: 'Image base64 data is required' });
            }

            const cleanData = String(data).replace(/^data:[^;]+;base64,/, '');

            // Deduplication guard: ignore exact duplicate uploads within 4 seconds
            const uploadHash = `image-${name || ''}-${cleanData.length}-${cleanData.slice(0, 80)}`;
            const now = Date.now();
            if (uploadHash === lastUploadHash && (now - lastUploadTime) < 4000) {
                console.warn('[Upload-Image] Deduplicating identical upload request within 4s window');
                return res.json(lastUploadResult || { success: true, duplicate: true });
            }
            lastUploadHash = uploadHash;
            lastUploadTime = now;

            const saved = await saveUploadedImage({
                name,
                mimeType,
                data: cleanData
            });

            let injection = null;
            if (inject) {
                if (!cdpConnection) {
                    return res.status(503).json({ error: 'CDP not connected', upload: saved });
                }

                let attachedNatively = false;

                // 1. Native attachment via Preact file input change handler or setMediaAttachments
                try {
                    const defaultCtx = cdpConnection.contexts.find(c => c.auxData?.isDefault) || cdpConnection.contexts[0];
                    const preactAttachResult = await cdpConnection.call("Runtime.evaluate", {
                        contextId: defaultCtx?.id,
                        expression: `(async () => {
                            try {
                                const root = document.querySelector(".antigravity-agent-side-panel");
                                if (!root) return { ok: false, reason: "no_panel" };

                                const b64 = ${JSON.stringify(cleanData)};
                                const binaryStr = atob(b64);
                                const bytes = new Uint8Array(binaryStr.length);
                                for (let i = 0; i < binaryStr.length; i++) {
                                    bytes[i] = binaryStr.charCodeAt(i);
                                }

                                const fileName = ${JSON.stringify(saved.fileName)};
                                const fileMime = ${JSON.stringify(saved.mimeType || 'image/png')};

                                // Method 1: Trigger native file input change handler
                                const inp = document.querySelector("input[type=file]");
                                if (inp && inp.l?.changefalse) {
                                    try {
                                        const file = new File([bytes], fileName, { type: fileMime });
                                        inp.l.changefalse({ target: { files: [file] } });
                                        await new Promise(r => setTimeout(r, 150));
                                        return { ok: true, method: "input_changefalse" };
                                    } catch (_) {}
                                }

                                // Method 2: Direct Preact setMediaAttachments
                                let inputBoxRef = null;
                                function walk(vnode) {
                                    if (!vnode || inputBoxRef) return;
                                    if (vnode.__c?.props?.inputBoxRef) {
                                        inputBoxRef = vnode.__c.props.inputBoxRef;
                                        return;
                                    }
                                    if (Array.isArray(vnode.__k)) vnode.__k.forEach(walk);
                                }
                                if (root.__k) walk(root.__k);

                                if (inputBoxRef?.current?.setMediaAttachments) {
                                    const mediaItem = {
                                        $typeName: "exa.codeium_common_pb.Media",
                                        mimeType: fileMime,
                                        payload: { case: "inlineData", value: bytes },
                                        description: fileName
                                    };
                                    inputBoxRef.current.setMediaAttachments(prev => [...(prev || []), mediaItem]);
                                    await new Promise(r => setTimeout(r, 150));
                                    return { ok: true, method: "setMediaAttachments" };
                                }

                                return { ok: false, reason: "no_attachment_target" };
                            } catch (err) {
                                return { ok: false, error: err.message };
                            }
                        })()`,
                        returnByValue: true,
                        awaitPromise: true
                    });

                    if (preactAttachResult?.result?.value?.ok) {
                        attachedNatively = true;
                    }
                } catch (preactErr) {
                    console.warn("[Upload-Image] Native attachment failed:", preactErr.message);
                }

                if (submit) {
                    const userPrompt = prompt ? String(prompt).trim() : '';
                    let composedPrompt = userPrompt;
                    if (!attachedNatively) {
                        composedPrompt = composedPrompt
                            ? `${composedPrompt}\n\n[Attached image: ${saved.fileName}](${saved.absolutePath})`
                            : `[Attached image: ${saved.fileName}](${saved.absolutePath})`;
                    }
                    injection = await injectMessage(cdpConnection, composedPrompt);

                    // Clean up file input after injection so stale files do not linger
                    try {
                        await cdpConnection.call("Runtime.evaluate", {
                            expression: `(() => {
                                const inp = document.querySelector("input[type=file]");
                                if (inp) inp.value = "";
                            })()`,
                            returnByValue: true
                        });
                    } catch {}
                } else {
                    injection = { ok: true, staged: true, attachedNatively };
                }
            }

            if (inject && injection && injection.ok === false) {
                return res.status(500).json({
                    success: false,
                    error: injection.error || injection.reason || 'Failed to inject message into session',
                    upload: saved,
                    injection
                });
            }

            const result = {
                success: true,
                upload: saved,
                injection
            };
            lastUploadResult = result;
            console.log(`[Upload-Image] Image uploaded successfully: ${saved.fileName} (attachedNatively: ${injection?.attachedNatively})`);
            res.json(result);
            if (inject && injection && injection.ok !== false) {
                sessionStats.increment('uploadsInjected');
                sessionStats.logAction('image_uploaded', {
                    name: saved.name
                });
            }
        } catch (e) {
            const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    // Voice memo / audio upload bridge
    app.post('/api/upload-audio', async (req, res) => {
        try {
            const { data, mimeType, name, prompt = '', durationSeconds = 0, inject = true, submit = true } = req.body || {};
            if (!data) {
                return res.status(400).json({ error: 'Audio base64 data is required' });
            }

            const cleanData = String(data).replace(/^data:[^;]+;base64,/, '');

            // Deduplication guard: ignore exact duplicate uploads within 4 seconds
            const uploadHash = `audio-${name || ''}-${cleanData.length}-${cleanData.slice(0, 80)}`;
            const now = Date.now();
            if (uploadHash === lastUploadHash && (now - lastUploadTime) < 4000) {
                console.warn('[Upload-Audio] Deduplicating identical audio request within 4s window');
                return res.json(lastUploadResult || { success: true, duplicate: true });
            }
            lastUploadHash = uploadHash;
            lastUploadTime = now;

            const saved = await saveUploadedAudio({
                name,
                mimeType,
                data: cleanData,
                durationSeconds
            });

            let injection = null;
            if (inject) {
                if (!cdpConnection) {
                    return res.status(503).json({ error: 'CDP not connected', upload: saved });
                }

                let attachedNatively = false;

                // 1. Primary Method: Attach directly to Preact inputBoxRef in Antigravity IDE
                try {
                    const defaultCtx = cdpConnection.contexts.find(c => c.auxData?.isDefault) || cdpConnection.contexts[0];
                    const preactAttachResult = await cdpConnection.call("Runtime.evaluate", {
                        contextId: defaultCtx?.id,
                        expression: `(async () => {
                            try {
                                const root = document.querySelector(".antigravity-agent-side-panel");
                                if (!root || !root.__k) return { ok: false, reason: "no_preact_root" };
                                let inputBoxRef = null;
                                function walk(vnode) {
                                    if (!vnode || inputBoxRef) return;
                                    if (vnode.__c?.props?.inputBoxRef) {
                                        inputBoxRef = vnode.__c.props.inputBoxRef;
                                        return;
                                    }
                                    if (Array.isArray(vnode.__k)) {
                                        vnode.__k.forEach(walk);
                                    }
                                }
                                walk(root.__k);
                                if (!inputBoxRef?.current?.setMediaAttachments) {
                                    return { ok: false, reason: "no_setMediaAttachments" };
                                }

                                const b64 = ${JSON.stringify(cleanData)};
                                const binaryStr = atob(b64);
                                const bytes = new Uint8Array(binaryStr.length);
                                for (let i = 0; i < binaryStr.length; i++) {
                                    bytes[i] = binaryStr.charCodeAt(i);
                                }

                                const mediaItem = {
                                    $typeName: "exa.codeium_common_pb.Media",
                                    mimeType: ${JSON.stringify(saved.mimeType)},
                                    payload: { case: "inlineData", value: bytes },
                                    durationSeconds: ${Number(saved.durationSeconds) || 0},
                                    description: ${JSON.stringify(saved.fileName)}
                                };

                                inputBoxRef.current.setMediaAttachments(prev => [...(prev || []), mediaItem]);
                                return { ok: true, method: "preact_direct" };
                            } catch (err) {
                                return { ok: false, error: err.message };
                            }
                        })()`,
                        returnByValue: true,
                        awaitPromise: true
                    });

                    if (preactAttachResult?.result?.value?.ok) {
                        attachedNatively = true;
                    }
                } catch (preactErr) {
                    console.warn("[Upload-Audio] Direct Preact attachment failed, trying fallback:", preactErr.message);
                }

                // 2. Fallback Method: CDP DOM file input
                if (!attachedNatively) {
                    try {
                        const doc = await cdpConnection.call("DOM.getDocument", {});
                        if (doc && doc.root && doc.root.nodeId) {
                            const fileInput = await cdpConnection.call("DOM.querySelector", {
                                nodeId: doc.root.nodeId,
                                selector: "input[type=file]"
                            });
                            if (fileInput && fileInput.nodeId) {
                                await cdpConnection.call("Runtime.evaluate", {
                                    expression: `(() => {
                                        const inp = document.querySelector("input[type=file]");
                                        if (inp) inp.value = "";
                                    })()`,
                                    returnByValue: true
                                });

                                await cdpConnection.call("DOM.setFileInputFiles", {
                                    nodeId: fileInput.nodeId,
                                    files: [saved.absolutePath]
                                });
                                attachedNatively = true;
                                await new Promise(r => setTimeout(r, 400));
                            }
                        }
                    } catch (attachErr) {
                        console.warn("[Upload-Audio] Fallback file attachment failed:", attachErr.message);
                    }
                }

                if (submit) {
                    const userPrompt = prompt ? String(prompt).trim() : '';
                    let composedPrompt = userPrompt;
                    if (!attachedNatively) {
                        composedPrompt = composedPrompt
                            ? `${composedPrompt}\n\n[Voice memo: ${saved.fileName}](${saved.absolutePath})`
                            : `[Voice memo: ${saved.fileName}](${saved.absolutePath})`;
                    }
                    injection = await injectMessage(cdpConnection, composedPrompt);

                    // Clean up file input if used
                    try {
                        await cdpConnection.call("Runtime.evaluate", {
                            expression: `(() => {
                                const inp = document.querySelector("input[type=file]");
                                if (inp) inp.value = "";
                            })()`,
                            returnByValue: true
                        });
                    } catch {}
                } else {
                    injection = { ok: true, staged: true, attachedNatively };
                }
            }

            if (inject && injection && injection.ok === false) {
                return res.status(500).json({
                    success: false,
                    error: injection.error || injection.reason || 'Failed to inject voice memo into session',
                    upload: saved,
                    injection
                });
            }

            const result = {
                success: true,
                upload: saved,
                injection
            };
            lastUploadResult = result;
            console.log(`[Upload-Audio] Audio uploaded successfully: ${saved.fileName} (${saved.durationSeconds}s, attachedNatively: ${injection?.attachedNatively})`);
            res.json(result);
            if (inject && injection && injection.ok !== false) {
                sessionStats.increment('uploadsInjected');
                sessionStats.logAction('audio_uploaded', {
                    name: saved.fileName,
                    durationSeconds: saved.durationSeconds
                });
            }
        } catch (e) {
            const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    // Admin endpoints
    app.get('/api/admin/logs', (req, res) => {
        const limit = Number(req.query.limit || 80);
        res.json({ logs: getServerLogs(limit) });
    });

    app.get('/api/admin/metrics', async (req, res) => {
        try {
            const commands = await loadQuickCommands();
            res.json({
                startedAt: serverStartedAt,
                uptime: process.uptime(),
                version: VERSION,
                https: hasSSL,
                workspaceRoot,
                wsClients: getOpenClientCount(),
                cdpConnected: cdpConnection?.ws?.readyState === WebSocket.OPEN,
                cdpContexts: cdpConnection?.contexts.length || 0,
                availableTargets,
                activeTargetId,
                lastSnapshotStats: lastSnapshot?.stats || null,
                terminal: terminalManager.getState(),
                tunnel: {
                    provider: tunnelProvider,
                    ...getTunnelStatus()
                },
                supervisor: aiSupervisor.getStatus(),
                suggestions: getSuggestionState(),
                quota: getQuotaState(),
                timeline: getTimelineState(),
                screencast: getScreencastStatus(),
                quickCommandsCount: commands.length,
                recentLogs: getServerLogs(40)
            });
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(500).json({ error: error.message });
        }
    });

    app.put('/api/admin/quick-commands', async (req, res) => {
        try {
            const commands = await saveQuickCommands(req.body.commands);
            broadcast({ type: 'quick_commands_updated', commands, timestamp: new Date().toISOString() });
            res.json({ commands });
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(400).json({ error: error.message });
        }
    });

    app.get('/api/admin/tunnel', (req, res) => {
        res.json({
            provider: tunnelProvider,
            ...getTunnelStatus()
        });
    });

    app.post('/api/admin/tunnel/start', async (req, res) => {
        const provider = String(req.body.provider || 'cloudflare').toLowerCase();
        if (!getTunnelManager(provider)) {
            return res.status(400).json({ error: `Unsupported tunnel provider: ${provider}` });
        }

        try {
            const url = await startTunnel(provider, Number(SERVER_PORT), { tls: hasSSL, sniServerName: '127.0.0.1' });
            broadcastTunnelStatus();
            res.json({ success: true, url, provider });
        } catch (e) { const error = /** @type {Error} */ (e);
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/admin/tunnel/stop', async (req, res) => {
        await stopActiveTunnel();
        broadcastTunnelStatus();
        res.json({ success: true, provider: tunnelProvider, ...getTunnelStatus() });
    });

    // UI Inspection endpoint - Returns all buttons as JSON for debugging
    app.get('/ui-inspect', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });

        const EXP = `(() => {
    try {
        // Safeguard for non-DOM contexts
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return { error: 'Non-DOM context' };
        }

        // Helper to get string class name safely (handles SVGAnimatedString)
        function getCls(el) {
            if (!el) return '';
            if (typeof el.className === 'string') return el.className;
            if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
            return '';
        }

        // Helper to pierce Shadow DOM
        function findAllElements(selector, root = document) {
            let results = Array.from(root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
                try {
                    if (el.shadowRoot) {
                        results = results.concat(Array.from(el.shadowRoot.querySelectorAll(selector)));
                    }
                } catch (e) { }
            }
            return results;
        }

        // Get standard info
        const url = window.location ? window.location.href : '';
        const title = document.title || '';
        const bodyLen = document.body ? document.body.innerHTML.length : 0;
        const hasCascade = !!document.getElementById('cascade') || !!document.querySelector('.cascade');

        // Scan for buttons
        const allLucideElements = findAllElements('svg[class*="lucide"]').map(svg => {
            const parent = svg.closest('button, [role="button"], div, span, a');
            if (!parent || parent.offsetParent === null) return null;
            const rect = parent.getBoundingClientRect();
            return {
                type: 'lucide-icon',
                tag: parent.tagName.toLowerCase(),
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                svgClasses: getCls(svg),
                className: getCls(parent).substring(0, 100),
                ariaLabel: parent.getAttribute('aria-label') || '',
                title: parent.getAttribute('title') || '',
                parentText: (parent.innerText || '').trim().substring(0, 50)
            };
        }).filter(Boolean);

        const buttons = findAllElements('button, [role="button"]').map((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const svg = btn.querySelector('svg');

            return {
                type: 'button',
                index: i,
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                text: (btn.innerText || '').trim().substring(0, 50) || '(empty)',
                ariaLabel: btn.getAttribute('aria-label') || '',
                title: btn.getAttribute('title') || '',
                svgClasses: getCls(svg),
                className: getCls(btn).substring(0, 100),
                visible: btn.offsetParent !== null
            };
        }).filter(b => b.visible);

        return {
            url, title, bodyLen, hasCascade,
            buttons, lucideIcons: allLucideElements
        };
    } catch (e) { const err = /** @type {Error} */ (e);
        return { error: err.toString(), stack: err.stack };
    }
})()`;

        try {
            // 1. Get Frames
            const { frameTree } = await cdpConnection.call("Page.getFrameTree");
            function flattenFrames(node) {
                let list = [{
                    id: node.frame.id,
                    url: node.frame.url,
                    name: node.frame.name,
                    parentId: node.frame.parentId
                }];
                if (node.childFrames) {
                    for (const child of node.childFrames) list = list.concat(flattenFrames(child));
                }
                return list;
            }
            const allFrames = flattenFrames(frameTree);

            // 2. Map Contexts
            const contexts = cdpConnection.contexts.map(c => ({
                id: c.id,
                name: c.name,
                origin: c.origin,
                frameId: c.auxData ? c.auxData.frameId : null,
                isDefault: c.auxData ? c.auxData.isDefault : false
            }));

            // 3. Scan ALL Contexts
            const contextResults = [];
            for (const ctx of contexts) {
                try {
                    const result = await cdpConnection.call("Runtime.evaluate", {
                        expression: EXP,
                        returnByValue: true,
                        contextId: ctx.id
                    });

                    if (result.result?.value) {
                        const val = result.result.value;
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            url: val.url,
                            title: val.title,
                            hasCascade: val.hasCascade,
                            buttonCount: val.buttons.length,
                            lucideCount: val.lucideIcons.length,
                            buttons: val.buttons, // Store buttons for analysis
                            lucideIcons: val.lucideIcons
                        });
                    } else if (result.exceptionDetails) {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: `Script Exception: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''} `
                        });
                    } else {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: 'No value returned (undefined)'
                        });
                    }
                } catch (e) {
                    contextResults.push({ contextId: ctx.id, error: e.message });
                }
            }

            // 4. Match and Analyze
            const cascadeFrame = allFrames.find(f => f.url.includes('cascade'));
            const matchingContext = contextResults.find(c => c.frameId === cascadeFrame?.id);
            const contentContext = contextResults.sort((a, b) => (b.buttonCount || 0) - (a.buttonCount || 0))[0];

            // Prepare "useful buttons" from the best context
            const bestContext = matchingContext || contentContext;
            const usefulButtons = bestContext ? (bestContext.buttons || []).filter(b =>
                b.ariaLabel?.includes('New Conversation') ||
                b.title?.includes('New Conversation') ||
                b.ariaLabel?.includes('Past Conversations') ||
                b.title?.includes('Past Conversations') ||
                b.ariaLabel?.includes('History')
            ) : [];

            res.json({
                summary: {
                    frameFound: !!cascadeFrame,
                    cascadeFrameId: cascadeFrame?.id,
                    contextFound: !!matchingContext,
                    bestContextId: bestContext?.contextId
                },
                frames: allFrames,
                contexts: contexts,
                scanResults: contextResults.map(c => ({
                    id: c.contextId,
                    frameId: c.frameId,
                    url: c.url,
                    hasCascade: c.hasCascade,
                    buttons: c.buttonCount,
                    error: c.error
                })),
                usefulButtons: usefulButtons,
                bestContextData: bestContext // Full data for the best context
            });

        } catch (e) {
            res.status(500).json({ error: e.message, stack: e.stack });
        }
    });

    // WebSocket connection with Auth check
    wss.on('connection', (ws, req) => {
        // Parse cookies from headers
        const rawCookies = req.headers.cookie || '';
        const parsedCookies = {};
        rawCookies.split(';').forEach(c => {
            const [k, v] = c.trim().split('=');
            if (k && v) {
                try {
                    parsedCookies[k] = decodeURIComponent(v);
                } catch (e) {
                    parsedCookies[k] = v;
                }
            }
        });

        // Verify signed cookie manually
        const signedToken = parsedCookies[AUTH_COOKIE_NAME];
        let isAuthenticated = false;

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            isAuthenticated = true;
        } else if (signedToken) {
            const token = cookieParser.signedCookie(signedToken, COOKIE_SECRET);
            if (token === AUTH_TOKEN) {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated) {
            console.log('🚫 Unauthorized WebSocket connection attempt');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            setTimeout(() => ws.close(), 100);
            return;
        }

        console.log('📱 Client connected (Authenticated)');

        ws.send(JSON.stringify({
            type: 'terminal_state',
            state: terminalManager.getState()
        }));
        ws.send(JSON.stringify({
            type: 'screen_status',
            status: getScreencastStatus()
        }));
        ws.send(JSON.stringify({
            type: 'tunnel_status',
            status: {
                provider: tunnelProvider,
                ...getTunnelStatus()
            }
        }));
        ws.send(JSON.stringify({
            type: 'suggestion_state',
            ...getSuggestionState()
        }));
        ws.send(JSON.stringify({
            type: 'stats_state',
            stats: getStatsState()
        }));
        ws.send(JSON.stringify({
            type: 'quota_state',
            quota: getQuotaState()
        }));
        ws.send(JSON.stringify({
            type: 'timeline_state',
            timeline: getTimelineState()
        }));
        if (currentPendingAction) {
            ws.send(JSON.stringify({
                type: 'action_required',
                action: currentPendingAction,
                timestamp: new Date().toISOString()
            }));
        }

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return { server, wss, app, hasSSL };
}

// Main
async function main() {
    try {
        cdpConnection = await initCDP();
    } catch (e) { const err = /** @type {Error} */ (e);
        console.warn(`⚠️  Initial CDP discovery failed: ${err.message}`);
        console.log('💡 Start Antigravity with --remote-debugging-port=7800 to connect.');
    }

    try {
        const { server, wss, app, hasSSL } = await createServer();

        // Start background polling (it will now handle reconnections)
        startPolling(wss);

        // Remote Click
        app.post('/remote-click', async (req, res) => {
            const { selector, index, textContent, omniIndex } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await clickElement(cdpConnection, { selector, index, textContent, omniIndex });
            res.json(result);
        });

        // Multi-Window: List all available CDP targets
        app.get('/cdp-targets', async (req, res) => {
            try {
                availableTargets = await discoverAllCDP();
                if (!activeTargetId && availableTargets.length > 0) {
                    const currentMatch = cdpConnection?.ws?.url ? availableTargets.find(t => t.wsUrl === cdpConnection.ws.url) : null;
                    activeTargetId = currentMatch ? currentMatch.id : availableTargets[0].id;
                }
            } catch (_) {}
            res.json({
                targets: availableTargets,
                activeTarget: activeTargetId,
                connected: !!cdpConnection
            });
        });

        // Multi-Window: Switch to a different CDP target
        app.post('/select-target', async (req, res) => {
            const { targetId } = req.body;
            if (!targetId) return res.status(400).json({ error: 'targetId required' });

            // Refresh available targets in case new windows opened
            if (!availableTargets.some(t => t.id === targetId)) {
                try {
                    availableTargets = await discoverAllCDP();
                } catch (_) {}
            }

            const target = availableTargets.find(t => t.id === targetId);
            if (!target) return res.status(404).json({ error: 'Target not found. Refresh targets.' });

            try {
                // Close existing connection
                if (cdpConnection?.ws) {
                    await stopScreencast();
                    cdpConnection.ws.close();
                    cdpConnection = null;
                }

                console.log(`🔀 Switching to target: ${target.title} (port ${target.port})`);
                cdpConnection = await connectCDP(target.wsUrl);
                activeTargetId = targetId;
                lastSnapshot = null;
                lastSnapshotHash = null;
                console.log(`✅ Connected to: ${target.title}`);
                res.json({ success: true, target: target.title });
            } catch (e) { const err = /** @type {Error} */ (e);
                res.status(500).json({ error: `Failed to connect: ${err.message}` });
            }
        });

        // Remote Scroll - sync phone scroll to desktop
        app.post('/remote-scroll', async (req, res) => {
            const { scrollTop, scrollPercent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await remoteScroll(cdpConnection, { scrollTop, scrollPercent });
            res.json(result);
        });

        // Get App State
        app.get('/app-state', async (req, res) => {
            if (!cdpConnection) return res.json({ mode: 'Unknown', model: 'Unknown' });
            const result = await getAppState(cdpConnection);
            res.json(result);
        });

        // Start New Chat
        app.post('/new-chat', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await startNewChat(cdpConnection);
            if (result.success) {
                sessionStats.reset('new-chat');
                sessionStats.logAction('new_chat_started');
                aiSupervisor.clearAssistHistory();
            }
            res.json(result);
        });

        // Get Chat History
        app.get('/chat-history', async (req, res) => {
            if (!cdpConnection) return res.json({ error: 'CDP disconnected', chats: [] });
            const result = await getChatHistory(cdpConnection);
            res.json(result);
        });

        // Select a Chat
        app.post('/select-chat', async (req, res) => {
            const { title, chatId, id } = req.body;
            const target = title || chatId || id;
            if (!target) return res.status(400).json({ error: 'Chat title or ID required' });
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await selectChat(cdpConnection, title, chatId || id);
            if (!result.success) {
                return res.status(404).json(result);
            }

            // Invalidate stale snapshot caches immediately
            lastSnapshot = null;
            lastSnapshotHash = null;

            // Immediately capture the fresh snapshot from CDP
            try {
                const freshSnapshot = await captureSnapshot(cdpConnection);
                if (freshSnapshot && !freshSnapshot.error) {
                    lastSnapshot = freshSnapshot;
                    lastSnapshotHash = hashString(freshSnapshot.html);
                    state.setLastSnapshot(freshSnapshot);

                    // Broadcast snapshot update to all connected WebSocket clients
                    broadcast({
                        type: 'snapshot_update',
                        agentActivity: freshSnapshot.agentActivity || 'Idle',
                        isGenerating: Boolean(freshSnapshot.isGenerating),
                        timestamp: new Date().toISOString()
                    });

                    return res.json({
                        ...result,
                        snapshot: {
                            ...freshSnapshot,
                            agentActivity: freshSnapshot.agentActivity || 'Idle',
                            pendingAction: currentPendingAction
                        }
                    });
                }
            } catch (err) {
                console.warn('Post-selectChat snapshot capture error:', err);
            }

            res.json(result);
        });

        // Check if Chat is Open
        app.get('/chat-status', async (req, res) => {
            if (!cdpConnection) return res.json({ hasChat: false, hasMessages: false, editorFound: false });
            const result = await hasChatOpen(cdpConnection);
            res.json(result);
        });

        // Launch a new window
        app.post('/api/launch-window', async (req, res) => {
            try {
                const newPort = await launchAntigravity();
                // We don't automatically connect here; the polling loop will see it 
                // and the user can select it via the UI context menu.
                res.json({ success: true, port: newPort });
            } catch (e) { const err = /** @type {Error} */ (e);
                console.error('Failed to launch new window:', err);
                res.status(500).json({ error: err.message });
            }
        });

        // Kill any existing process on the port before starting
        await killPortProcess(SERVER_PORT);

        // Start server
        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        server.listen(SERVER_PORT, '0.0.0.0', () => {
            const url = `${protocol}://${localIP}:${SERVER_PORT}`;
            const ver = VERSION;

            // ANSI 256-color helpers
            const R  = '\x1b[0m';
            const B  = '\x1b[1m';
            const DIM = '\x1b[2m';
            const c1 = '\x1b[38;5;99m';
            const c2 = '\x1b[38;5;135m';
            const c3 = '\x1b[38;5;141m';
            const c4 = '\x1b[38;5;147m';
            const GR = '\x1b[38;5;82m';
            const CY = '\x1b[38;5;81m';
            const WH = '\x1b[38;5;255m';

            const line = `${c1}${B}  ${'─'.repeat(50)}${R}`;

            console.log('');
            console.log(`${c2}${B}   ██████╗ ███╗   ███╗███╗   ██╗██╗${R}`);
            console.log(`${c2}${B}  ██╔═══██╗████╗ ████║████╗  ██║██║${R}`);
            console.log(`${c3}${B}  ██║   ██║██╔████╔██║██╔██╗ ██║██║${R}`);
            console.log(`${c3}${B}  ██║   ██║██║╚██╔╝██║██║╚██╗██║██║${R}`);
            console.log(`${c4}${B}  ╚██████╔╝██║ ╚═╝ ██║██║ ╚████║██║${R}`);
            console.log(`${c4}${B}   ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝${R}`);
            console.log('');
            console.log(`  ${WH}${B}Antigravity Remote Chat${R}  ${DIM}v${ver}${R}`);
            console.log(`  ${DIM}Mobile remote control for AI sessions${R}`);
            console.log('');
            console.log(line);
            console.log('');
            console.log(`  ${GR}${B}▸${R} ${WH}${B}Server${R}     ${CY}${url}${R}`);
            console.log(`  ${GR}${B}▸${R} ${WH}${B}Protocol${R}   ${hasSSL ? `${GR}HTTPS 🔒` : 'HTTP'}${R}`);
            console.log(`  ${GR}${B}▸${R} ${WH}${B}CDP${R}        ${DIM}ports 7800-7803${R}`);
            console.log(`  ${GR}${B}▸${R} ${WH}${B}Workspace${R}  ${DIM}${workspaceRoot}${R}`);
            console.log('');
            console.log(line);
            console.log('');
            console.log(`  ${DIM}📱 Open this URL on your phone${R}`);
            console.log(`  ${DIM}🪟 Multi-window switching supported${R}`);
            console.log(`  ${DIM}⏹  Press Ctrl+C to stop${R}`);
            console.log('');

            maybeStartAutoTunnel({ tls: hasSSL, sniServerName: '127.0.0.1' });

            // Initialize Telegram bot with interactive commands
            initTelegramBot().then(active => {
                if (active) {
                    console.log(`  ${GR}${B}▸${R} ${WH}${B}Telegram${R}   ${GR}Bot active ✅${R}`);
                    registerTelegramHooks({
                        onApprove: async () => {
                            const pendingSuggestion = getLatestPendingSuggestion();
                            if (pendingSuggestion) {
                                return approveQueuedSuggestion(pendingSuggestion.id);
                            }
                            return cdpConnection ? completePendingAction(cdpConnection, 'accept') : { error: 'No CDP' };
                        },
                        onReject: async () => {
                            const pendingSuggestion = getLatestPendingSuggestion();
                            if (pendingSuggestion) {
                                return rejectQueuedSuggestion(pendingSuggestion.id);
                            }
                            return cdpConnection ? completePendingAction(cdpConnection, 'reject') : { error: 'No CDP' };
                        },
                        onStatus: () => ({
                            cdpConnected: !!(cdpConnection?.ws?.readyState === WebSocket.OPEN),
                            supervisorEnabled: aiSupervisor.enabled,
                            suggestMode: aiSupervisor.isSuggestModeEnabled(),
                            pendingSuggestions: suggestQueue.getPendingCount(),
                            model: 'via /app-state',
                            mode: 'via /app-state',
                            targetsCount: availableTargets.length,
                            uptime: process.uptime() > 3600
                                ? `${Math.floor(process.uptime()/3600)}h ${Math.floor((process.uptime()%3600)/60)}m`
                                : `${Math.floor(process.uptime()/60)}m`
                        }),
                        onStats: () => getStatsState(),
                        onQuota: () => quotaService.refresh(),
                        onScreenshot: async () => {
                            const result = await captureCurrentScreenshot({
                                format: 'jpeg',
                                quality: 70
                            });
                            if (!result.success) {
                                return { data: null };
                            }
                            sessionStats.increment('screenCaptures');
                            sessionStats.logAction('screenshot_captured');
                            return { data: result.data };
                        },
                        onSuggestionApprove: (id) => approveQueuedSuggestion(id),
                        onSuggestionReject: (id) => rejectQueuedSuggestion(id)
                    });
                }
            }).catch(() => {});
        });

        // Graceful shutdown handlers
        const gracefulShutdown = async (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            await stopScreencast();
            screenshotTimeline.stop();
            await Promise.all(Object.values(tunnelManagers).map((manager) => manager.stop()));
            await stopTelegramBot();
            wss.close(() => {
                console.log('   WebSocket server closed');
            });
            server.close(() => {
                console.log('   HTTP server closed');
            });
            if (cdpConnection?.ws) {
                cdpConnection.ws.close();
                console.log('   CDP connection closed');
            }
            setTimeout(() => process.exit(0), 1000);
        };

        process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
        process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

    } catch (e) { const err = /** @type {Error} */ (e);
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
