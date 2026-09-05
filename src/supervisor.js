// @ts-check
/**
 * Local AI supervisor backed by OmniRoute for safe auto-approvals and suggest mode.
 *
 * @module supervisor
 */

import { randomUUID } from 'crypto';
import { getSupervisorMaxQueue, getSupervisorSuggestMode } from './config.js';

const DEFAULT_BASE_URL = process.env.OMNIROUTE_SUPERVISOR_BASE_URL
    || process.env.OPENAI_BASE_URL
    || 'http://127.0.0.1:20128/v1';
const DEFAULT_MODEL = process.env.OMNIROUTE_SUPERVISOR_MODEL || 'if/kimi-k2-thinking';
const DEFAULT_API_KEY = process.env.OMNIROUTE_SUPERVISOR_API_KEY
    || process.env.OPENAI_API_KEY
    || 'sk_omniroute';
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.OMNIROUTE_SUPERVISOR_TIMEOUT_MS || '8000', 10);
const SUGGESTION_TTL_MS = 30 * 60 * 1000;

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeBaseUrl(url) {
    const trimmed = String(url || '').trim().replace(/\/+$/, '');
    if (!trimmed) return 'http://127.0.0.1:20128/v1';
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function buildChatCompletionsUrl(baseUrl) {
    return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function extractText(value) {
    if (typeof value === 'string') {
        return value.trim();
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => extractText(item))
            .filter(Boolean)
            .join(' ')
            .trim();
    }

    if (value && typeof value === 'object') {
        if ('text' in value && typeof value.text === 'string') {
            return value.text.trim();
        }

        if ('content' in value) {
            return extractText(value.content);
        }
    }

    return '';
}

/**
 * @param {any} payload
 * @returns {string}
 */
function extractCompletionText(payload) {
    const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
    const choiceText = extractText(choice?.message?.content || choice?.text || '');
    if (choiceText) return choiceText;

    const outputText = extractText(payload?.output_text || payload?.output || '');
    if (outputText) return outputText;

    return '';
}

/**
 * Extract a compact command summary from the pending-action snapshot.
 *
 * @param {string} html
 * @returns {string}
 */
export function extractPendingCommand(html) {
    const plain = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const runIndex = plain.toLowerCase().indexOf('run command');
    if (runIndex === -1) return '';

    return plain.slice(runIndex, runIndex + 700);
}

/**
 * Detects pending prompt from HTML snapshot content.
 * Supports terminal commands ('run command') and plan approvals ('proceed').
 *
 * @param {string} html
 * @returns {any | null}
 */
export function detectPendingPromptFromHtml(html) {
    if (!html) return null;

    // Check for actual button elements or role="button" with action text
    // Avoid matching conversational markdown text or transcript lists
    const hasRunBtn = /<button[^>]*>[\s\S]*?(?:run command|run)<\/button>/i.test(html) ||
                      /<(?:div|span)[^>]*?(?:role=["']button["']|class=["'][^"']*?btn[^"']*?["'])[^>]*>[\s\S]*?(?:run command|run)<\/(?:div|span)>/i.test(html);

    const hasRejectBtn = /<button[^>]*>[\s\S]*?(?:reject|deny|cancel|abort)<\/button>/i.test(html) ||
                         /<(?:div|span)[^>]*?(?:role=["']button["']|class=["'][^"']*?btn[^"']*?["'])[^>]*>[\s\S]*?(?:reject|deny|cancel|abort)<\/(?:div|span)>/i.test(html);

    // 1. Check for command approval (run command + reject/deny/cancel)
    if (hasRunBtn && hasRejectBtn) {
        let cmdText = '';
        const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/i) ||
                          html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (codeMatch && codeMatch[1]) {
            cmdText = codeMatch[1].replace(/<[^>]+>/g, '').trim();
        }
        if (!cmdText) {
            const cmdLineMatch = html.match(/CommandLine:\s*([^\n\r<]+)/i);
            if (cmdLineMatch && cmdLineMatch[1]) {
                cmdText = cmdLineMatch[1].trim();
            }
        }
        if (!cmdText) {
            cmdText = extractPendingCommand(html);
        }

        const heuristics = evaluateCommandHeuristics(cmdText);
        const cmdHash = Math.abs(cmdText.split('').reduce((a, b) => ((a << 5) + a) + b.charCodeAt(0), 5381)).toString(36);
        return {
            id: 'cmd-' + cmdHash,
            type: 'command',
            title: 'Command Execution',
            command: cmdText || 'run_command',
            riskLevel: heuristics.riskLevel || 'warning',
            riskReason: heuristics.reason,
            acceptText: 'Run command',
            rejectText: 'Reject'
        };
    }

    // 2. Check for Implementation Plan Proceed button
    const hasProceedBtn = /<button[^>]*>[\s\S]*?(?:proceed with plan|proceed)<\/button>/i.test(html) ||
                          /<(?:div|span)[^>]*?(?:role=["']button["']|class=["'][^"']*?btn[^"']*?["'])[^>]*>[\s\S]*?(?:proceed with plan|proceed)<\/(?:div|span)>/i.test(html);

    if (hasProceedBtn && /plan/i.test(html)) {
        return {
            id: 'plan-approval',
            type: 'plan',
            title: 'Plan Approval',
            summary: 'Implementation plan is ready for execution.',
            proceedText: 'Proceed with Plan',
            reviewText: 'Review',
            hasPreview: true
        };
    }

    // 3. Check for Interactive Question prompt (Submit/Continue + Skip buttons or Antigravity testids)
    const hasContinueOrSubmit = /data-testid=["']interaction-continue-button["']/i.test(html) ||
                                /<button[^>]*>[\s\S]*?(?:submit|continue)[\s\S]*?<\/button>/i.test(html) ||
                                /<(?:div|span)[^>]*?(?:role=["']button["'])[^>]*>[\s\S]*?(?:submit|continue)[\s\S]*?<\/(?:div|span)>/i.test(html);
    const hasSkip = /data-testid=["']interaction-skip-button["']/i.test(html) ||
                    /<button[^>]*>[\s\S]*?skip[\s\S]*?<\/button>/i.test(html) ||
                    /<(?:div|span)[^>]*?(?:role=["']button["'])[^>]*>[\s\S]*?skip[\s\S]*?<\/(?:div|span)>/i.test(html);

    if (hasContinueOrSubmit && hasSkip) {
        let questionTitle = 'Interactive Decision';
        const titleMatch = html.match(/<div[^>]*class=["'][^"']*?text-sm[^"']*?["'][^>]*>([\s\S]*?)<\/div>/i) ||
                           html.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i) ||
                           html.match(/<p[^>]*class=["'][^"']*?question[^"']*?["'][^>]*>([\s\S]*?)<\/p>/i);
        if (titleMatch && titleMatch[1]) {
            questionTitle = titleMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        const counterMatch = html.match(/\b\d+\s+of\s+\d+\b/i);
        if (counterMatch) {
            questionTitle = `[${counterMatch[0]}] ${questionTitle}`;
        }

        const isMulti = /checkbox/i.test(html) || /multi-select/i.test(html);
        const hasWriteIn = /__write_in__/i.test(html) || /<textarea/i.test(html);

        const qHash = Math.abs(questionTitle.split('').reduce((a, b) => ((a << 5) + a) + b.charCodeAt(0), 5381)).toString(36);

        const continueBtnMatch = html.match(/data-testid=["']interaction-continue-button["'][^>]*>([\s\S]*?)<\/button>/i) ||
                                 html.match(/<button[^>]*>([\s\S]*?(?:submit|continue)[\s\S]*?)<\/button>/i);
        let submitText = 'Submit';
        if (continueBtnMatch && continueBtnMatch[1]) {
            const raw = continueBtnMatch[1].replace(/<[^>]+>/g, '').replace(/[↵\r\n]/g, '').trim();
            if (/continue/i.test(raw)) submitText = 'Continue';
            else if (/submit/i.test(raw)) submitText = 'Submit';
        }

        return {
            id: 'question-' + qHash,
            type: 'question',
            title: questionTitle,
            isMultiSelect: isMulti,
            options: [],
            hasWriteIn: hasWriteIn,
            submitText: submitText,
            skipText: 'Skip'
        };
    }

    return null;
}

/**

 * Conservative heuristic gate. If it says "unsafe", we do not auto-approve
 * even if the LLM is optimistic.
 *
 * @param {string} commandText
 * @returns {{safe: boolean, reason: string}}
 */
export function evaluateCommandHeuristics(commandText) {
    const sample = commandText.toLowerCase();
    const riskyPatterns = [
        /\brm\b/,
        /\bdel\b/,
        /\bshutdown\b/,
        /\breboot\b/,
        /\bkill\b/,
        /\bmkfs\b/,
        /\bformat\b/,
        /\bsudo\b/,
        /\bchmod\b/,
        /\bchown\b/,
        /\bpush\b/,
        /\bpublish\b/,
        /\bdeploy\b/,
        /\bcurl\b.*\|/,
        /\bwget\b.*\|/,
        />\s*\/dev\//,
        /\bgit\s+reset\b/,
        /\bgit\s+clean\b/,
        /\bgit\s+force-push\b/,
        /\bgit\s+push\s+--force\b/,
        /\bdrop\s+table\b/,
        /\bdd\s+if=/,
        /\btruncate\b/,
        /\bmkswap\b/,
        /\bswapon\b/,
        /\biptables\b/,
        /\bsystemctl\s+(stop|disable|mask)\b/,
        /\bdocker\s+(rm|rmi)\b/,
        /\bpip\s+install.*--system\b/,
        /\bnpx?\s+.*\|\s*sh\b/
    ];

    if (riskyPatterns.some((pattern) => pattern.test(sample))) {
        return { safe: false, reason: 'heuristic-risky-command', riskLevel: 'critical' };
    }

    const safePatterns = [
        /\bgit\s+status\b/,
        /\bgit\s+diff\b/,
        /\bgit\s+log\b/,
        /\bgit\s+show\b/,
        /\bnpm\s+test\b/,
        /\bnpm\s+run\s+(lint|test|check|build)\b/,
        /\bpnpm\s+(lint|test|check|build)\b/,
        /\byarn\s+(lint|test|check|build)\b/,
        /\bpytest\b/,
        /\bruff\b/,
        /\bmypy\b/,
        /\bls\b/,
        /\bcat\b/,
        /\bsed\b/,
        /\bnode\s+--check\b/,
        /\bnode\s+-e\b/,
        /\btsc\s+--noEmit\b/,
        /\bnpx\s+tsc\b/,
        /\bhead\b/,
        /\btail\b/,
        /\bwc\b/,
        /\bdu\b/,
        /\bdf\b/,
        /\bpwd\b/,
        /\becho\b/,
        /\bfile\b/,
        /\bwhich\b/,
        /\bfind\b.*-name\b/,
        /\bgrep\b/
    ];

    if (safePatterns.some((pattern) => pattern.test(sample))) {
        return { safe: true, reason: 'heuristic-safe-command', riskLevel: 'safe' };
    }

    return { safe: false, reason: 'heuristic-unknown-command', riskLevel: 'warning' };
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeCommandSignature(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 320);
}

/**
 * @param {any[]} history
 * @param {number} maxItems
 * @returns {any[]}
 */
function trimConversation(history, maxItems = 12) {
    if (!Array.isArray(history) || history.length <= maxItems) {
        return Array.isArray(history) ? history.slice() : [];
    }
    return history.slice(-maxItems);
}

/**
 * @param {Record<string, any>} quota
 * @returns {string}
 */
function summarizeTopQuotaModel(quota) {
    if (!quota?.available || !Array.isArray(quota.models) || !quota.models.length) {
        return 'Quota data is currently unavailable.';
    }

    const top = quota.models[0];
    return `${top.name} is currently the hottest model at ${top.usagePercent}% used.`;
}

/**
 * @param {string} message
 * @param {Record<string, any>} context
 * @returns {string}
 */
function buildLocalAssistReply(message, context = {}) {
    const lower = String(message || '').toLowerCase();
    const stats = context.stats || {};
    const metrics = stats.metrics || {};
    const quota = context.quota || {};
    const pendingSuggestions = Number(context.pendingSuggestions || 0);
    const suggestions = Array.isArray(context.suggestions) ? context.suggestions : [];
    const latestSuggestion = suggestions[0] || null;
    const lastError = Array.isArray(stats.lastErrors) ? stats.lastErrors[0] : null;
    const lines = [];

    if (
        /status|summary|overview|session|what('?s| is) happening/.test(lower) ||
        !lower.trim()
    ) {
        lines.push(
            `Session uptime: ${stats.uptime || 'unknown'}. Messages sent: ${metrics.messagesSent || 0}. Approved actions: ${metrics.actionsApproved || 0}. Errors detected: ${metrics.errorsDetected || 0}.`
        );
    }

    if (/suggest|approve|reject|pending/.test(lower) || pendingSuggestions > 0) {
        lines.push(`Pending suggestions: ${pendingSuggestions}.`);
        if (latestSuggestion) {
            lines.push(
                `Latest suggestion: ${latestSuggestion.action} "${latestSuggestion.command}".`
            );
        }
        if (pendingSuggestions > 0) {
            lines.push('[ACTION:suggestions]');
            lines.push('[ACTION:approve]');
            lines.push('[ACTION:reject]');
        }
    }

    if (/quota|limit|model/.test(lower) || quota?.available) {
        lines.push(summarizeTopQuotaModel(quota));
        if (quota?.criticalModels > 0) {
            lines.push(`${quota.criticalModels} model(s) are above 80% usage.`);
        }
        lines.push('[ACTION:quota]');
    }

    if (/error|problem|failed|broken|warning/.test(lower)) {
        if (lastError) {
            lines.push(
                `Latest error: ${lastError.type} at ${new Date(lastError.timestamp).toLocaleTimeString()} — ${lastError.message}.`
            );
        } else {
            lines.push('No recent errors are recorded in the current session.');
        }
        lines.push('[ACTION:stats]');
    }

    if (/screen|screenshot/.test(lower)) {
        lines.push('You can open the live screen stream from the workspace.');
        lines.push('[ACTION:screenshot]');
    }

    if (!lines.length) {
        lines.push(
            'I can summarize session stats, quota usage, and pending supervisor suggestions. Ask for stats, quota, or suggestions to inspect the current session.'
        );
        if (pendingSuggestions > 0) {
            lines.push('[ACTION:suggestions]');
        }
        if (quota?.available) {
            lines.push('[ACTION:quota]');
        }
        lines.push('[ACTION:stats]');
    }

    return lines.join('\n\n').trim();
}

/**
 * @param {string} text
 * @param {Record<string, any>} context
 * @returns {{reply: string, actions: {type: string, label: string}[]}}
 */
function extractAssistActions(text, context = {}) {
    const matches = Array.from(String(text || '').matchAll(/\[ACTION:([a-z_]+)\]/gi));
    const actions = [];
    const seen = new Set();
    const pendingSuggestions = Number(context.pendingSuggestions || 0);

    const pushAction = (type, label) => {
        if (!type || seen.has(type)) return;
        seen.add(type);
        actions.push({ type, label });
    };

    for (const match of matches) {
        const tag = String(match[1] || '').toLowerCase();
        if ((tag === 'approve' || tag === 'reject') && pendingSuggestions <= 0) {
            continue;
        }

        if (tag === 'approve') {
            pushAction('approve_suggestion', 'Approve latest suggestion');
        } else if (tag === 'reject') {
            pushAction('reject_suggestion', 'Reject latest suggestion');
        } else if (tag === 'suggestions') {
            pushAction('show_suggestions', 'Open suggestions');
        } else if (tag === 'quota') {
            pushAction('refresh_quota', 'Refresh quota');
        } else if (tag === 'stats') {
            pushAction('open_stats', 'Open stats');
        } else if (tag === 'screenshot') {
            pushAction('open_screen', 'Open screen stream');
        }
    }

    const reply = String(text || '')
        .replace(/\[ACTION:[^\]]+\]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return {
        reply: reply || 'No additional context available.',
        actions
    };
}

/**
 * @param {InternalSuggestionItem} item
 * @returns {SuggestionItem}
 */
function toSuggestionItem(item) {
    const { signature, ...rest } = item;
    void signature;
    return { ...rest };
}

/**
 * @typedef {object} SuggestionItem
 * @property {string} id
 * @property {'accept' | 'reject'} action
 * @property {string} command
 * @property {string} reason
 * @property {string} source
 * @property {string} summary
 * @property {string} timestamp
 * @property {string} expiresAt
 * @property {'pending' | 'approved' | 'rejected' | 'expired'} status
 * @property {string} [updatedAt]
 */

/**
 * @typedef {SuggestionItem & {signature: string}} InternalSuggestionItem
 */

export class SuggestQueue {
    /**
     * @param {{maxSize?: number, ttlMs?: number}} [options]
     */
    constructor(options = {}) {
        this.queue = /** @type {InternalSuggestionItem[]} */ ([]);
        this.listeners = new Set();
        this.maxSize = Number.isFinite(options?.maxSize) && (options?.maxSize || 0) > 0
            ? /** @type {number} */ (options.maxSize)
            : getSupervisorMaxQueue();
        this.ttlMs = Number.isFinite(options?.ttlMs) && (options?.ttlMs || 0) > 0
            ? /** @type {number} */ (options.ttlMs)
            : SUGGESTION_TTL_MS;
    }

    syncConfig() {
        this.maxSize = getSupervisorMaxQueue();
    }

    pruneExpired() {
        this.syncConfig();
        const now = Date.now();
        for (const item of this.queue) {
            if (item.status !== 'pending') continue;
            if (Date.parse(item.expiresAt) > now) continue;
            item.status = 'expired';
            item.updatedAt = new Date(now).toISOString();
            this.notify('expired', item);
        }
    }

    trimToMaxSize() {
        this.syncConfig();
        while (this.queue.length > this.maxSize) {
            const removed = this.queue.shift();
            if (!removed) break;
            this.notify('dropped', removed);
        }
    }

    /**
     * @param {{action: 'accept' | 'reject', command: string, reason: string, source?: string, summary?: string}} suggestion
     * @returns {{suggestion: SuggestionItem, created: boolean}}
     */
    add(suggestion) {
        this.pruneExpired();
        const signature = normalizeCommandSignature(suggestion.command);
        const existing = this.queue.find((item) => item.status === 'pending' && item.signature === signature);
        if (existing) {
            return { suggestion: toSuggestionItem(existing), created: false };
        }

        const now = new Date();
        const item = /** @type {InternalSuggestionItem} */ ({
            id: randomUUID(),
            action: suggestion.action,
            command: String(suggestion.command || ''),
            reason: String(suggestion.reason || 'manual-review'),
            source: String(suggestion.source || 'supervisor'),
            summary: String(suggestion.summary || ''),
            timestamp: now.toISOString(),
            expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
            status: 'pending',
            signature
        });

        this.queue.push(item);
        this.trimToMaxSize();
        this.notify('added', item);
        return { suggestion: toSuggestionItem(item), created: true };
    }

    /**
     * @param {string} id
     * @returns {SuggestionItem | null}
     */
    approve(id) {
        this.pruneExpired();
        const item = this.queue.find((entry) => entry.id === id && entry.status === 'pending');
        if (!item) return null;
        item.status = 'approved';
        item.updatedAt = new Date().toISOString();
        this.notify('approved', item);
        return toSuggestionItem(item);
    }

    /**
     * @param {string} id
     * @returns {SuggestionItem | null}
     */
    reject(id) {
        this.pruneExpired();
        const item = this.queue.find((entry) => entry.id === id && entry.status === 'pending');
        if (!item) return null;
        item.status = 'rejected';
        item.updatedAt = new Date().toISOString();
        this.notify('rejected', item);
        return toSuggestionItem(item);
    }

    /**
     * @param {string} id
     * @returns {SuggestionItem | null}
     */
    find(id) {
        this.pruneExpired();
        const item = this.queue.find((entry) => entry.id === id);
        return item ? toSuggestionItem(item) : null;
    }

    /**
     * @param {string} command
     * @returns {boolean}
     */
    hasPendingCommand(command) {
        this.pruneExpired();
        const signature = normalizeCommandSignature(command);
        return this.queue.some((item) => item.status === 'pending' && item.signature === signature);
    }

    /**
     * @returns {SuggestionItem[]}
     */
    getAll() {
        this.pruneExpired();
        return this.queue
            .slice()
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
            .map((item) => toSuggestionItem(item));
    }

    /**
     * @returns {SuggestionItem[]}
     */
    getPending() {
        this.pruneExpired();
        return this.queue
            .filter((item) => item.status === 'pending')
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
            .map((item) => toSuggestionItem(item));
    }

    /**
     * @returns {number}
     */
    getPendingCount() {
        this.pruneExpired();
        return this.queue.filter((item) => item.status === 'pending').length;
    }

    /**
     * @returns {number}
     */
    clear() {
        const count = this.queue.length;
        this.queue = [];
        this.notify('cleared', { count });
        return count;
    }

    /**
     * @param {(event: string, payload: any) => void} listener
     * @returns {() => void}
     */
    subscribe(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * @param {string} event
     * @param {any} payload
     */
    notify(event, payload) {
        for (const listener of this.listeners) {
            try {
                listener(event, payload);
            } catch (_) {
                // Listener failures should not break the queue.
            }
        }
    }
}

export const suggestQueue = new SuggestQueue();

export class AISupervisor {
    constructor() {
        this.provider = 'omniroute';
        this.enabled = String(
            process.env.OMNIROUTE_SUPERVISOR_ENABLED || process.env.OLLAMA_SUPERVISOR_ENABLED || ''
        ).toLowerCase() === 'true';
        this.baseUrl = normalizeBaseUrl(DEFAULT_BASE_URL);
        this.url = buildChatCompletionsUrl(this.baseUrl);
        this.model = DEFAULT_MODEL;
        this.apiKey = DEFAULT_API_KEY;
        this.timeoutMs = Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0
            ? DEFAULT_TIMEOUT_MS
            : 8000;
        this.assistHistory = [];
    }

    isSuggestModeEnabled() {
        return getSupervisorSuggestMode();
    }

    /**
     * @returns {{enabled: boolean, provider: string, baseUrl: string, url: string, model: string, timeoutMs: number, suggestMode: boolean, pendingSuggestions: number, suggestionQueueSize: number, suggestionQueueMax: number}}
     */
    getStatus() {
        suggestQueue.syncConfig();
        return {
            enabled: this.enabled,
            provider: this.provider,
            baseUrl: this.baseUrl,
            url: this.url,
            model: this.model,
            timeoutMs: this.timeoutMs,
            suggestMode: this.isSuggestModeEnabled(),
            pendingSuggestions: suggestQueue.getPendingCount(),
            suggestionQueueSize: suggestQueue.getAll().length,
            suggestionQueueMax: getSupervisorMaxQueue()
        };
    }

    getAssistHistory() {
        return this.assistHistory.map((item) => ({ ...item }));
    }

    clearAssistHistory() {
        this.assistHistory = [];
    }

    /**
     * @param {string} commandText
     * @returns {Promise<{approved: boolean, source: string, reason: string, commandText: string}>}
     */
    async requestRemoteDecision(commandText) {
        const response = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            signal: AbortSignal.timeout(this.timeoutMs),
            body: JSON.stringify({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: [
                            'Voce e um supervisor local extremamente conservador.',
                            'Responda apenas com APPROVE ou DENY.',
                            'Aprovacao so eh permitida para comandos claramente de leitura, lint, teste ou diff.',
                            'Se houver qualquer ambiguidade, responda DENY.'
                        ].join(' ')
                    },
                    {
                        role: 'user',
                        content: [
                            'Resumo do pedido pendente:',
                            commandText || '(sem contexto textual disponivel)'
                        ].join('\n')
                    }
                ],
                temperature: 0,
                max_tokens: 12,
                stream: false
            })
        });

        if (!response.ok) {
            const details = await response.text().catch(() => '');
            const summary = details ? `: ${details.slice(0, 240)}` : '';
            throw new Error(`OmniRoute supervisor request failed with status ${response.status}${summary}`);
        }

        const result = await response.json();
        const text = extractCompletionText(result).toUpperCase();
        const approved = text.startsWith('APPROVE');

        return {
            approved,
            source: 'omniroute',
            reason: approved ? 'omniroute-approved' : 'omniroute-denied',
            commandText
        };
    }

    /**
     * @param {any[]} messages
     * @returns {Promise<string>}
     */
    async requestChatResponse(messages) {
        const response = await fetch(this.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            signal: AbortSignal.timeout(this.timeoutMs),
            body: JSON.stringify({
                model: this.model,
                messages,
                temperature: 0.3,
                max_tokens: 400,
                stream: false
            })
        });

        if (!response.ok) {
            const details = await response.text().catch(() => '');
            const summary = details ? `: ${details.slice(0, 240)}` : '';
            throw new Error(`OmniRoute assist request failed with status ${response.status}${summary}`);
        }

        const result = await response.json();
        const text = extractCompletionText(result);
        if (!text) {
            throw new Error('OmniRoute assist response was empty');
        }
        return text;
    }

    /**
     * @param {{html: string}} payload
     * @returns {Promise<{approved: boolean, source: string, reason: string, commandText: string}>}
     */
    async shouldApprove(payload) {
        const commandText = extractPendingCommand(payload.html);
        const heuristic = evaluateCommandHeuristics(commandText);

        if (!this.enabled) {
            return {
                approved: false,
                source: 'disabled',
                reason: 'supervisor-disabled',
                commandText
            };
        }

        if (!heuristic.safe) {
            return {
                approved: false,
                source: 'heuristic',
                reason: heuristic.reason,
                commandText
            };
        }

        return this.requestRemoteDecision(commandText);
    }

    /**
     * @param {{html: string}} payload
     * @returns {Promise<{approved: boolean, suggestedAction: 'accept' | 'reject', source: string, reason: string, commandText: string, summary: string}>}
     */
    async reviewPendingAction(payload) {
        const commandText = extractPendingCommand(payload.html);
        const heuristic = evaluateCommandHeuristics(commandText);

        if (!heuristic.safe) {
            return {
                approved: false,
                suggestedAction: 'reject',
                source: 'heuristic',
                reason: heuristic.reason,
                commandText,
                summary: 'Supervisor recommends rejecting this pending action.'
            };
        }

        if (!this.enabled) {
            return {
                approved: true,
                suggestedAction: 'accept',
                source: 'heuristic',
                reason: heuristic.reason,
                commandText,
                summary: 'Supervisor is disabled, but heuristics classify this command as safe to approve.'
            };
        }

        try {
            const decision = await this.requestRemoteDecision(commandText);
            return {
                ...decision,
                suggestedAction: decision.approved ? 'accept' : 'reject',
                summary: decision.approved
                    ? 'Supervisor recommends approving this pending action.'
                    : 'Supervisor recommends rejecting this pending action.'
            };
        } catch (error) {
            return {
                approved: false,
                suggestedAction: 'reject',
                source: 'omniroute',
                reason: 'supervisor-error',
                commandText,
                summary: `Supervisor failed to analyze the action: ${(/** @type {Error} */ (error)).message}`
            };
        }
    }

    /**
     * @param {string} message
     * @param {Record<string, any>} context
     * @returns {Promise<{reply: string, actions: {type: string, label: string}[], source: string, history: any[]}>}
     */
    async chatWithUser(message, context = {}) {
        const userMessage = String(message || '').trim();
        if (!userMessage) {
            return {
                reply: 'Please send a message for the supervisor.',
                actions: [],
                source: 'local',
                history: this.getAssistHistory()
            };
        }

        const userEntry = {
            role: 'user',
            content: userMessage,
            timestamp: new Date().toISOString()
        };
        this.assistHistory.push(userEntry);

        let rawReply = '';
        let source = 'local';

        if (this.enabled) {
            try {
                const stats = context.stats || {};
                const metrics = stats.metrics || {};
                const systemPrompt = [
                    'You are the OmniAntigravity supervisor.',
                    'Help the user understand the current remote session and suggest safe next steps.',
                    'Respond concisely and pragmatically.',
                    'When suggesting an action, use one or more tags on separate lines using exactly:',
                    '[ACTION:approve] [ACTION:reject] [ACTION:suggestions] [ACTION:quota] [ACTION:stats] [ACTION:screenshot]',
                    'Only use approve/reject if there are pending suggestions.',
                    `Session uptime: ${stats.uptime || 'unknown'}.`,
                    `Messages sent: ${metrics.messagesSent || 0}.`,
                    `Approved actions: ${metrics.actionsApproved || 0}.`,
                    `Rejected actions: ${metrics.actionsRejected || 0}.`,
                    `Pending suggestions: ${context.pendingSuggestions || 0}.`,
                    `Quota summary: ${summarizeTopQuotaModel(context.quota)}`
                ].join(' ');

                rawReply = await this.requestChatResponse([
                    { role: 'system', content: systemPrompt },
                    ...trimConversation(this.assistHistory).map((entry) => ({
                        role: entry.role,
                        content: entry.content
                    }))
                ]);
                source = 'omniroute';
            } catch (error) {
                rawReply = [
                    buildLocalAssistReply(userMessage, context),
                    '',
                    `Remote supervisor unavailable: ${(/** @type {Error} */ (error)).message}`
                ].join('\n').trim();
                source = 'fallback';
            }
        } else {
            rawReply = buildLocalAssistReply(userMessage, context);
        }

        const parsed = extractAssistActions(rawReply, context);
        const assistantEntry = {
            role: 'assistant',
            content: parsed.reply,
            actions: parsed.actions,
            source,
            timestamp: new Date().toISOString()
        };

        this.assistHistory.push(assistantEntry);
        this.assistHistory = trimConversation(this.assistHistory, 20);

        return {
            reply: parsed.reply,
            actions: parsed.actions,
            source,
            history: this.getAssistHistory()
        };
    }
}

export const aiSupervisor = new AISupervisor();
