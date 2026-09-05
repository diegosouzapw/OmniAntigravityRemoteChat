// @ts-check
/**
 * Model quota service backed by the local Antigravity language server.
 *
 * The service discovers running language_server processes, probes their HTTPS
 * status endpoint, normalizes the quota payload, and caches the latest result
 * for the mobile UI, Telegram, and background alerts.
 *
 * @module quota-service
 */

import fs from 'fs/promises';
import https from 'https';
import os from 'os';
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { getQuotaEnabled, getQuotaPollInterval } from './config.js';

const execFileAsync = promisify(execFile);
const API_ENDPOINT =
  '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const CSRF_HEADER = 'x-codeium-csrf-token';
const REQUEST_TIMEOUT_MS = 4000;

export const MODEL_NAMES = {
  MODEL_PLACEHOLDER_M12: 'Claude Opus 4.6',
  MODEL_PLACEHOLDER_M16: 'Gemini 3.1 Pro (High)',
  MODEL_PLACEHOLDER_M18: 'Gemini 3 Flash',
  MODEL_PLACEHOLDER_M26: 'Claude Opus 4.6 (Thinking)',
  MODEL_PLACEHOLDER_M35: 'Claude Sonnet 4.6 (Thinking)',
  MODEL_PLACEHOLDER_M36: 'Gemini 3.1 Pro (Low)',
  MODEL_PLACEHOLDER_M37: 'Gemini 3.1 Pro (High)',
  MODEL_PLACEHOLDER_M47: 'Gemini 3 Flash',
  MODEL_PLACEHOLDER_M71: 'Gemini 3.6 Flash (High)',
  MODEL_PLACEHOLDER_M72: 'Gemini 3.6 Flash (Medium)',
  MODEL_PLACEHOLDER_M73: 'Gemini 3.6 Flash (Low)',
  MODEL_PLACEHOLDER_M298: 'Gemini 3.7 Flash (High)',
  MODEL_PLACEHOLDER_M299: 'Gemini 3.7 Flash (Medium)',
  MODEL_PLACEHOLDER_M300: 'Gemini 3.7 Flash (Low)',
  MODEL_PLACEHOLDER_M318: 'Gemini 3.8 Flash (High)',
  MODEL_PLACEHOLDER_M319: 'Gemini 3.8 Flash (Medium)',
  MODEL_PLACEHOLDER_M320: 'Gemini 3.8 Flash (Low)',
  MODEL_CLAUDE_4_5_SONNET: 'Claude Sonnet 4.6',
  MODEL_CLAUDE_4_5_SONNET_THINKING: 'Claude Sonnet 4.6 (Thinking)',
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: 'GPT-OSS 120B (Medium)',
};

function clampPercentage(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildStatusLabel(usagePercent) {
  if (usagePercent >= 80) return 'critical';
  if (usagePercent >= 60) return 'warning';
  return 'ok';
}

export function buildQuotaBar(usagePercent, width = 10) {
  const safeWidth = Math.max(1, width);
  const safePercent = clampPercentage(usagePercent);
  const filled = Math.round((safePercent / 100) * safeWidth);
  return `${'▓'.repeat(filled)}${'░'.repeat(safeWidth - filled)}`;
}

export function normalizeModelName(modelId, fallbackLabel = '') {
  if (fallbackLabel) return fallbackLabel;
  if (MODEL_NAMES[modelId]) return MODEL_NAMES[modelId];
  return String(modelId || 'Unknown model')
    .replace(/^MODEL_/, '')
    .replaceAll('_', ' ')
    .trim();
}

function readFlagValue(commandLine, flag) {
  const match = String(commandLine || '').match(
    new RegExp(`(?:^|\\s)${flag}\\s+([^\\s]+)`)
  );
  return match ? match[1] : '';
}

export function parseLanguageServerCommand(commandLine) {
  const command = String(commandLine || '').trim();
  const pidMatch = command.match(/^\s*(\d+)\s+/);
  const pid = pidMatch ? Number.parseInt(pidMatch[1], 10) : NaN;
  const line = pidMatch ? command.slice(pidMatch[0].length) : command;

  return {
    pid: Number.isFinite(pid) ? pid : null,
    commandLine: line,
    csrfToken: readFlagValue(line, '--csrf_token'),
    extensionServerPort: asNumber(
      readFlagValue(line, '--extension_server_port'),
      0
    ),
    extensionServerCsrfToken: readFlagValue(line, '--extension_server_csrf_token'),
    workspaceId: readFlagValue(line, '--workspace_id'),
    appDataDir: readFlagValue(line, '--app_data_dir'),
  };
}

function parseListeningPort(line) {
  const match = String(line).match(/:(\d+)\s+/);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function listProcessesLinux() {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args=']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /language_server/i.test(line))
    .map((line) => parseLanguageServerCommand(line))
    .filter((entry) => entry.pid);
}

async function listProcessesWindows() {
  const script = [
    '$items = Get-CimInstance Win32_Process |',
    "  Where-Object { $_.CommandLine -match 'language_server' } |",
    '  Select-Object ProcessId, CommandLine',
    '$items | ConvertTo-Json -Compress',
  ].join(' ');
  const { stdout } = await execFileAsync('powershell', [
    '-NoProfile',
    '-Command',
    script,
  ]);
  if (!stdout.trim()) return [];
  const payload = JSON.parse(stdout);
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map((item) =>
    parseLanguageServerCommand(`${item.ProcessId || ''} ${item.CommandLine || ''}`)
  );
}

export async function discoverLanguageServerProcesses() {
  if (process.platform === 'win32') {
    return listProcessesWindows();
  }
  return listProcessesLinux();
}

async function getListeningPortsForPid(pid) {
  if (!pid) return [];

  if (process.platform === 'win32') {
    const script = [
      `Get-NetTCPConnection -OwningProcess ${pid} -State Listen |`,
      '  Select-Object -ExpandProperty LocalPort |',
      '  ConvertTo-Json -Compress',
    ].join(' ');
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile',
      '-Command',
      script,
    ]);
    if (!stdout.trim()) return [];
    const payload = JSON.parse(stdout);
    const ports = (Array.isArray(payload) ? payload : [payload]).map((value) =>
      Number.parseInt(String(value), 10)
    );
    return [...new Set(ports.filter(Number.isFinite))].sort((a, b) => a - b);
  }

  let ports = [];

  try {
    const { stdout } = await execFileAsync('ss', ['-ltnp']);
    ports = stdout
      .split('\n')
      .filter((line) => line.includes(`pid=${pid}`))
      .map((line) => parseListeningPort(line))
      .filter((value) => Number.isFinite(value));
  } catch (_) {
    const { stdout } = await execFileAsync('lsof', [
      '-Pan',
      '-p',
      String(pid),
      '-iTCP',
      '-sTCP:LISTEN',
    ]);
    ports = stdout
      .split('\n')
      .map((line) => parseListeningPort(line))
      .filter((value) => Number.isFinite(value));
  }

  return [...new Set(ports)].sort((a, b) => a - b);
}

export function getCsrfTokenCandidatePaths() {
  return [
    join(os.homedir(), '.antigravity', 'data', 'machineid'),
    join(os.homedir(), '.config', 'Antigravity', 'User', 'machineid'),
    join(os.homedir(), 'AppData', 'Roaming', 'Antigravity', 'User', 'machineid'),
  ];
}

export async function extractFallbackCsrfToken() {
  for (const filePath of getCsrfTokenCandidatePaths()) {
    try {
      const value = await fs.readFile(filePath, 'utf8');
      const token = value.trim();
      if (token) return token;
    } catch (_) {
      // Ignore missing files and keep scanning.
    }
  }

  return '';
}

export async function fetchQuotaPayload(port, csrfToken) {
  const payload = JSON.stringify({});

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: '127.0.0.1',
        port,
        method: 'POST',
        path: API_ENDPOINT,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          [CSRF_HEADER]: csrfToken,
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if ((response.statusCode || 500) >= 400) {
            const error = new Error(
              `Quota request failed (${response.statusCode}): ${body || 'No response body'}`
            );
            error.statusCode = response.statusCode;
            reject(error);
            return;
          }

          try {
            resolve(JSON.parse(body || '{}'));
          } catch (error) {
            reject(
              new Error(
                `Quota response could not be parsed as JSON: ${error.message}`
              )
            );
          }
        });
      }
    );

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Quota request timed out'));
    });
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

function normalizeCreditBucket(label, available, monthly) {
  const max = asNumber(monthly, 0);
  const remaining = asNumber(available, 0);
  if (max <= 0) return null;
  const used = Math.max(0, max - remaining);
  const usagePercent = clampPercentage(Math.round((used / max) * 100));
  return {
    label,
    available: remaining,
    monthly: max,
    used,
    usagePercent,
    remainingPercent: clampPercentage(100 - usagePercent),
  };
}

export function normalizeQuotaPayload(payload, meta = {}) {
  const now = new Date().toISOString();
  const userStatus = payload?.userStatus || {};
  const planStatus = userStatus.planStatus || {};
  const planInfo = planStatus.planInfo || {};
  const cascadeData = userStatus.cascadeModelConfigData || {};
  const modelConfigs = Array.isArray(cascadeData.clientModelConfigs)
    ? cascadeData.clientModelConfigs
    : [];

  const models = modelConfigs
    .map((config) => {
      const quotaInfo = config?.quotaInfo || {};
      const rawModelId =
        config?.modelOrAlias?.model ||
        config?.modelOrAlias?.alias ||
        config?.label ||
        'UNKNOWN_MODEL';
      const remainingFraction = Math.max(
        0,
        Math.min(1, asNumber(quotaInfo.remainingFraction, 1))
      );
      const remainingPercent = clampPercentage(
        Math.round(remainingFraction * 100)
      );
      const usagePercent = clampPercentage(100 - remainingPercent);
      const label = normalizeModelName(rawModelId, config?.label || '');

      return {
        id: rawModelId,
        name: label,
        label,
        usagePercent,
        remainingPercent,
        used: usagePercent,
        limit: 100,
        status: buildStatusLabel(usagePercent),
        resetTime: quotaInfo.resetTime || '',
        recommended: Boolean(config?.isRecommended),
        supportsImages: Boolean(config?.supportsImages),
        bar: buildQuotaBar(usagePercent),
      };
    })
    .sort((left, right) => right.usagePercent - left.usagePercent);

  const criticalModels = models.filter(
    (model) => model.status === 'critical'
  ).length;
  const warningModels = models.filter(
    (model) => model.status === 'warning'
  ).length;
  const promptCredits = normalizeCreditBucket(
    'Prompt credits',
    planStatus.availablePromptCredits,
    planInfo.monthlyPromptCredits
  );
  const flowCredits = normalizeCreditBucket(
    'Flow credits',
    planStatus.availableFlowCredits,
    planInfo.monthlyFlowCredits
  );

  return {
    enabled: Boolean(meta.enabled),
    available: true,
    source: 'language-server',
    pid: meta.pid || null,
    port: meta.port || null,
    workspaceId: meta.workspaceId || '',
    user: {
      name: userStatus.name || '',
      email: userStatus.email || '',
      planName: planInfo.planName || '',
      teamTier: planInfo.teamsTier || '',
    },
    credits: {
      prompt: promptCredits,
      flow: flowCredits,
    },
    models,
    totalModels: models.length,
    criticalModels,
    warningModels,
    highestUsagePercent: models[0]?.usagePercent || 0,
    lastUpdated: now,
    alerts: [],
    error: '',
  };
}

function buildUnavailableSummary(error = 'Quota service unavailable') {
  return {
    enabled: getQuotaEnabled(),
    available: false,
    source: 'language-server',
    pid: null,
    port: null,
    workspaceId: '',
    user: {
      name: '',
      email: '',
      planName: '',
      teamTier: '',
    },
    credits: {
      prompt: null,
      flow: null,
    },
    models: [],
    totalModels: 0,
    criticalModels: 0,
    warningModels: 0,
    highestUsagePercent: 0,
    lastUpdated: new Date().toISOString(),
    alerts: [],
    error,
  };
}

export class QuotaService {
  constructor() {
    this.listeners = new Set();
    this.pollTimer = null;
    this.lastSummary = buildUnavailableSummary('Quota data not fetched yet');
    this.alertedModelKeys = new Set();
    this.refreshInFlight = null;
  }

  isEnabled() {
    return getQuotaEnabled();
  }

  getPollInterval() {
    return getQuotaPollInterval();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event, payload) {
    for (const listener of this.listeners) {
      try {
        listener(event, payload);
      } catch (_) {
        // Quota listeners must never break the main process.
      }
    }
  }

  getSummary() {
    return {
      ...this.lastSummary,
      alerts: Array.isArray(this.lastSummary.alerts)
        ? this.lastSummary.alerts.map((alert) => ({ ...alert }))
        : [],
      models: Array.isArray(this.lastSummary.models)
        ? this.lastSummary.models.map((model) => ({ ...model }))
        : [],
      enabled: this.isEnabled(),
      pollIntervalMs: this.getPollInterval(),
    };
  }

  updateAlerts(models) {
    const nextKeys = new Set();
    const freshAlerts = [];

    for (const model of models) {
      if (model.usagePercent < 80) continue;
      const key = `${model.id}:${model.resetTime || 'unknown'}`;
      nextKeys.add(key);
      if (!this.alertedModelKeys.has(key)) {
        freshAlerts.push(model);
      }
    }

    this.alertedModelKeys = nextKeys;
    return freshAlerts;
  }

  async discoverCandidates() {
    const processes = await discoverLanguageServerProcesses();
    if (!processes.length) {
      throw new Error('No Antigravity language server process found');
    }

    const fallbackToken = await extractFallbackCsrfToken();
    const candidates = [];

    for (const processEntry of processes) {
      const listeningPorts = await getListeningPortsForPid(processEntry.pid);
      const candidatePorts = [
        ...new Set(
          [processEntry.extensionServerPort, ...listeningPorts].filter(
            (port) => Number.isFinite(port) && port > 0
          )
        ),
      ];

      if (!candidatePorts.length) continue;

      candidates.push({
        ...processEntry,
        csrfToken: processEntry.csrfToken || fallbackToken,
        ports: candidatePorts,
      });
    }

    if (!candidates.length) {
      throw new Error('No reachable language server ports found');
    }

    return candidates;
  }

  async probeCandidate(candidate) {
    let lastError = null;

    for (const port of candidate.ports) {
      try {
        const payload = await fetchQuotaPayload(port, candidate.csrfToken);
        return {
          payload,
          pid: candidate.pid,
          port,
          workspaceId: candidate.workspaceId,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('No quota endpoint responded');
  }

  async refresh(options = {}) {
    const { emit = true } = options;
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        const candidates = await this.discoverCandidates();
        let lastError = null;

        for (const candidate of candidates) {
          try {
            const result = await this.probeCandidate(candidate);
            const summary = normalizeQuotaPayload(result.payload, {
              enabled: this.isEnabled(),
              pid: result.pid,
              port: result.port,
              workspaceId: result.workspaceId,
            });

            summary.alerts = this.updateAlerts(summary.models);
            this.lastSummary = summary;
            if (emit) {
              this.emit('updated', this.getSummary());
            }
            return this.getSummary();
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError || new Error('No quota endpoint responded');
      } catch (error) {
        this.alertedModelKeys.clear();
        this.lastSummary = buildUnavailableSummary(error.message);
        if (emit) {
          this.emit('error', this.getSummary());
        }
        return this.getSummary();
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  start() {
    if (this.pollTimer || !this.isEnabled()) return;

    this.refresh().catch(() => {});
    this.pollTimer = setInterval(() => {
      this.refresh().catch(() => {});
    }, this.getPollInterval());

    if (typeof this.pollTimer.unref === 'function') {
      this.pollTimer.unref();
    }
  }

  stop() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
}

export const quotaService = new QuotaService();
