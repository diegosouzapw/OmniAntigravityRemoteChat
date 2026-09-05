import morphdom from './vendor/morphdom-lite.js';
import { FileBrowser } from './components/file-browser.js';
import { TerminalView } from './components/terminal-view.js';
import { GitPanel } from './components/git-panel.js';
import { StatsPanel } from './components/stats-panel.js';
import { AssistPanel } from './components/assist-panel.js';
import { TimelinePanel } from './components/timeline-panel.js';

const DEFAULT_MODELS = [
  'Gemini 3.8 Flash High',
  'Gemini 3.7 Flash Medium',
  'Gemini 3.6 Flash Medium',
  'Gemini 3.1 Pro High',
  'Gemini 3.1 Pro Low',
  'Claude Sonnet 4.6 (Thinking)',
  'Claude Opus 4.6 (Thinking)',
  'GPT-OSS 120B (Medium)',
];

const THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'slate', label: 'Slate' },
  { value: 'pastel', label: 'Pastel' },
  { value: 'rainbow', label: 'Rainbow' },
];
const USER_SCROLL_LOCK_DURATION = 15000;
const SCROLL_SYNC_DEBOUNCE = 150;

const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const refreshBtn = document.getElementById('refreshBtn');
const stopBtn = document.getElementById('stopBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statsText = document.getElementById('statsText');
const overflowMenuBtn = document.getElementById('overflowMenuBtn');
const headerOverflowDropdown = document.getElementById('headerOverflowDropdown');
const modeBtn = document.getElementById('modeBtn');
const modelBtn = document.getElementById('modelBtn');
const targetBtn = document.getElementById('targetBtn');
const themeBtn = document.getElementById('themeBtn');
const suggestionsBtn = document.getElementById('suggestionsBtn');
const quotaBtn = document.getElementById('quotaBtn');
const modeText = document.getElementById('modeText');
const modelText = document.getElementById('modelText');
const targetText = document.getElementById('targetText');
const themeText = document.getElementById('themeText');
const suggestionsText = document.getElementById('suggestionsText');
const quotaText = document.getElementById('quotaText');
const workspaceLayer = document.getElementById('workspaceLayer');
const workspaceToggleBtn = document.getElementById('workspaceToggleBtn');
const workspaceStatusText = document.getElementById('workspaceStatusText');
const workspaceCloseBtn = document.getElementById('workspaceCloseBtn');
const sessionStatsBtn = document.getElementById('sessionStatsBtn');
const sessionStatsText = document.getElementById('sessionStatsText');
const quickActions = document.getElementById('quickActions');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalList = document.getElementById('modalList');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const historyLayer = document.getElementById('historyLayer');
const historyList = document.getElementById('historyList');
const historyBackBtn = document.getElementById('historyBackBtn');
const screenFrame = document.getElementById('screenStreamFrame');
const screenStatus = document.getElementById('screenStreamStatus');
const screenStartBtn = document.getElementById('screenStartBtn');
const screenStopBtn = document.getElementById('screenStopBtn');
const imageUploadBtn = document.getElementById('imageUploadBtn');
const imageInput = document.getElementById('imageInput');
const sslBanner = document.getElementById('sslBanner');
const enableHttpsBtn = document.getElementById('enableHttpsBtn');
const dismissSslBtn = document.getElementById('dismissSslBtn');
const voiceMemoSettingBtn = document.getElementById('voiceMemoSettingBtn');
const voiceMemoSettingText = document.getElementById('voiceMemoSettingText');
const compactModeBtn = document.getElementById('compactModeBtn');
const compactModeText = document.getElementById('compactModeText');
const voiceMemoBtn = document.getElementById('voiceMemoBtn');
const voiceRecordingBar = document.getElementById('voiceRecordingBar');
const recordingTimer = document.getElementById('recordingTimer');
const cancelRecordBtn = document.getElementById('cancelRecordBtn');
const doneRecordBtn = document.getElementById('doneRecordBtn');
const stagedMediaSlot = document.getElementById('stagedMediaSlot');

const state = {
  ws: null,
  currentMode: 'Fast',
  chatIsOpen: true,
  currentTheme: localStorage.getItem('omni-theme') || 'dark',
  workspaceOpen: false,
  activeWorkspacePanel: 'files',
  userIsScrolling: false,
  userScrollLockUntil: 0,
  snapshotReloadPending: false,
  lastScrollSync: 0,
  quickCommands: [],
  suggestMode: false,
  pendingSuggestions: 0,
  suggestions: [],
  screenActive: false,
  sessionStats: null,
  quota: null,
  timeline: null,
  panelInitialized: {
    files: false,
    terminal: false,
    git: false,
    assist: false,
    stats: false,
    timeline: false,
  },
};

const fileBrowser = new FileBrowser(document.getElementById('workspacePanel-files'), {
  fetchWithAuth,
  notify: showSlideInNotification,
});
const terminalView = new TerminalView(document.getElementById('workspacePanel-terminal'), {
  fetchWithAuth,
  notify: showSlideInNotification,
});
const gitPanel = new GitPanel(document.getElementById('workspacePanel-git'), {
  fetchWithAuth,
  notify: showSlideInNotification,
});
const assistPanel = new AssistPanel(
  document.getElementById('workspacePanel-assist'),
  {
    fetchWithAuth,
    notify: showSlideInNotification,
    onAction: handleAssistAction,
    getContext: () => ({
      sessionStats: state.sessionStats,
      pendingSuggestions: state.pendingSuggestions,
      quota: state.quota,
    }),
  }
);
const statsPanel = new StatsPanel(document.getElementById('workspacePanel-stats'), {
  fetchWithAuth,
  notify: showSlideInNotification,
});
const timelinePanel = new TimelinePanel(document.getElementById('workspacePanel-timeline'), {
  fetchWithAuth,
  notify: showSlideInNotification,
});

let scrollSyncTimeout = null;
let idleTimer = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchWithAuth(url, options = {}) {
  const nextOptions = { ...options };
  nextOptions.headers = { ...(options.headers || {}), 'ngrok-skip-browser-warning': 'true' };
  const response = await fetch(url, nextOptions);
  if (response.status === 401) {
    window.location.href = '/login.html';
    return new Promise(() => {});
  }
  return response;
}

function updateThemeLabel() {
  const match = THEMES.find((theme) => theme.value === state.currentTheme);
  themeText.textContent = match?.label || 'Dark';
}

function updateSuggestionLabel() {
  if (!suggestionsText) return;
  suggestionsText.textContent = state.suggestMode
    ? `${state.pendingSuggestions} Pending`
    : 'Off';
  suggestionsBtn?.classList.toggle('active', state.suggestMode || state.pendingSuggestions > 0);
}

function updateSessionStatsLabel() {
  if (!sessionStatsText) return;
  const metrics = state.sessionStats?.metrics || {};
  const uptime = state.sessionStats?.uptime || '0s';
  const messages = Number(metrics.messagesSent || 0);
  const errors = Number(metrics.errorsDetected || 0);
  sessionStatsText.textContent = `${uptime} · ${messages} msg · ${errors} err`;
  sessionStatsBtn?.classList.toggle('active', messages > 0 || errors > 0);
  assistPanel.renderContextSummary();
}

function buildQuotaBar(usagePercent, width = 10) {
  const clamped = Math.max(0, Math.min(100, Number(usagePercent) || 0));
  const filled = Math.round((clamped / 100) * width);
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function updateQuotaLabel() {
  if (!quotaText) return;
  if (!state.quota) {
    quotaText.textContent = 'Check';
    quotaBtn?.classList.remove('active');
    return;
  }

  if (!state.quota.available) {
    quotaText.textContent = state.quota.enabled ? 'Offline' : 'Off';
    quotaBtn?.classList.remove('active');
    return;
  }

  quotaText.textContent =
    state.quota.criticalModels > 0
      ? `${state.quota.criticalModels} Hot`
      : `${state.quota.highestUsagePercent || 0}% Max`;
  quotaBtn?.classList.toggle(
    'active',
    state.quota.criticalModels > 0 || state.quota.warningModels > 0
  );
  assistPanel.renderContextSummary();
}

function setSuggestionState(payload = {}) {
  state.suggestMode = Boolean(payload.suggestMode);
  state.pendingSuggestions = Number(payload.pendingCount || 0);
  state.suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : state.suggestions;
  updateSuggestionLabel();
  assistPanel.renderContextSummary();
  if (state.sessionStats) {
    setStatsState({
      ...state.sessionStats,
      pendingSuggestions: state.pendingSuggestions,
    });
  }
}

function setStatsState(stats) {
  if (!stats) return;
  state.sessionStats = {
    ...stats,
    pendingSuggestions: Number(
      stats.pendingSuggestions ?? state.pendingSuggestions ?? 0
    ),
  };
  updateSessionStatsLabel();
  statsPanel.handleState(state.sessionStats);
}

async function loadSessionStats() {
  try {
    const response = await fetchWithAuth('/api/stats');
    const payload = await response.json();
    setStatsState(payload);
  } catch (_) {}
}

function setQuotaState(quota) {
  if (!quota) return;
  state.quota = quota;
  updateQuotaLabel();
}

async function loadQuota() {
  try {
    const response = await fetchWithAuth('/api/quota');
    const payload = await response.json();
    setQuotaState(payload);
    return payload;
  } catch (error) {
    setQuotaState({
      available: false,
      enabled: false,
      error: error.message,
      criticalModels: 0,
      warningModels: 0,
      highestUsagePercent: 0,
      models: [],
    });
    return null;
  }
}

function setTimelineState(timeline) {
  if (!timeline) return;
  state.timeline = timeline;
  timelinePanel.handleState(timeline);
}

async function loadTimeline() {
  try {
    const response = await fetchWithAuth('/api/timeline');
    const payload = await response.json();
    setTimelineState(payload);
    return payload;
  } catch (_) {
    return state.timeline;
  }
}

function applyTheme(theme, persist = true) {
  state.currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  updateThemeLabel();
  if (persist) {
    localStorage.setItem('omni-theme', theme);
  }
  const styles = getComputedStyle(document.documentElement);
  const headerBg = styles.getPropertyValue('--bg-header').trim() ||
                   styles.getPropertyValue('--bg-body').trim() ||
                   styles.getPropertyValue('--accent').trim();
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && headerBg) {
    themeMeta.setAttribute('content', headerBg);
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function checkSslStatus() {
  if (window.location.protocol === 'https:') return;
  if (localStorage.getItem('sslBannerDismissed')) return;
  sslBanner.classList.add('show');
}

async function enableHttps() {
  enableHttpsBtn.disabled = true;
  enableHttpsBtn.textContent = 'Generating...';
  try {
    const response = await fetchWithAuth('/generate-ssl', { method: 'POST' });
    const payload = await response.json();
    if (payload.success) {
      showSlideInNotification(payload.message, 'success');
      enableHttpsBtn.textContent = 'Restart Server';
    } else {
      throw new Error(payload.error || 'HTTPS generation failed');
    }
  } catch (error) {
    showSlideInNotification(error.message, 'error');
    enableHttpsBtn.disabled = false;
    enableHttpsBtn.textContent = 'Enable HTTPS';
  }
}

function dismissSslBanner() {
  sslBanner.classList.remove('show');
  localStorage.setItem('sslBannerDismissed', 'true');
}

let isCDPConnected = false;
let currentAgentActivity = 'Idle';
let statusTestTimer = null;
let isStatusTestActive = false;

function isActiveWorkState(activity) {
  if (!activity) return false;
  const lower = activity.toLowerCase().trim();
  if (lower === 'idle') return false;
  if (
    lower.startsWith('worked for') ||
    lower.startsWith('completed') ||
    lower.startsWith('done') ||
    lower.startsWith('finished')
  ) {
    return false;
  }
  return true;
}

function applyStatusDisplay(connected, activity) {
  const statusBadge = document.getElementById('statusBadge');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  if (!statusBadge || !statusDot || !statusText) return;

  statusDot.className = 'status-dot';
  statusBadge.className = 'status-badge';

  if (!connected) {
    statusDot.classList.add('disconnected');
    statusBadge.classList.add('offline');
    statusText.textContent = 'Reconnecting';
    statusText.style.display = 'inline';
    statusBadge.title = 'Antigravity Offline · Reconnecting...';
    stopBtn?.classList.remove('active');
    return;
  }

  // Connected (Live)
  statusDot.classList.add('connected');
  const isWorking = isActiveWorkState(activity);

  if (isWorking) {
    statusDot.classList.add('working');
    statusBadge.classList.add('active');
    statusText.textContent = activity;
    statusText.style.display = 'inline';
    statusBadge.title = `Live · ${activity}`;
    stopBtn?.classList.add('active');
  } else {
    // When live and idle, no text needed! Just the compact pulsing dot
    statusDot.classList.add('idle');
    statusBadge.classList.add('compact');
    statusText.textContent = '';
    statusText.style.display = 'none';
    statusBadge.title = 'CDP Live · Ready';
    stopBtn?.classList.remove('active');
  }
}

function updateUnifiedStatus() {
  if (isStatusTestActive) return;
  applyStatusDisplay(isCDPConnected, currentAgentActivity);
}

function testStatus(mode = 'cycle', customText, durationMs = 12000) {
  if (statusTestTimer) {
    clearTimeout(statusTestTimer);
    statusTestTimer = null;
  }

  isStatusTestActive = true;

  if (mode === 'reset') {
    isStatusTestActive = false;
    updateUnifiedStatus();
    showSlideInNotification('Status test reset to live state', 'info');
    return;
  }

  if (mode === 'live' || mode === 'idle') {
    applyStatusDisplay(true, 'Idle');
    showSlideInNotification('Demo: Live & Idle (compact pulse dot)', 'success');
    statusTestTimer = setTimeout(() => {
      isStatusTestActive = false;
      updateUnifiedStatus();
    }, durationMs || 5000);
    return;
  }

  if (mode === 'working') {
    const text = customText || 'Working...';
    applyStatusDisplay(true, text);
    showSlideInNotification(`Demo: Active (${text}) dual animated dot`, 'info');
    statusTestTimer = setTimeout(() => {
      isStatusTestActive = false;
      updateUnifiedStatus();
    }, durationMs || 5000);
    return;
  }

  if (mode === 'thinking') {
    const text = customText || 'Thinking...';
    applyStatusDisplay(true, text);
    showSlideInNotification(`Demo: Active (${text}) dual animated dot`, 'info');
    statusTestTimer = setTimeout(() => {
      isStatusTestActive = false;
      updateUnifiedStatus();
    }, durationMs || 5000);
    return;
  }

  if (mode === 'reconnecting' || mode === 'offline') {
    applyStatusDisplay(false, '');
    showSlideInNotification('Demo: Disconnected (warning pulse dot)', 'warning');
    statusTestTimer = setTimeout(() => {
      isStatusTestActive = false;
      updateUnifiedStatus();
    }, durationMs || 5000);
    return;
  }

  // mode === 'cycle'
  showSlideInNotification('Status demo: Cycling Live ➔ Working ➔ Thinking ➔ Reconnecting', 'info');
  const steps = [
    { fn: () => applyStatusDisplay(true, 'Idle'), desc: 'Live & Idle' },
    { fn: () => applyStatusDisplay(true, customText || 'Working...'), desc: 'Live · Working...' },
    { fn: () => applyStatusDisplay(true, 'Thinking...'), desc: 'Live · Thinking...' },
    { fn: () => applyStatusDisplay(false, ''), desc: 'Reconnecting (Warning)' }
  ];

  let stepIndex = 0;
  const stepDuration = Math.max(2500, Math.floor((durationMs || 12000) / steps.length));

  function runNextStep() {
    if (stepIndex >= steps.length) {
      isStatusTestActive = false;
      updateUnifiedStatus();
      showSlideInNotification('Demo cycle complete · Live state restored', 'success');
      return;
    }
    const current = steps[stepIndex++];
    current.fn();
    statusTestTimer = setTimeout(runNextStep, stepDuration);
  }

  runNextStep();
}

const isDevMode =
  localStorage.getItem('omni_dev_mode') === 'true' ||
  new URLSearchParams(window.location.search).has('dev');

if (isDevMode) {
  window.omniDev = {
    testStatus,
    disable: () => {
      localStorage.removeItem('omni_dev_mode');
      window.location.reload();
    }
  };
} else {
  window.omniEnableDevMode = () => {
    localStorage.setItem('omni_dev_mode', 'true');
    window.location.reload();
  };
}

function updateStatus(connected) {
  isCDPConnected = !!connected;
  if (!isStatusTestActive) {
    updateUnifiedStatus();
  }
}

function showSlideInNotification(message, type = 'info') {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    container.className = 'notification-container';
    document.body.appendChild(container);
  }

  const alert = document.createElement('div');
  alert.className = `slide-in-alert ${type}`;
  alert.innerHTML = `
    <div class="alert-message">${message}</div>
    <button class="panel-btn" type="button">Dismiss</button>
  `;
  alert.querySelector('button').addEventListener('click', () => alert.remove());
  container.appendChild(alert);
  requestAnimationFrame(() => alert.classList.add('show'));
  setTimeout(() => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 250);
  }, 4500);
}

let activeActionData = null;
let actionConfirmTimeout = null;
let snoozedActionId = null;
let currentPlanData = null;
const actedActionIds = new Set();

/**
 * Lightweight, safe Markdown-to-HTML parser for implementation plans.
 * Supports headings, alerts, code blocks, tables, checklists, lists, and inline styles.
 *
 * @param {string} markdown
 * @returns {string} Safe HTML string
 */
function renderPlanMarkdown(markdown) {
  if (!markdown) return '<p><em>No implementation plan content available.</em></p>';

  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeLang = '';
  let codeBuffer = [];
  let inList = false;
  let listType = 'ul';
  let inTable = false;

  const closeListIfNeeded = () => {
    if (inList) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }
  };

  const closeTableIfNeeded = () => {
    if (inTable) {
      out.push('</tbody></table></div>');
      inTable = false;
    }
  };

  const formatInline = (str) => {
    return str
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Fenced code blocks
    if (rawLine.trim().startsWith('```')) {
      if (!inCode) {
        closeListIfNeeded();
        closeTableIfNeeded();
        inCode = true;
        codeLang = rawLine.trim().slice(3).trim() || 'text';
        codeBuffer = [];
        continue;
      } else {
        inCode = false;
        const codeEscaped = escapeHtml(codeBuffer.join('\n'));
        out.push(
          `<div class="plan-code-block">` +
            `<div class="plan-code-header"><span>${escapeHtml(codeLang)}</span></div>` +
            `<pre><code class="language-${escapeHtml(codeLang)}">${codeEscaped}</code></pre>` +
          `</div>`
        );
        continue;
      }
    }

    if (inCode) {
      codeBuffer.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();

    // Blank line
    if (!trimmed) {
      closeListIfNeeded();
      closeTableIfNeeded();
      continue;
    }

    // Horizontal Rule
    if (/^(---|___|\*\*\*)$/.test(trimmed)) {
      closeListIfNeeded();
      closeTableIfNeeded();
      out.push('<hr />');
      continue;
    }

    // GitHub-Style Alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
    const alertMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i);
    if (alertMatch) {
      closeListIfNeeded();
      closeTableIfNeeded();
      const type = alertMatch[1].toLowerCase();
      let alertContent = alertMatch[2] ? escapeHtml(alertMatch[2]) : '';

      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) {
        i++;
        const nextQuote = lines[i].trim().replace(/^>\s?/, '');
        alertContent += (alertContent ? '<br>' : '') + formatInline(escapeHtml(nextQuote));
      }

      const iconMap = {
        note: 'ℹ️',
        tip: '💡',
        important: '🔔',
        warning: '⚠️',
        caution: '🛑'
      };

      out.push(
        `<div class="plan-alert ${type}">` +
          `<div class="plan-alert-title">${iconMap[type] || 'ℹ️'} ${type.toUpperCase()}</div>` +
          `<div class="plan-alert-body">${alertContent}</div>` +
        `</div>`
      );
      continue;
    }

    // Regular Blockquotes
    if (trimmed.startsWith('>')) {
      closeListIfNeeded();
      closeTableIfNeeded();
      const quoteText = trimmed.replace(/^>\s?/, '');
      out.push(`<blockquote>${formatInline(escapeHtml(quoteText))}</blockquote>`);
      continue;
    }

    // Headings (# H1 to #### H4)
    if (trimmed.startsWith('#')) {
      closeListIfNeeded();
      closeTableIfNeeded();
      const level = Math.min(trimmed.match(/^#+/)[0].length, 4);
      const text = trimmed.slice(level).trim();
      const hTag = 'h' + level;
      out.push(`<${hTag}>${formatInline(escapeHtml(text))}</${hTag}>`);
      continue;
    }

    // Tables: | col1 | col2 |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      closeListIfNeeded();
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());

      if (cells.every(c => /^[-:]+$/.test(c))) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        out.push('<div class="plan-table-wrap"><table class="plan-table"><thead><tr>');
        cells.forEach(c => {
          out.push(`<th>${formatInline(escapeHtml(c))}</th>`);
        });
        out.push('</tr></thead><tbody>');
        continue;
      } else {
        out.push('<tr>');
        cells.forEach(c => {
          out.push(`<td>${formatInline(escapeHtml(c))}</td>`);
        });
        out.push('</tr>');
        continue;
      }
    } else {
      closeTableIfNeeded();
    }

    // Unordered list items (- or *)
    const ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeListIfNeeded();
        inList = true;
        listType = 'ul';
        out.push('<ul>');
      }
      let itemContent = ulMatch[1];
      if (itemContent.startsWith('[ ] ')) {
        itemContent = '☐ ' + itemContent.slice(4);
      } else if (itemContent.startsWith('[x] ') || itemContent.startsWith('[X] ')) {
        itemContent = '☑ ' + itemContent.slice(4);
      }
      out.push(`<li>${formatInline(escapeHtml(itemContent))}</li>`);
      continue;
    }

    // Ordered list items (1. )
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeListIfNeeded();
        inList = true;
        listType = 'ol';
        out.push('<ol>');
      }
      out.push(`<li>${formatInline(escapeHtml(olMatch[1]))}</li>`);
      continue;
    }

    // Paragraph
    closeListIfNeeded();
    out.push(`<p>${formatInline(escapeHtml(trimmed))}</p>`);
  }

  closeListIfNeeded();
  closeTableIfNeeded();

  return `<div class="plan-md">${out.join('\n')}</div>`;
}

/**
 * Opens the mobile implementation plan preview modal.
 */
async function openPlanPreviewModal() {
  const modal = document.getElementById('planPreviewModal');
  const body = document.getElementById('planPreviewBody');
  const subtitle = document.getElementById('planPreviewSubtitle');
  const drawer = document.getElementById('planPreviewReviewDrawer');
  const reviewInput = document.getElementById('planPreviewFeedbackInput');
  if (!modal || !body) return;

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  if (drawer) drawer.style.display = 'none';
  if (reviewInput) reviewInput.value = '';

  body.innerHTML = `
    <div class="plan-preview-loading">
      <div class="plan-preview-spinner"></div>
      <span>Loading implementation plan...</span>
    </div>
  `;

  try {
    const res = await fetchWithAuth('/api/plan');
    const data = await res.json();
    if (!res.ok || !data.success) {
      body.innerHTML = `
        <div class="plan-alert warning">
          <div class="plan-alert-title">⚠️ Notice</div>
          <div class="plan-alert-body">${escapeHtml(data.error || 'No implementation plan currently found on disk.')}</div>
        </div>
      `;
      if (subtitle) subtitle.textContent = 'Plan not found';
      return;
    }

    currentPlanData = data;
    const timeStr = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'recently';
    const filename = data.path ? data.path.split('/').slice(-2).join('/') : 'implementation_plan.md';
    if (subtitle) {
      subtitle.textContent = `${filename} · Updated ${timeStr}`;
    }

    body.innerHTML = renderPlanMarkdown(data.content);

    if (window.Prism) {
      try { window.Prism.highlightAllUnder(body); } catch (_) {}
    }
  } catch (err) {
    body.innerHTML = `
      <div class="plan-alert caution">
        <div class="plan-alert-title">Error</div>
        <div class="plan-alert-body">${escapeHtml(err.message || 'Failed to load implementation plan')}</div>
      </div>
    `;
    if (subtitle) subtitle.textContent = 'Error loading plan';
  }
}

/**
 * Closes the mobile implementation plan preview modal.
 */
function closePlanPreviewModal() {
  const modal = document.getElementById('planPreviewModal');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  const drawer = document.getElementById('planPreviewReviewDrawer');
  if (drawer) drawer.style.display = 'none';
}

/**
 * Sets up global button listeners for the plan preview modal.
 */
function setupPlanPreviewModal() {
  const modal = document.getElementById('planPreviewModal');
  const closeBtn = document.getElementById('planPreviewCloseBtn');
  const laterBtn = document.getElementById('planPreviewLaterBtn');
  const reviewBtn = document.getElementById('planPreviewReviewBtn');
  const proceedBtn = document.getElementById('planPreviewProceedBtn');
  const drawer = document.getElementById('planPreviewReviewDrawer');
  const drawerCancelBtn = document.getElementById('planPreviewReviewCancelBtn');
  const drawerSubmitBtn = document.getElementById('planPreviewReviewSubmitBtn');
  const feedbackInput = document.getElementById('planPreviewFeedbackInput');

  closeBtn?.addEventListener('click', () => {
    closePlanPreviewModal();
  });

  laterBtn?.addEventListener('click', () => {
    closePlanPreviewModal();
    if (activeActionData) {
      snoozedActionId = activeActionData.id;
      const slot = document.getElementById('actionCardSlot');
      if (slot) {
        slot.innerHTML = `
          <div class="plan-snooze-chip" id="planSnoozeResumeBtn" title="Tap to resume plan approval">
            <span>📋 ${escapeHtml(activeActionData.title || 'Plan Approval')}</span>
            <span style="font-weight: normal; opacity: 0.85;">· Tap to review</span>
          </div>
        `;
        document.getElementById('planSnoozeResumeBtn')?.addEventListener('click', () => {
          snoozedActionId = null;
          renderActionCard(activeActionData);
        });
      }
    }
  });

  reviewBtn?.addEventListener('click', () => {
    if (drawer) {
      const isVisible = drawer.style.display !== 'none';
      drawer.style.display = isVisible ? 'none' : 'block';
      if (!isVisible && feedbackInput) {
        setTimeout(() => feedbackInput.focus(), 60);
      }
    }
  });

  drawerCancelBtn?.addEventListener('click', () => {
    if (drawer) drawer.style.display = 'none';
  });

  drawerSubmitBtn?.addEventListener('click', async () => {
    const feedback = feedbackInput?.value?.trim() || '';
    drawerSubmitBtn.disabled = true;
    drawerSubmitBtn.textContent = 'Submitting...';
    try {
      await respondToInteractiveAction({
        actionId: activeActionData?.id || 'plan-approval',
        type: 'plan',
        decision: 'review',
        feedback
      });
      closePlanPreviewModal();
    } finally {
      drawerSubmitBtn.disabled = false;
      drawerSubmitBtn.textContent = 'Submit Review';
    }
  });

  proceedBtn?.addEventListener('click', async () => {
    proceedBtn.disabled = true;
    proceedBtn.textContent = 'Starting...';
    try {
      await respondToInteractiveAction({
        actionId: activeActionData?.id || 'plan-approval',
        type: 'plan',
        decision: 'proceed'
      });
      closePlanPreviewModal();
    } finally {
      proceedBtn.disabled = false;
      proceedBtn.textContent = 'Proceed with Plan';
    }
  });

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      closePlanPreviewModal();
    }
  });
}

function updateAgentActivity(activityText) {
  currentAgentActivity = (activityText || 'Idle').trim();
  if (!isStatusTestActive) {
    updateUnifiedStatus();
  }
}

function renderActionCard(actionData) {
  const slot = document.getElementById('actionCardSlot');
  if (!slot) return;

  if (!actionData) {
    if (activeActionData || document.getElementById('floatingActionCard') || document.getElementById('planSnoozeResumeBtn')) {
      slot.innerHTML = '';
      activeActionData = null;
    }
    return;
  }

  // If this action was already acted on, do not display the card
  if (actedActionIds.has(actionData.id)) {
    if (activeActionData || document.getElementById('floatingActionCard')) {
      slot.innerHTML = '';
      activeActionData = null;
    }
    return;
  }

  // If user snoozed this action with "Later", render the compact resume chip
  if (snoozedActionId === actionData.id) {
    activeActionData = actionData;
    if (!document.getElementById('planSnoozeResumeBtn')) {
      slot.innerHTML = `
        <div class="plan-snooze-chip" id="planSnoozeResumeBtn" title="Tap to resume plan approval">
          <span>📋 ${escapeHtml(actionData.title || 'Plan Approval')}</span>
          <span style="font-weight: normal; opacity: 0.85;">· Tap to review</span>
        </div>
      `;
      document.getElementById('planSnoozeResumeBtn')?.addEventListener('click', () => {
        snoozedActionId = null;
        renderActionCard(actionData);
      });
    }
    return;
  }

  // Prevent re-rendering identical prompt ID unless changed
  const existingCard = document.getElementById('floatingActionCard');
  if (existingCard && (existingCard.getAttribute('data-action-id') === actionData.id || (activeActionData && activeActionData.id === actionData.id))) {
    return;
  }
  activeActionData = actionData;

  // Sensory haptic feedback on mobile
  if (navigator.vibrate) {
    try { navigator.vibrate([20, 40, 20]); } catch (_) {}
  }

  const {
    id,
    type,
    title,
    riskLevel,
    riskReason,
    command,
    options,
    isMultiSelect,
    hasWriteIn,
    summary,
    proceedText,
    acceptText,
    rejectText,
    submitText,
    skipText
  } = actionData;

  // Risk Badge HTML
  let riskBadgeHtml = '';
  if (type === 'command') {
    const level = riskLevel || 'warning';
    const label = level === 'critical' ? '🔴 Critical' : level === 'safe' ? '🟢 Safe' : '🟡 Warning';
    riskBadgeHtml = `<span class="risk-badge ${level}" title="${escapeHtml(riskReason || '')}">${label}</span>`;
  }

  let bodyHtml = '';
  if (type === 'command') {
    bodyHtml = `
      <div class="action-cmd-box">
        <pre class="action-cmd-text"><code id="actionCmdSnippet">${escapeHtml(command || '')}</code></pre>
        <button class="action-cmd-copy-btn" id="actionCmdCopyBtn" type="button" title="Copy command" aria-label="Copy command">📋</button>
      </div>
    `;
  } else if (type === 'question') {
    const opts = options || [];
    const optionsHtml = opts.map((opt, idx) => `
      <div class="action-option-pill ${isMultiSelect ? 'multi' : ''}" data-idx="${idx}">
        <span class="action-option-indicator"></span>
        <span class="action-option-text">${escapeHtml(opt.text || '')}</span>
      </div>
    `).join('');

    bodyHtml = `
      <div class="action-options-list" id="actionOptionsList">
        ${optionsHtml}
      </div>
      ${hasWriteIn !== false ? `<input type="text" class="action-writein-input" id="actionWriteInInput" placeholder="Custom response (optional)..." />` : ''}
    `;
  } else if (type === 'plan') {
    bodyHtml = `
      <div class="action-plan-summary">
        ${escapeHtml(summary || "Implementation plan is ready. Review details or proceed with execution.")}
      </div>
      <button type="button" class="action-plan-preview-btn" id="actionBtnPreviewPlan" aria-label="Preview Implementation Plan">
        <div class="action-plan-preview-left">
          <span class="action-plan-preview-icon">📖</span>
          <div>
            <div class="action-plan-preview-title">Preview Implementation Plan</div>
            <div class="action-plan-preview-sub">Tap to review full plan &amp; diffs</div>
          </div>
        </div>
        <span class="action-plan-preview-arrow">➔</span>
      </button>
      <div class="action-plan-review-box" id="actionPlanReviewBox" style="display: none;">
        <label for="actionPlanFeedbackInput" class="action-plan-review-label">Ask modifications or questions:</label>
        <textarea class="action-plan-feedback-input" id="actionPlanFeedbackInput" placeholder="e.g. Can we adjust X or add test coverage for Y?"></textarea>
        <div class="action-plan-review-actions">
          <button type="button" class="action-card-btn secondary" id="actionPlanReviewCancelBtn">Cancel</button>
          <button type="button" class="action-card-btn primary" id="actionPlanReviewSubmitBtn">Submit Review</button>
        </div>
      </div>
    `;
  }

  // Footer Buttons
  let footerHtml = '';
  if (type === 'command') {
    const isCritical = riskLevel === 'critical';
    const primaryClass = isCritical ? 'action-card-btn danger' : 'action-card-btn primary';
    footerHtml = `
      <div class="action-card-footer">
        <button type="button" class="action-card-btn secondary" id="actionBtnReject">${escapeHtml(rejectText || 'Reject')}</button>
        <button type="button" class="${primaryClass}" id="actionBtnAccept" data-critical="${isCritical}">${escapeHtml(acceptText || 'Run')}</button>
      </div>
    `;
  } else if (type === 'question') {
    footerHtml = `
      <div class="action-card-footer">
        ${skipText ? `<button type="button" class="action-card-btn secondary" id="actionBtnSkip">${escapeHtml(skipText)}</button>` : ''}
        <button type="button" class="action-card-btn primary" id="actionBtnSubmit">${escapeHtml(submitText || 'Submit')}</button>
      </div>
    `;
  } else if (type === 'plan') {
    footerHtml = `
      <div class="action-card-footer" id="actionPlanFooter">
        <button type="button" class="action-card-btn secondary" id="actionBtnDismiss">Later</button>
        <button type="button" class="action-card-btn secondary" id="actionBtnReview">${escapeHtml(actionData.reviewText || 'Review')}</button>
        <button type="button" class="action-card-btn primary" id="actionBtnProceed">${escapeHtml(proceedText || 'Proceed with Plan')}</button>
      </div>
    `;
  }

  slot.innerHTML = `
    <div class="floating-action-card" id="floatingActionCard" data-action-id="${id}">
      <div class="action-card-handle" title="Swipe down to dismiss temporarily"></div>
      <div class="action-card-header">
        <div class="action-card-title-group">
          <span class="action-card-icon">${type === 'command' ? '⚡' : type === 'plan' ? '📋' : '❓'}</span>
          <span class="action-card-title">${escapeHtml(title || 'Decision Required')}</span>
        </div>
        ${riskBadgeHtml}
      </div>
      ${bodyHtml}
      ${footerHtml}
    </div>
  `;

  const card = document.getElementById('floatingActionCard');
  if (!card) return;

  // Swipe-down dismiss on handle
  let cardTouchStartY = 0;
  card.querySelector('.action-card-handle')?.addEventListener('touchstart', (e) => {
    cardTouchStartY = e.touches[0].clientY;
  }, { passive: true });
  card.querySelector('.action-card-handle')?.addEventListener('touchend', (e) => {
    const deltaY = e.changedTouches[0].clientY - cardTouchStartY;
    if (deltaY > 35) {
      card.style.opacity = '0.35';
      card.style.transform = 'translateY(18px)';
      setTimeout(() => {
        card.style.opacity = '';
        card.style.transform = '';
      }, 1800);
    }
  }, { passive: true });

  // Copy command button
  card.querySelector('#actionCmdCopyBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command || '');
      const btn = card.querySelector('#actionCmdCopyBtn');
      if (btn) {
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = '📋'; }, 1500);
      }
    } catch (_) {}
  });

  // Question Options
  if (type === 'question') {
    const optionPills = card.querySelectorAll('.action-option-pill');
    optionPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        if (isMultiSelect) {
          pill.classList.toggle('selected');
        } else {
          optionPills.forEach(p => p.classList.remove('selected'));
          pill.classList.add('selected');
        }
      });
    });

    card.querySelector('#actionBtnSubmit')?.addEventListener('click', async () => {
      const selectedPills = Array.from(card.querySelectorAll('.action-option-pill.selected'));
      const selectedIndices = selectedPills.map(p => Number(p.getAttribute('data-idx')));
      const writeIn = card.querySelector('#actionWriteInInput')?.value?.trim() || '';
      await respondToInteractiveAction({
        actionId: id,
        type: 'question',
        decision: 'submit',
        selectedOptions: selectedIndices,
        writeInText: writeIn
      });
    });

    card.querySelector('#actionBtnSkip')?.addEventListener('click', async () => {
      await respondToInteractiveAction({
        actionId: id,
        type: 'question',
        decision: 'skip'
      });
    });
  }

  // Command Accept / Reject
  if (type === 'command') {
    const acceptBtn = card.querySelector('#actionBtnAccept');
    const rejectBtn = card.querySelector('#actionBtnReject');

    rejectBtn?.addEventListener('click', async () => {
      await respondToInteractiveAction({
        actionId: id,
        type: 'command',
        decision: 'reject'
      });
    });

    acceptBtn?.addEventListener('click', async () => {
      const isCritical = acceptBtn.getAttribute('data-critical') === 'true';
      if (isCritical && !acceptBtn.classList.contains('confirming')) {
        // Step 1 of 2-step confirmation
        acceptBtn.classList.add('confirming');
        const origText = acceptBtn.textContent;
        acceptBtn.textContent = '⚠️ Confirm risk?';
        clearTimeout(actionConfirmTimeout);
        actionConfirmTimeout = setTimeout(() => {
          acceptBtn.classList.remove('confirming');
          acceptBtn.textContent = origText;
        }, 3500);
        return;
      }

      // Step 2 (or safe/warning 1-step): execute!
      clearTimeout(actionConfirmTimeout);
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Running...';
      try {
        await respondToInteractiveAction({
          actionId: id,
          type: 'command',
          decision: 'accept'
        });
      } finally {
        if (acceptBtn && activeActionData) {
          acceptBtn.disabled = false;
          acceptBtn.textContent = acceptText || 'Run command';
        }
      }
    });
  }

  // Plan Proceed & Review & Preview
  if (type === 'plan') {
    const previewBtn = card.querySelector('#actionBtnPreviewPlan');
    const reviewBtn = card.querySelector('#actionBtnReview');
    const proceedBtn = card.querySelector('#actionBtnProceed');
    const dismissBtn = card.querySelector('#actionBtnDismiss');
    const reviewBox = card.querySelector('#actionPlanReviewBox');
    const reviewInput = card.querySelector('#actionPlanFeedbackInput');
    const reviewCancelBtn = card.querySelector('#actionPlanReviewCancelBtn');
    const reviewSubmitBtn = card.querySelector('#actionPlanReviewSubmitBtn');

    // 1. Preview Implementation Plan
    previewBtn?.addEventListener('click', () => {
      openPlanPreviewModal();
    });

    // 2. Review: toggle inline feedback box
    reviewBtn?.addEventListener('click', () => {
      if (reviewBox) {
        const isVisible = reviewBox.style.display !== 'none';
        reviewBox.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible && reviewInput) {
          setTimeout(() => reviewInput.focus(), 60);
        }
      }
    });

    reviewCancelBtn?.addEventListener('click', () => {
      if (reviewBox) reviewBox.style.display = 'none';
    });

    reviewSubmitBtn?.addEventListener('click', async () => {
      const feedback = reviewInput?.value?.trim() || '';
      reviewSubmitBtn.disabled = true;
      reviewSubmitBtn.textContent = 'Submitting...';
      try {
        await respondToInteractiveAction({
          actionId: id,
          type: 'plan',
          decision: 'review',
          feedback
        });
      } finally {
        reviewSubmitBtn.disabled = false;
        reviewSubmitBtn.textContent = 'Submit Review';
      }
    });

    // 3. Proceed with Plan
    proceedBtn?.addEventListener('click', async () => {
      proceedBtn.disabled = true;
      proceedBtn.textContent = 'Starting...';
      try {
        await respondToInteractiveAction({
          actionId: id,
          type: 'plan',
          decision: 'proceed'
        });
      } finally {
        if (proceedBtn && activeActionData) {
          proceedBtn.disabled = false;
          proceedBtn.textContent = proceedText || 'Proceed with Plan';
        }
      }
    });

    // 4. Later (snooze)
    dismissBtn?.addEventListener('click', () => {
      snoozedActionId = id;
      actedActionIds.add(id);

      // Notify server to dismiss pending prompt
      fetchWithAuth('/api/action/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: id, type: 'plan', decision: 'later' })
      }).catch(() => {});

      slot.innerHTML = `
        <div class="plan-snooze-chip" id="planSnoozeResumeBtn" title="Tap to resume plan approval">
          <span>📋 ${escapeHtml(title || 'Plan Approval')}</span>
          <span style="font-weight: normal; opacity: 0.85;">· Tap to review</span>
        </div>
      `;
      document.getElementById('planSnoozeResumeBtn')?.addEventListener('click', () => {
        snoozedActionId = null;
        actedActionIds.delete(id);
        actedActionIds.delete('plan-approval');
        renderActionCard(actionData);
      });
    });
  }
}

async function respondToInteractiveAction(payload) {
  try {
    if (payload?.actionId) {
      actedActionIds.add(payload.actionId);
    }
    if (activeActionData?.id) {
      actedActionIds.add(activeActionData.id);
    }

    const res = await fetchWithAuth('/api/action/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      snoozedActionId = null;
      const successMsg = payload.decision === 'review'
        ? (payload.feedback ? 'Plan review submitted' : 'Plan review opened')
        : payload.decision === 'proceed'
          ? 'Plan execution started'
          : 'Action executed successfully';
      showSlideInNotification(successMsg, 'success');
      renderActionCard(null);
    } else {
      if (payload?.actionId) actedActionIds.delete(payload.actionId);
      if (activeActionData?.id) actedActionIds.delete(activeActionData.id);
      showSlideInNotification(result.error || 'Execution failed', 'error');
    }
  } catch (err) {
    if (payload?.actionId) actedActionIds.delete(payload.actionId);
    if (activeActionData?.id) actedActionIds.delete(activeActionData.id);
    showSlideInNotification(err.message, 'error');
  }
}

function showActionRequiredPrompt(message) {
  const msgStr = typeof message === 'string' ? message : 'Pending approval request...';
  let hash = 5381;
  for (let i = 0; i < msgStr.length; i++) {
    hash = ((hash << 5) + hash) + msgStr.charCodeAt(i);
  }
  const stableId = 'legacy-' + Math.abs(hash).toString(36);
  renderActionCard({
    id: stableId,
    type: 'command',
    title: 'Action Required',
    command: msgStr,
    riskLevel: 'warning',
    acceptText: 'Run',
    rejectText: 'Reject'
  });
}

async function loadSuggestions() {
  try {
    const response = await fetchWithAuth('/api/suggestions/pending');
    const payload = await response.json();
    setSuggestionState(payload);
  } catch (_) {}
}

function formatSuggestionLabel(suggestion) {
  const verb = suggestion.action === 'accept' ? 'Approve' : 'Reject';
  const command = String(suggestion.command || 'Pending action')
    .replace(/\s+/g, ' ')
    .trim();
  const summary = command.length > 64 ? `${command.slice(0, 64)}…` : command;
  return `${verb} · ${summary}`;
}

function showSuggestionPrompt(suggestion) {
  if (!suggestion?.id) return;
  document.getElementById('suggestion-prompt-layer')?.remove();

  const actionLabel = suggestion.action === 'accept' ? 'Approve' : 'Reject';
  const layer = document.createElement('div');
  layer.id = 'suggestion-prompt-layer';
  layer.className = 'modal-overlay show';
  layer.innerHTML = `
    <div class="modal-panel">
      <div class="modal-title">Supervisor Suggestion</div>
      <div class="panel-subtitle modal-copy">${escapeHtml(
        suggestion.summary || `The supervisor recommends ${actionLabel.toLowerCase()}ing this pending action.`
      )}</div>
      <div class="code-preview">${escapeHtml(suggestion.command || 'Pending action')}</div>
      <div class="panel-subtitle modal-copy">Reason: <code>${escapeHtml(suggestion.reason || 'manual-review')}</code></div>
      <div class="screen-actions">
        <button class="panel-btn" data-decision="reject">Reject Suggestion</button>
        <button class="panel-btn primary" data-decision="approve">${actionLabel} Suggestion</button>
      </div>
    </div>
  `;

  layer.querySelectorAll('button[data-decision]').forEach((button) => {
    button.addEventListener('click', () =>
      handleSuggestionDecision(suggestion.id, button.getAttribute('data-decision'), button)
    );
  });
  layer.addEventListener('click', (event) => {
    if (event.target === layer) {
      layer.remove();
    }
  });

  document.body.appendChild(layer);
}

function formatQuotaSummary(quota) {
  if (!quota?.available) {
    return quota?.error || 'Quota data is unavailable right now.';
  }

  const lines = [];
  if (quota.user?.planName) {
    lines.push(`Plan: ${quota.user.planName}`);
  }
  if (quota.credits?.prompt) {
    lines.push(
      `Prompt credits: ${quota.credits.prompt.usagePercent}% used (${quota.credits.prompt.used}/${quota.credits.prompt.monthly})`
    );
  }
  if (quota.credits?.flow) {
    lines.push(
      `Flow credits: ${quota.credits.flow.usagePercent}% used (${quota.credits.flow.used}/${quota.credits.flow.monthly})`
    );
  }
  if (lines.length) {
    lines.push('');
  }

  (quota.models || []).forEach((model) => {
    lines.push(`${model.name}`);
    lines.push(
      `${buildQuotaBar(model.usagePercent)} ${model.usagePercent}% used · ${model.remainingPercent}% left`
    );
    if (model.resetTime) {
      lines.push(`Reset ${new Date(model.resetTime).toLocaleTimeString()}`);
    }
    lines.push('');
  });

  lines.push(
    `Critical: ${quota.criticalModels || 0}/${quota.totalModels || 0} · Updated ${quota.lastUpdated ? new Date(quota.lastUpdated).toLocaleTimeString() : 'unknown'}`
  );
  return lines.join('\n').trim();
}

function showQuotaPrompt(quota) {
  document.getElementById('quota-prompt-layer')?.remove();

  const layer = document.createElement('div');
  layer.id = 'quota-prompt-layer';
  layer.className = 'modal-overlay show';
  layer.innerHTML = `
    <div class="modal-panel">
      <div class="modal-title">Model Quota</div>
      <div class="panel-subtitle modal-copy">${
        quota?.available
          ? `${quota.totalModels || 0} models tracked from the local language server`
          : 'Quota service status'
      }</div>
      <pre class="code-preview">${escapeHtml(formatQuotaSummary(quota))}</pre>
      <div class="screen-actions">
        <button class="panel-btn" data-action="close">Close</button>
        <button class="panel-btn primary" data-action="refresh">Refresh</button>
      </div>
    </div>
  `;

  layer.querySelector('[data-action="close"]')?.addEventListener('click', () => {
    layer.remove();
  });
  layer
    .querySelector('[data-action="refresh"]')
    ?.addEventListener('click', async () => {
      const latest = await loadQuota();
      showQuotaPrompt(latest || state.quota);
    });
  layer.addEventListener('click', (event) => {
    if (event.target === layer) {
      layer.remove();
    }
  });
  document.body.appendChild(layer);
}

async function handleAssistAction(action) {
  if (!action?.type) return;

  if (action.type === 'approve_suggestion' || action.type === 'reject_suggestion') {
    await loadSuggestions();
    const suggestion = state.suggestions[0];
    if (!suggestion) {
      showSlideInNotification('No pending suggestions available.', 'warning');
      return;
    }

    const response = await fetchWithAuth(
      action.type === 'approve_suggestion'
        ? `/api/suggestions/${encodeURIComponent(suggestion.id)}/approve`
        : `/api/suggestions/${encodeURIComponent(suggestion.id)}/reject`,
      { method: 'POST' }
    );
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || 'Suggestion action failed');
    }
    showSlideInNotification(
      action.type === 'approve_suggestion'
        ? 'Latest suggestion approved.'
        : 'Latest suggestion rejected.',
      action.type === 'approve_suggestion' ? 'success' : 'warning'
    );
    await loadSuggestions();
    await loadSessionStats();
    return;
  }

  if (action.type === 'show_suggestions') {
    await showSuggestionsQueue();
    return;
  }

  if (action.type === 'refresh_quota') {
    const quota = await loadQuota();
    showQuotaPrompt(quota || state.quota);
    return;
  }

  if (action.type === 'open_stats') {
    await toggleWorkspace(true);
    await setWorkspacePanel('stats');
    return;
  }

  if (action.type === 'open_screen') {
    await toggleWorkspace(true);
    await setWorkspacePanel('screen');
  }
}

async function handleSuggestionDecision(id, decision, button) {
  if (!id || !decision) return;
  button.disabled = true;
  try {
    const response = await fetchWithAuth(
      decision === 'approve'
        ? `/api/suggestions/${encodeURIComponent(id)}/approve`
        : `/api/suggestions/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
      }
    );
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || 'Suggestion update failed');
    }

    document.getElementById('suggestion-prompt-layer')?.remove();
    showSlideInNotification(
      decision === 'approve'
        ? 'Suggestion approved and executed.'
        : 'Suggestion rejected.',
      decision === 'approve' ? 'success' : 'warning'
    );
    await loadSuggestions();
  } catch (error) {
    showSlideInNotification(error.message, 'error');
    button.disabled = false;
  }
}

async function showSuggestionsQueue() {
  await loadSuggestions();
  if (!state.suggestions.length) {
    showSlideInNotification(
      state.suggestMode ? 'No pending suggestions right now.' : 'Suggest Mode is off.',
      'info'
    );
    return;
  }

  openModal(
    'Pending Suggestions',
    state.suggestions.map((suggestion) => ({
      label: formatSuggestionLabel(suggestion),
      value: suggestion.id,
    })),
    (id) => {
      const suggestion = state.suggestions.find((entry) => entry.id === id);
      if (suggestion) {
        showSuggestionPrompt(suggestion);
      }
    }
  );
}

function buildSnapshotStyles(cssText) {
  const theme = getComputedStyle(document.documentElement);
  const text = theme.getPropertyValue('--text-main').trim();
  const border = theme.getPropertyValue('--snapshot-border').trim();
  const codeBg = theme.getPropertyValue('--snapshot-code-bg').trim();
  const surface = theme.getPropertyValue('--snapshot-bg').trim();
  const card = theme.getPropertyValue('--snapshot-card').trim();
  const link = theme.getPropertyValue('--snapshot-link').trim();
  const accent = theme.getPropertyValue('--accent').trim() || '#1d9bf0';
  const accentSoft = theme.getPropertyValue('--accent-soft').trim() || 'rgba(29, 155, 240, 0.16)';
  return `
    ${cssText}
    #conversation, #chat, #cascade {
      background: transparent !important;
      color: ${text} !important;
      font-family: var(--font-sans) !important;
      height: auto !important;
      max-width: 100% !important;
      overflow: visible !important;
      display: block !important;
    }
    #conversation > div, #chat > div, #cascade > div,
    #conversation [class*="overflow"], #chat [class*="overflow"], #cascade [class*="overflow"],
    [aria-label="Message history"],
    [tabindex="0"] {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
      flex: none !important;
      display: block !important;
    }
    [style*="container-type"] {
      container-type: normal !important;
      height: auto !important;
      min-height: auto !important;
    }
    [role="article"][aria-label="User message"] {
      position: relative !important;
      background: var(--snapshot-card, #141b2d) !important;
      border: 1px solid var(--snapshot-border, #232d46) !important;
      border-radius: 12px !important;
      padding: 12px 14px !important;
      margin: 12px 0 !important;
    }
    [role="article"][aria-label="User message"]::after {
      display: none !important;
    }
    #conversation *, #chat *, #cascade * {
      color: inherit !important;
      max-width: 100% !important;
    }
    #conversation a, #chat a, #cascade a {
      color: ${link} !important;
    }
    pre, code, .monaco-editor-background, [class*="terminal"] {
      background: ${codeBg} !important;
      border: 1px solid ${border} !important;
      color: ${text} !important;
      font-family: var(--font-mono) !important;
      border-radius: 12px !important;
    }
    pre {
      white-space: pre-wrap !important;
      padding: 14px !important;
      margin: 12px 0 !important;
      overflow: auto !important;
    }
    :not(pre) > code {
      padding: 2px 6px !important;
      border-radius: 8px !important;
      background: ${card} !important;
      border: 1px solid ${border} !important;
    }
    details {
      background: ${surface} !important;
      border: 1px solid ${border} !important;
      border-radius: 12px !important;
      margin: 10px 0 !important;
      overflow: hidden !important;
    }
    details > summary {
      background: ${card} !important;
      padding: 10px 12px !important;
      cursor: pointer !important;
    }
    blockquote,
    table,
    th,
    td,
    button,
    [role="button"] {
      border-color: ${border} !important;
    }
    blockquote {
      background: ${card} !important;
      border-left: 3px solid ${link} !important;
      padding: 10px 12px !important;
      border-radius: 0 12px 12px 0 !important;
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    th, td {
      padding: 8px !important;
    }
    img[src^="/c:"], img[src^="/C:"], img[src*="AppData"] {
      display: none !important;
    }
    /* Disable layout sliding animations inside question radiogroups */
    div[role="radiogroup"],
    div[role="radiogroup"] > div,
    label[for^="ask-opt-"] {
      animation: none !important;
    }
    label[for^="ask-opt-"] {
      position: relative !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      padding: 12px 14px !important;
      margin: 8px 0 !important;
      background: var(--bg-card, rgba(255, 255, 255, 0.04)) !important;
      border: 1.5px solid var(--border, rgba(148, 163, 184, 0.22)) !important;
      border-radius: 12px !important;
      cursor: pointer !important;
      user-select: none !important;
      -webkit-user-select: none !important;
      -webkit-tap-highlight-color: transparent !important;
      transition: background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, transform 0.08s ease !important;
      box-sizing: border-box !important;
    }
    label[for^="ask-opt-"]:hover {
      background: var(--bg-card-hover, rgba(255, 255, 255, 0.08)) !important;
      border-color: ${accent} !important;
    }
    label[for^="ask-opt-"]:active {
      transform: scale(0.98) !important;
    }
    label[for^="ask-opt-"].omni-selected,
    label[for^="ask-opt-"][data-checked="true"],
    label[for^="ask-opt-"]:has(input:checked) {
      background: ${accentSoft} !important;
      border-color: ${accent} !important;
      box-shadow: 0 0 0 1.5px ${accent}, 0 4px 16px rgba(29, 155, 240, 0.25) !important;
    }
    label[for^="ask-opt-"].omni-selected > span,
    label[for^="ask-opt-"][data-checked="true"] > span,
    label[for^="ask-opt-"]:has(input:checked) > span {
      color: ${text} !important;
      font-weight: 600 !important;
    }
    label[for^="ask-opt-"] div.shrink-0 {
      background: rgba(148, 163, 184, 0.15) !important;
      color: var(--text-muted, #94a3b8) !important;
      border: 1px solid rgba(148, 163, 184, 0.25) !important;
      border-radius: 6px !important;
      font-weight: 600 !important;
      transition: background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease, color 0.12s ease !important;
    }
    label[for^="ask-opt-"].omni-selected div.shrink-0,
    label[for^="ask-opt-"][data-checked="true"] div.shrink-0,
    label[for^="ask-opt-"]:has(input:checked) div.shrink-0 {
      background: ${accent} !important;
      border-color: ${accent} !important;
      color: #ffffff !important;
      font-weight: 700 !important;
      box-shadow: 0 0 8px ${accent} !important;
    }
    label[for^="ask-opt-"].omni-selected div.shrink-0 span,
    label[for^="ask-opt-"][data-checked="true"] div.shrink-0 span,
    label[for^="ask-opt-"]:has(input:checked) div.shrink-0 span {
      color: #ffffff !important;
      font-weight: 700 !important;
    }
    button[data-testid="interaction-continue-button"] {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: ${accent} !important;
      color: #ffffff !important;
      font-weight: 600 !important;
      border-radius: 10px !important;
      padding: 10px 20px !important;
      margin-top: 8px !important;
      border: none !important;
      box-shadow: 0 4px 14px rgba(29, 155, 240, 0.35) !important;
      cursor: pointer !important;
      transition: all 0.12s ease !important;
    }
    button[data-testid="interaction-continue-button"]:active,
    button[data-testid="interaction-continue-button"].omni-submitting {
      transform: scale(0.96) !important;
      filter: brightness(0.9) !important;
    }
    button[data-testid="interaction-skip-button"] {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: transparent !important;
      color: var(--text-muted, #94a3b8) !important;
      border-radius: 10px !important;
      padding: 10px 16px !important;
      margin-top: 8px !important;
      border: 1px solid var(--border, rgba(148, 163, 184, 0.22)) !important;
      cursor: pointer !important;
      transition: all 0.12s ease !important;
    }
    button[data-testid="interaction-skip-button"]:active {
      transform: scale(0.96) !important;
      background: rgba(255, 255, 255, 0.06) !important;
    }
  `;
}

function addMobileCopyButtons() {
  chatContent.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.mobile-copy-btn')) return;
    const text = (pre.textContent || '').trim();
    if (!text.includes('\n')) return;

    const button = document.createElement('button');
    button.className = 'mobile-copy-btn';
    button.type = 'button';
    button.innerHTML = '⧉';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = '✓';
        setTimeout(() => {
          button.textContent = '⧉';
        }, 1500);
      } catch (_) {
        showSlideInNotification('Clipboard copy failed on this connection.', 'warning');
      }
    });
    pre.appendChild(button);
  });
}

function showEmptyState() {
  chatContent.innerHTML = `
    <div class="empty-state">
      <div class="panel-title">No chat open</div>
      <div class="panel-subtitle">Start a new conversation or pick one from history.</div>
      <button class="panel-btn primary" id="emptyStateNewChatBtn">Start new chat</button>
    </div>
  `;
  chatContent
    .querySelector('#emptyStateNewChatBtn')
    .addEventListener('click', startNewChat);
}

function renderSnapshot(payload, options = {}) {
  if (!payload || !payload.html) return;
  state.chatIsOpen = true;

  const scrollTop = chatContainer.scrollTop;
  const scrollHeight = chatContainer.scrollHeight;
  const clientHeight = chatContainer.clientHeight;
  const isNearBottom = scrollHeight - scrollTop - clientHeight < 140;
  const isUserLocked = options.forceScrollBottom ? false : (Date.now() < state.userScrollLockUntil);

  if (options.forceScrollBottom) {
    state.userScrollLockUntil = 0;
  }

  statsText.textContent = payload.stats
    ? `${payload.stats.nodes} nodes · ${Math.round((payload.stats.htmlSize + payload.stats.cssSize) / 1024)} KB`
    : 'Live';

  if (payload.agentActivity !== undefined) {
    updateAgentActivity(payload.agentActivity);
  }
  if (payload.pendingAction !== undefined) {
    if (!payload.pendingAction || !actedActionIds.has(payload.pendingAction.id)) {
      renderActionCard(payload.pendingAction);
    }
  }

  let styleTag = document.getElementById('cdp-styles');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'cdp-styles';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = buildSnapshotStyles(payload.css || '');

  try {
    morphdom(
      chatContent,
      `<div id="chatContent" class="chat-content snapshot-shell">${payload.html}</div>`
    );
  } catch (mErr) {
    console.warn('morphdom fallback to innerHTML:', mErr);
    chatContent.className = 'chat-content snapshot-shell';
    chatContent.innerHTML = payload.html;
  }

  // Suppress stale snapshot rubber-banding while the user recently selected an option
  if (activeUserOptionKey && Date.now() - activeUserOptionTime < 2000) {
    const chosenLabel = chatContent.querySelector(`label[for="${CSS.escape(activeUserOptionKey)}"]`);
    if (chosenLabel) {
      const groupContainer = chosenLabel.closest('[role="radiogroup"]') || chosenLabel.parentElement?.parentElement || chatContent;
      groupContainer.querySelectorAll('label[for^="ask-opt-"]').forEach((l) => {
        if (l === chosenLabel) {
          l.classList.add('omni-selected');
          l.setAttribute('data-checked', 'true');
          const inp = l.querySelector('input') || (l.getAttribute('for') ? chatContent.querySelector(`#${CSS.escape(l.getAttribute('for'))}`) : null);
          if (inp) {
            inp.checked = true;
            inp.setAttribute('checked', '');
          }
        } else {
          l.classList.remove('omni-selected');
          l.removeAttribute('data-checked');
          const inp = l.querySelector('input') || (l.getAttribute('for') ? chatContent.querySelector(`#${CSS.escape(l.getAttribute('for'))}`) : null);
          if (inp) {
            inp.checked = false;
            inp.removeAttribute('checked');
          }
        }
      });
    }
  }
  chatContent.querySelectorAll('details').forEach((details) =>
    details.setAttribute('open', '')
  );
  addMobileCopyButtons();

  const isGenerating = Boolean(
    payload.isGenerating ||
    isActiveWorkState(currentAgentActivity) ||
    chatContent.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
    payload.isStreaming
  );
  stopBtn?.classList.toggle('active', isGenerating);

  if (options.forceScrollBottom || (!isUserLocked && isNearBottom)) {
    scrollToBottom(false);
  } else if (isUserLocked && scrollHeight > 0) {
    const ratio = scrollTop / scrollHeight;
    chatContainer.scrollTop = chatContainer.scrollHeight * ratio;
  } else {
    chatContainer.scrollTop = scrollTop;
  }
}

async function loadSnapshot() {
  try {
    const response = await fetchWithAuth('/snapshot');
    if (!response.ok) {
      if (response.status === 503) {
        if (!state.chatIsOpen) showEmptyState();
        return;
      }
      throw new Error(`Snapshot request failed (${response.status})`);
    }

    const payload = await response.json();
    renderSnapshot(payload);
  } catch (error) {
    console.error(error);
  }
}

async function fetchAppState() {
  try {
    const response = await fetchWithAuth('/app-state');
    const payload = await response.json();
    if (payload.mode && payload.mode !== 'Unknown') {
      state.currentMode = payload.mode;
      modeText.textContent = payload.mode;
      modeBtn.classList.toggle('active', payload.mode === 'Planning');
    }
    if (payload.model && payload.model !== 'Unknown') {
      modelText.textContent = payload.model;
    }
  } catch (_) {}
}

async function loadQuickCommands() {
  try {
    const response = await fetchWithAuth('/api/quick-commands');
    const payload = await response.json();
    state.quickCommands = payload.commands || [];
    renderQuickCommands();
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

function renderQuickCommands() {
  quickActions.innerHTML = state.quickCommands
    .map(
      (command) => `
        <button class="action-chip" data-quick-command="${command.id}">
          <span>${command.icon || '•'}</span>
          <span>${command.label}</span>
        </button>
      `
    )
    .join('');
  quickActions.querySelectorAll('[data-quick-command]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-quick-command');
      const command = state.quickCommands.find((item) => item.id === id);
      if (!command) return;
      messageInput.value = command.prompt;
      messageInput.dispatchEvent(new Event('input'));
      messageInput.focus();
    });
  });
}

function scrollToBottom(smooth = true) {
  chatContainer.scrollTo({
    top: chatContainer.scrollHeight,
    behavior: smooth ? 'smooth' : 'auto',
  });
}

async function syncScrollToDesktop() {
  const percent =
    chatContainer.scrollTop /
    Math.max(chatContainer.scrollHeight - chatContainer.clientHeight, 1);
  try {
    await fetchWithAuth('/remote-scroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrollPercent: percent }),
    });
    if (!state.snapshotReloadPending) {
      state.snapshotReloadPending = true;
      setTimeout(() => {
        loadSnapshot();
        state.snapshotReloadPending = false;
      }, 300);
    }
  } catch (_) {}
}

let isSendingMessage = false;

async function sendMessage() {
  if (isSendingMessage) return;

  const message = messageInput.value.trim();
  if (!message && !stagedAudio && !stagedImage) return;

  isSendingMessage = true;
  const savedPrompt = messageInput.value;
  const savedAudio = stagedAudio;
  const savedImage = stagedImage;

  sendBtn.disabled = true;

  try {
    if (!state.chatIsOpen) {
      await startNewChat();
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    if (stagedAudio && stagedImage) {
      showSlideInNotification('Sending image and voice memo...', 'info');
      const audioToUpload = stagedAudio;
      const imageToUpload = stagedImage;
      clearStagedAudio();
      clearStagedImage();
      messageInput.value = '';
      messageInput.style.height = 'auto';

      const mediaRes = await fetchWithAuth('/api/upload-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: {
            name: imageToUpload.name,
            mimeType: imageToUpload.mimeType,
            data: imageToUpload.data
          },
          audio: {
            name: audioToUpload.name,
            mimeType: audioToUpload.mimeType,
            data: audioToUpload.data,
            durationSeconds: audioToUpload.durationSeconds
          },
          prompt: message,
          inject: true,
          submit: true
        })
      });
      const mediaPayload = await mediaRes.json();
      if (!mediaPayload.success) {
        throw new Error(mediaPayload.error || 'Failed to send image and voice memo');
      }
      showSlideInNotification('Image and voice memo sent!', 'success');
      setTimeout(loadSnapshot, 500);
      setTimeout(loadSnapshot, 1500);
    } else if (stagedAudio) {
      const audioPayload = {
        name: stagedAudio.name,
        mimeType: stagedAudio.mimeType,
        data: stagedAudio.data,
        durationSeconds: stagedAudio.durationSeconds,
        prompt: message,
        inject: true,
        submit: true
      };
      clearStagedAudio();
      messageInput.value = '';
      messageInput.style.height = 'auto';
      showSlideInNotification('Sending voice memo to session...', 'info');

      const response = await fetchWithAuth('/api/upload-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioPayload)
      });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Failed to send voice memo');
      }
      showSlideInNotification('Voice memo sent!', 'success');
      setTimeout(loadSnapshot, 500);
      setTimeout(loadSnapshot, 1500);
    } else if (stagedImage) {
      const imgPayload = {
        name: stagedImage.name,
        mimeType: stagedImage.mimeType,
        data: stagedImage.data,
        prompt: message,
        inject: true,
        submit: true
      };
      clearStagedImage();
      messageInput.value = '';
      messageInput.style.height = 'auto';
      showSlideInNotification('Sending image to session...', 'info');

      const response = await fetchWithAuth('/api/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(imgPayload)
      });
      const payload = await response.json();
      if (!payload.success) {
        throw new Error(payload.error || 'Failed to send image');
      }
      showSlideInNotification('Image sent!', 'success');
      setTimeout(loadSnapshot, 500);
      setTimeout(loadSnapshot, 1500);
    } else {
      messageInput.value = '';
      messageInput.style.height = 'auto';
      const response = await fetchWithAuth('/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.success === false) {
        throw new Error(payload.error || payload.details?.error || 'Failed to send message');
      }
      if (payload.queued || payload.details?.queued) {
        showSlideInNotification('Message queued for agent', 'info');
      }
      setTimeout(loadSnapshot, 300);
      setTimeout(loadSnapshot, 800);
    }
  } catch (error) {
    if (savedImage && !stagedImage) {
      stagedImage = savedImage;
      if (imageUploadBtn) imageUploadBtn.classList.add('active');
      renderStagedMedia();
    }
    if (savedAudio && !stagedAudio) {
      stagedAudio = savedAudio;
      renderStagedMedia();
    }
    if (savedPrompt && !messageInput.value) {
      messageInput.value = savedPrompt;
      messageInput.style.height = 'auto';
      messageInput.style.height = `${messageInput.scrollHeight}px`;
    }
    showSlideInNotification(error.message, 'error');
  } finally {
    isSendingMessage = false;
    sendBtn.disabled = false;
  }
}

async function startNewChat() {
  try {
    const response = await fetchWithAuth('/new-chat', { method: 'POST' });
    const payload = await response.json();
    if (payload.success) {
      state.chatIsOpen = true;
      setTimeout(loadSnapshot, 400);
      setTimeout(checkChatStatus, 1000);
    } else {
      showSlideInNotification(payload.error || 'Failed to create new chat.', 'error');
    }
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

async function checkChatStatus() {
  try {
    const response = await fetchWithAuth('/chat-status');
    const payload = await response.json();
    state.chatIsOpen = payload.hasChat || payload.editorFound;
    if (!state.chatIsOpen) {
      showEmptyState();
    }
  } catch (_) {}
}

async function showChatHistory() {
  historyLayer.classList.add('show');
  
  const historyActiveWindow = document.getElementById('historyActiveWindow');
  const historySwitchWindowBtn = document.getElementById('historySwitchWindowBtn');
  if (historySwitchWindowBtn && !historySwitchWindowBtn._bound) {
    historySwitchWindowBtn._bound = true;
    historySwitchWindowBtn.addEventListener('click', () => {
      showTargetSelector();
    });
  }

  // Update active IDE window header
  fetchWithAuth('/cdp-targets')
    .then((r) => r.json())
    .then((data) => {
      const active = (data.targets || []).find((t) => t.id === data.activeTarget);
      if (historyActiveWindow) {
        historyActiveWindow.textContent = active ? active.title : (targetText.textContent || 'Antigravity IDE');
      }
    })
    .catch(() => {});

  historyList.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading conversations...</p>
    </div>
  `;
  try {
    const response = await fetchWithAuth('/chat-history');
    const payload = await response.json();
    const chats = payload.chats || payload.history || [];
    if (!chats.length) {
      historyList.innerHTML = `
        <div class="history-empty">
          <div class="panel-title">No conversations yet</div>
          <button class="panel-btn primary" id="historyNewChatBtn">Start new chat</button>
        </div>
      `;
      historyList
        .querySelector('#historyNewChatBtn')
        .addEventListener('click', async () => {
          hideChatHistory();
          await startNewChat();
        });
      return;
    }

    historyList.innerHTML = chats
      .map((chat) => {
        const safeTitle = (chat.title || '').replaceAll('"', '&quot;');
        const safeId = (chat.chatId || chat.id || '').replaceAll('"', '&quot;');
        const safeWorkspace = (chat.workspace || '').replaceAll('"', '&quot;');
        const activeClass = chat.active ? 'active' : '';
        const actionLabel = chat.active ? 'ACTIVE' : 'Switch';

        let subRow = '';
        if (chat.workspace || chat.date) {
          subRow = `
            <div class="history-sub-row">
              ${chat.workspace ? `<span class="history-workspace-chip" title="${safeWorkspace}">${chat.workspace}</span>` : ''}
              ${chat.date ? `<span class="history-time-chip">${chat.date}</span>` : ''}
            </div>
          `;
        }

        return `
          <button class="history-item ${activeClass}" data-chat-title="${safeTitle}" data-chat-id="${safeId}">
            <div class="history-item-main">
              <div class="history-title-row">
                <span class="history-title">${chat.title}</span>
                ${chat.active ? '<span class="history-active-badge">Active</span>' : ''}
              </div>
              ${subRow}
            </div>
            <span class="stat-micro history-action-btn">${actionLabel}</span>
          </button>
        `;
      })
      .join('');

    historyList.querySelectorAll('.history-item').forEach((button) => {
      button.addEventListener('click', async () => {
        const title = button.getAttribute('data-chat-title');
        const chatId = button.getAttribute('data-chat-id');
        hideChatHistory();
        await selectChat(title, chatId);
      });
    });
  } catch (error) {
    historyList.innerHTML = `<div class="history-empty">${error.message}</div>`;
  }
}

function hideChatHistory() {
  historyLayer.classList.remove('show');
}

async function selectChat(title, chatId) {
  try {
    showSlideInNotification(`Switching to "${title || 'conversation'}"...`, 'info');
    const response = await fetchWithAuth('/select-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, chatId }),
    });
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || 'Could not switch conversation');
    }
    showSlideInNotification(`Switched to "${title || 'conversation'}"`, 'success');
    if (payload.snapshot && payload.snapshot.html) {
      renderSnapshot(payload.snapshot, { forceScrollBottom: true });
    } else {
      await loadSnapshot();
    }
    setTimeout(loadSnapshot, 400);
    setTimeout(loadSnapshot, 1000);
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

function openModal(title, options, onSelect) {
  modalTitle.textContent = title;
  modalList.innerHTML = '';
  options.forEach((option) => {
    const button = document.createElement('button');
    button.className = 'modal-option';
    button.type = 'button';
    button.textContent = option.label;
    button.addEventListener('click', () => {
      closeModal();
      Promise.resolve(onSelect(option.value)).catch((error) => {
        showSlideInNotification(error.message, 'error');
      });
    });
    modalList.appendChild(button);
  });
  modalOverlay.classList.add('show');
}

function closeModal() {
  modalOverlay.classList.remove('show');
}

async function showTargetSelector() {
  try {
    const response = await fetchWithAuth('/cdp-targets');
    const payload = await response.json();
    const options = (payload.targets || []).map((target) => ({
      label:
        target.id === payload.activeTarget
          ? `Active · ${target.title}`
          : target.title,
      value: target.id,
    }));
    options.push({ label: 'Launch new window', value: '__launch__' });

    openModal('Select Antigravity Window', options, async (targetId) => {
      if (targetId === '__launch__') {
        await launchNewWindow();
        return;
      }

      const switchResponse = await fetchWithAuth('/select-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId }),
      });
      const switchPayload = await switchResponse.json();
      if (!switchPayload.success) {
        throw new Error(switchPayload.error || 'Window switch failed');
      }
      targetText.textContent = switchPayload.target;
      const historyActiveWindow = document.getElementById('historyActiveWindow');
      if (historyActiveWindow) historyActiveWindow.textContent = switchPayload.target;
      if (historyLayer.classList.contains('show')) {
        setTimeout(showChatHistory, 500);
      }
      setTimeout(loadSnapshot, 1200);
      setTimeout(fetchAppState, 1500);
    });
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

async function launchNewWindow() {
  try {
    const response = await fetchWithAuth('/api/launch-window', { method: 'POST' });
    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.error || 'Could not launch window');
    }
    showSlideInNotification(`New Antigravity window launched on port ${payload.port}.`, 'success');
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

function handleCDPStatus(status) {
  if (status === 'connected') {
    updateStatus(true);
    loadSnapshot();
  } else if (status === 'reconnecting') {
    updateStatus(false);
  }
}

async function loadWorkspacePanel(panel) {
  if (panel === 'files' && !state.panelInitialized.files) {
    state.panelInitialized.files = true;
    await fileBrowser.init();
  }
  if (panel === 'terminal' && !state.panelInitialized.terminal) {
    state.panelInitialized.terminal = true;
    await terminalView.init();
  } else if (panel === 'terminal') {
    await terminalView.refresh();
  }
  if (panel === 'git' && !state.panelInitialized.git) {
    state.panelInitialized.git = true;
    await gitPanel.init();
  } else if (panel === 'git') {
    await gitPanel.refresh();
  }
  if (panel === 'assist' && !state.panelInitialized.assist) {
    state.panelInitialized.assist = true;
    await assistPanel.init();
  } else if (panel === 'assist') {
    assistPanel.renderContextSummary();
    await assistPanel.refresh();
  }
  if (panel === 'stats' && !state.panelInitialized.stats) {
    state.panelInitialized.stats = true;
    await statsPanel.init();
  } else if (panel === 'stats') {
    if (state.sessionStats) {
      statsPanel.handleState(state.sessionStats);
    }
    await statsPanel.refresh();
  }
  if (panel === 'timeline' && !state.panelInitialized.timeline) {
    state.panelInitialized.timeline = true;
    await timelinePanel.init();
  } else if (panel === 'timeline') {
    if (state.timeline) {
      timelinePanel.handleState(state.timeline);
    }
    await timelinePanel.refresh();
  }
  if (panel === 'screen') {
    await loadScreenStatus();
  }
}

async function setWorkspacePanel(panel) {
  state.activeWorkspacePanel = panel;
  document
    .querySelectorAll('.workspace-tab')
    .forEach((button) =>
      button.classList.toggle('active', button.dataset.panel === panel)
    );
  document
    .querySelectorAll('.workspace-panel')
    .forEach((panelNode) =>
      panelNode.classList.toggle('active', panelNode.id === `workspacePanel-${panel}`)
    );
  await loadWorkspacePanel(panel);
}

async function toggleWorkspace(force) {
  state.workspaceOpen = typeof force === 'boolean' ? force : !state.workspaceOpen;
  workspaceLayer.classList.toggle('open', state.workspaceOpen);
  workspaceStatusText.textContent = state.workspaceOpen ? 'Open' : 'Closed';
  if (state.workspaceOpen) {
    await setWorkspacePanel(state.activeWorkspacePanel);
  }
}

function updateScreenStatus(status) {
  state.screenActive = !!status.active;
  screenStatus.textContent = status.active
    ? `Streaming since ${new Date(status.startedAt).toLocaleTimeString()}`
    : 'Screencast idle';
}

async function loadScreenStatus() {
  try {
    const response = await fetchWithAuth('/api/screencast/status');
    const payload = await response.json();
    updateScreenStatus(payload);
  } catch (_) {}
}

async function startScreenStream() {
  try {
    const response = await fetchWithAuth('/api/screencast/start', { method: 'POST' });
    const payload = await response.json();
    updateScreenStatus(payload);
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

async function stopScreenStream() {
  try {
    const response = await fetchWithAuth('/api/screencast/stop', { method: 'POST' });
    const payload = await response.json();
    updateScreenStatus(payload);
  } catch (error) {
    showSlideInNotification(error.message, 'error');
  }
}

function handleScreenFrame(data) {
  screenFrame.src = `data:${data.format || 'image/jpeg'};base64,${data.data}`;
}

// --- Voice Memo & Media Staging State ---
let voiceMemoEnabled = localStorage.getItem('omni_voice_memo_enabled') !== 'false';
let isRecordingAudio = false;
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let recordStartTime = 0;
let recordTimerInterval = null;
let stagedAudio = null;
let stagedImage = null;

function updateVoiceMemoSettingUI() {
  if (voiceMemoSettingText) {
    voiceMemoSettingText.textContent = voiceMemoEnabled ? 'Enabled (On)' : 'Disabled (Off)';
  }
  if (voiceMemoSettingBtn) {
    voiceMemoSettingBtn.classList.toggle('active', voiceMemoEnabled);
  }
  if (voiceMemoBtn) {
    voiceMemoBtn.style.display = voiceMemoEnabled ? 'inline-flex' : 'none';
  }
  if (!voiceMemoEnabled && isRecordingAudio) {
    cancelAudioRecording();
  }
}

function setVoiceMemoEnabled(enabled) {
  voiceMemoEnabled = !!enabled;
  localStorage.setItem('omni_voice_memo_enabled', voiceMemoEnabled ? 'true' : 'false');
  updateVoiceMemoSettingUI();
  showSlideInNotification(`Voice memo ${voiceMemoEnabled ? 'enabled' : 'disabled'}`, 'info');
}

function formatTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function startAudioRecording() {
  if (!voiceMemoEnabled) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showSlideInNotification('Microphone access is not supported in this browser.', 'error');
    return;
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    let mimeType = 'audio/webm;codecs=opus';
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
        MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
          MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' : '';
    }

    mediaRecorder = mimeType ? new MediaRecorder(audioStream, { mimeType, audioBitsPerSecond: 64000 }) : new MediaRecorder(audioStream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      cleanupAudioStream();
      if (!isRecordingAudio) return;
      isRecordingAudio = false;

      const blobType = mediaRecorder.mimeType || mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunks, { type: blobType });
      const durationSeconds = Math.max(1, Math.round((Date.now() - recordStartTime) / 1000));

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const base64 = dataUrl.split(',')[1];
        stageAudio({
          name: `voice-memo-${Date.now()}`,
          mimeType: blobType,
          data: base64,
          durationSeconds,
          dataUrl,
          blob: audioBlob
        });
      };
      reader.readAsDataURL(audioBlob);
    };

    mediaRecorder.start(250);
    isRecordingAudio = true;
    recordStartTime = Date.now();

    if (voiceMemoBtn) voiceMemoBtn.style.display = 'none';
    if (voiceRecordingBar) voiceRecordingBar.style.display = 'flex';
    if (recordingTimer) recordingTimer.textContent = '00:00';

    if (recordTimerInterval) clearInterval(recordTimerInterval);
    recordTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      if (recordingTimer) recordingTimer.textContent = formatTimer(elapsed);
      if (elapsed >= 300) {
        stopAudioRecording();
      }
    }, 250);

  } catch (err) {
    cleanupAudioStream();
    isRecordingAudio = false;
    if (voiceMemoBtn) voiceMemoBtn.style.display = voiceMemoEnabled ? 'inline-flex' : 'none';
    if (voiceRecordingBar) voiceRecordingBar.style.display = 'none';
    showSlideInNotification(`Microphone error: ${err.message || 'Access denied'}`, 'error');
  }
}

function stopAudioRecording() {
  if (recordTimerInterval) {
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
  }
  if (voiceRecordingBar) voiceRecordingBar.style.display = 'none';
  if (voiceMemoBtn) voiceMemoBtn.style.display = voiceMemoEnabled ? 'inline-flex' : 'none';

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function cancelAudioRecording() {
  if (recordTimerInterval) {
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
  }
  isRecordingAudio = false;
  if (voiceRecordingBar) voiceRecordingBar.style.display = 'none';
  if (voiceMemoBtn) voiceMemoBtn.style.display = voiceMemoEnabled ? 'inline-flex' : 'none';

  cleanupAudioStream();
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  audioChunks = [];
}

function cleanupAudioStream() {
  if (audioStream) {
    try {
      audioStream.getTracks().forEach((track) => track.stop());
    } catch (_) {}
    audioStream = null;
  }
}

function stageAudio(item) {
  stagedAudio = item;
  renderStagedMedia();
  showSlideInNotification('Voice memo attached. Add text or send.', 'info');
}

function clearStagedAudio() {
  stagedAudio = null;
  renderStagedMedia();
}

function clearStagedImage() {
  stagedImage = null;
  if (imageInput) imageInput.value = '';
  if (imageUploadBtn) {
    imageUploadBtn.classList.remove('active');
  }
  renderStagedMedia();
}

function renderStagedMedia() {
  if (!stagedMediaSlot) return;
  stagedMediaSlot.innerHTML = '';

  if (stagedAudio) {
    const card = document.createElement('div');
    card.className = 'staged-media-card';
    const sizeKb = Math.round(((stagedAudio.data?.length || 0) * 0.75) / 1024);
    card.innerHTML = `
      <div class="staged-audio-preview">
        <div class="staged-audio-info">
          <span class="staged-audio-title">🎙️ Voice Memo (${formatTimer(stagedAudio.durationSeconds)})</span>
          <span>~${sizeKb} KB</span>
        </div>
        <audio class="staged-audio-player" src="${stagedAudio.dataUrl}" controls preload="metadata"></audio>
      </div>
      <button class="staged-media-discard" id="discardAudioBtn" type="button" aria-label="Discard voice memo" title="Discard">✕</button>
    `;
    card.querySelector('#discardAudioBtn')?.addEventListener('click', clearStagedAudio);
    stagedMediaSlot.appendChild(card);
  }

  if (stagedImage) {
    const card = document.createElement('div');
    card.className = 'staged-media-card';
    card.innerHTML = `
      <img src="${stagedImage.dataUrl}" style="width: 38px; height: 38px; object-fit: cover; border-radius: var(--radius-xs);" />
      <div style="flex: 1; min-width: 0;">
        <div class="staged-audio-title">${stagedImage.name}</div>
        <div style="font-size: var(--font-size-xs); color: var(--text-muted);">Attached image (ready to send)</div>
      </div>
      <button class="staged-media-discard" id="discardImgBtn" type="button" aria-label="Discard image" title="Discard">✕</button>
    `;
    card.querySelector('#discardImgBtn')?.addEventListener('click', clearStagedImage);
    stagedMediaSlot.appendChild(card);
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.onopen = () => {
    updateStatus(true);
    loadSnapshot();
    fetchAppState();
    loadQuickCommands();
    loadScreenStatus();
    loadSuggestions();
    loadSessionStats();
    loadQuota();
    loadTimeline();
  };

  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'error':
        if (data.message === 'Unauthorized') {
          window.location.href = '/login.html';
        }
        break;
      case 'snapshot_update':
        if (data.agentActivity !== undefined) {
          updateAgentActivity(data.agentActivity);
        }
        if (data.isGenerating !== undefined) {
          const isAct = Boolean(data.isGenerating || isActiveWorkState(data.agentActivity));
          stopBtn?.classList.toggle('active', isAct);
        }
        if (!state.userIsScrolling) {
          loadSnapshot();
        }
        break;
      case 'action_required':
        if (data.action && actedActionIds.has(data.action.id)) {
          break;
        }
        renderActionCard(data.action);
        break;
      case 'action_resolved':
        snoozedActionId = null;
        closePlanPreviewModal();
        renderActionCard(null);
        break;
      case 'cdp_status':
        handleCDPStatus(data.status);
        break;
      case 'status_test':
        if (isDevMode) {
          testStatus(data.mode, data.text, data.durationMs);
        }
        break;
      case 'notification':
        if (data.event === 'action_required') {
          if (data.action) {
            if (actedActionIds.has(data.action.id)) {
              break;
            }
            renderActionCard(data.action);
          } else {
            showActionRequiredPrompt(data.message);
          }
        } else {
          showSlideInNotification(
            data.message,
            data.event?.includes('error')
              ? 'error'
              : data.event?.includes('success') || data.event?.includes('approved')
                ? 'success'
                : 'warning'
          );
        }
        break;
      case 'terminal_output':
        terminalView.handleOutput(data.entry);
        break;
      case 'terminal_state':
        terminalView.handleState(data.state);
        break;
      case 'screen_status':
        updateScreenStatus(data.status);
        break;
      case 'screen_frame':
        handleScreenFrame(data);
        break;
      case 'quick_commands_updated':
        state.quickCommands = data.commands || state.quickCommands;
        renderQuickCommands();
        break;
      case 'suggestion_state':
        setSuggestionState(data);
        break;
      case 'stats_state':
        setStatsState(data.stats || data);
        break;
      case 'quota_state':
        setQuotaState(data.quota || data);
        break;
      case 'timeline_state':
        setTimelineState(data.timeline || data);
        break;
      case 'suggestion':
        if (data.event === 'new_suggestion' && data.suggestion) {
          showSuggestionPrompt(data.suggestion);
          showSlideInNotification(
            `Supervisor queued: ${formatSuggestionLabel(data.suggestion)}`,
            data.suggestion.action === 'accept' ? 'success' : 'warning'
          );
        } else if (data.event === 'approved') {
          showSlideInNotification('A suggestion was approved.', 'success');
          document.getElementById('suggestion-prompt-layer')?.remove();
        } else if (data.event === 'rejected') {
          showSlideInNotification('A suggestion was rejected.', 'warning');
          document.getElementById('suggestion-prompt-layer')?.remove();
        } else if (data.event === 'expired') {
          showSlideInNotification('A pending suggestion expired.', 'warning');
        }
        break;
      default:
        break;
    }
  };

  state.ws.onclose = () => {
    updateStatus(false);
    setTimeout(connectWebSocket, 2000);
  };
}

sendBtn.addEventListener('click', sendMessage);
refreshBtn.addEventListener('click', () => {
  loadSnapshot();
  fetchAppState();
});
stopBtn.addEventListener('click', async () => {
  try {
    const res = await fetchWithAuth('/stop', { method: 'POST' });
    const data = await res.json();
    if (data?.success) {
      showSlideInNotification('Generation stopped', 'info');
    } else {
      showSlideInNotification(data?.error || 'No active generation to stop', 'warning');
    }
  } catch (err) {
    showSlideInNotification('Failed to stop generation', 'error');
  }
});
newChatBtn.addEventListener('click', startNewChat);
historyBtn.addEventListener('click', showChatHistory);
historyBackBtn.addEventListener('click', hideChatHistory);
scrollToBottomBtn.addEventListener('click', () => {
  state.userScrollLockUntil = 0;
  state.userIsScrolling = false;
  scrollToBottom();
});
if (overflowMenuBtn && headerOverflowDropdown) {
  overflowMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = headerOverflowDropdown.hasAttribute('hidden');
    if (isHidden) {
      headerOverflowDropdown.removeAttribute('hidden');
    } else {
      headerOverflowDropdown.setAttribute('hidden', '');
    }
  });

  document.addEventListener('click', (e) => {
    if (!headerOverflowDropdown.contains(e.target) && e.target !== overflowMenuBtn) {
      headerOverflowDropdown.setAttribute('hidden', '');
    }
  });

  headerOverflowDropdown.addEventListener('click', (e) => {
    if (e.target.closest('.overflow-item')) {
      headerOverflowDropdown.setAttribute('hidden', '');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !headerOverflowDropdown.hasAttribute('hidden')) {
      headerOverflowDropdown.setAttribute('hidden', '');
    }
  });
}

const statusBadgeEl = document.getElementById('statusBadge');
if (statusBadgeEl) {
  statusBadgeEl.addEventListener('click', () => {
    if (isCDPConnected) {
      const act = currentAgentActivity && currentAgentActivity.toLowerCase() !== 'idle' ? ` · ${currentAgentActivity}` : ' · Ready';
      showSlideInNotification(`Antigravity Connected${act}`, 'success');
    } else {
      showSlideInNotification('Antigravity Offline · Reconnecting...', 'warning');
    }
  });
}

const devModeOverflowBtn = document.getElementById('devModeOverflowBtn');
if (devModeOverflowBtn) {
  if (isDevMode) {
    devModeOverflowBtn.hidden = false;
    devModeOverflowBtn.addEventListener('click', () => {
      openModal(
        'Developer Diagnostics',
        [
          { label: 'Status: Cycle All Modes', value: 'cycle' },
          { label: 'Status: Live & Idle', value: 'idle' },
          { label: 'Status: Working...', value: 'working' },
          { label: 'Status: Thinking...', value: 'thinking' },
          { label: 'Status: Reconnecting', value: 'reconnecting' },
          { label: 'Status: Reset to Live State', value: 'reset' },
          { label: 'Mock: Plan Approval Card', value: 'mock_plan' },
          { label: 'Mock: Command Action Card', value: 'mock_cmd' },
          { label: 'Mock: Question Action Card', value: 'mock_question' },
          { label: '⚠️ Disable Developer Mode', value: 'disable' },
        ],
        async (selected) => {
          if (selected === 'disable') {
            localStorage.removeItem('omni_dev_mode');
            window.location.reload();
          } else if (selected === 'mock_plan') {
            await fetchWithAuth('/api/action/mock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'plan' }),
            });
          } else if (selected === 'mock_cmd') {
            await fetchWithAuth('/api/action/mock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'command' }),
            });
          } else if (selected === 'mock_question') {
            await fetchWithAuth('/api/action/mock', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'question' }),
            });
          } else {
            testStatus(selected);
          }
        }
      );
    });
  } else {
    devModeOverflowBtn.hidden = true;
  }
}

modeBtn?.addEventListener('click', () =>
  openModal(
    'Select Mode',
    ['Fast', 'Planning'].map((value) => ({ label: value, value })),
    async (value) => {
      const response = await fetchWithAuth('/set-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: value }),
      });
      const payload = await response.json();
      if (payload.success) {
        state.currentMode = value;
        if (modeText) modeText.textContent = value;
        modeBtn.classList.toggle('active', value === 'Planning');
      }
    }
  )
);
modelBtn.addEventListener('click', async () => {
  let modelList = DEFAULT_MODELS;

  // Prefer dynamically configured models from language server quota if already loaded
  if (Array.isArray(state.quota?.models) && state.quota.models.length > 0) {
    const fromQuota = Array.from(
      new Set(
        state.quota.models.map((m) => m.label || m.name).filter(Boolean)
      )
    );
    if (fromQuota.length > 0) modelList = fromQuota;
  } else {
    // Otherwise fetch the latest configured models from /api/models
    try {
      const res = await fetchWithAuth('/api/models');
      const data = await res.json();
      if (Array.isArray(data?.models) && data.models.length > 0) {
        modelList = data.models;
      }
    } catch (_) {}
  }

  openModal(
    'Select Model',
    modelList.map((value) => ({ label: value, value })),
    async (value) => {
      const response = await fetchWithAuth('/set-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: value }),
      });
      const payload = await response.json();
      if (payload.success) {
        modelText.textContent = value;
      }
    }
  );
});
targetBtn.addEventListener('click', showTargetSelector);
themeBtn.addEventListener('click', () =>
  openModal(
    'Theme',
    THEMES,
    (value) => applyTheme(value)
  )
);
workspaceToggleBtn.addEventListener('click', () => toggleWorkspace());
workspaceCloseBtn.addEventListener('click', () => toggleWorkspace(false));
sessionStatsBtn?.addEventListener('click', async () => {
  await toggleWorkspace(true);
  await setWorkspacePanel('stats');
});
suggestionsBtn?.addEventListener('click', showSuggestionsQueue);
quotaBtn.addEventListener('click', async () => {
  const quota = await loadQuota();
  showQuotaPrompt(quota || state.quota);
});
modalCancelBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (event) => {
  if (event.target === modalOverlay) closeModal();
});
screenStartBtn.addEventListener('click', startScreenStream);
screenStopBtn.addEventListener('click', stopScreenStream);
imageUploadBtn.addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => {
  const [file] = imageInput.files || [];
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1];
      stagedImage = {
        name: file.name,
        mimeType: file.type,
        data: base64,
        dataUrl
      };
      if (imageUploadBtn) {
        imageUploadBtn.classList.add('active');
      }
      renderStagedMedia();
      showSlideInNotification('Image attached. Type context or click Send.', 'info');
    };
    reader.readAsDataURL(file);
  }
});
voiceMemoSettingBtn?.addEventListener('click', () => {
  setVoiceMemoEnabled(!voiceMemoEnabled);
});
voiceMemoBtn?.addEventListener('click', () => {
  startAudioRecording();
});
cancelRecordBtn?.addEventListener('click', () => {
  cancelAudioRecording();
});
doneRecordBtn?.addEventListener('click', () => {
  stopAudioRecording();
});
updateVoiceMemoSettingUI();

let compactModeEnabled = localStorage.getItem('omni_compact_mode') === 'true';

function updateCompactModeUI() {
  document.documentElement.classList.toggle('compact-mode', compactModeEnabled);
  document.body.classList.toggle('compact-mode', compactModeEnabled);
  if (compactModeText) {
    compactModeText.textContent = compactModeEnabled ? 'High Density (On)' : 'Standard (Off)';
  }
  if (compactModeBtn) {
    compactModeBtn.classList.toggle('active', compactModeEnabled);
  }
}

function setCompactModeEnabled(enabled) {
  compactModeEnabled = !!enabled;
  localStorage.setItem('omni_compact_mode', compactModeEnabled ? 'true' : 'false');
  updateCompactModeUI();
  showSlideInNotification(`Compact mode ${compactModeEnabled ? 'enabled' : 'disabled'}`, 'info');
}

compactModeBtn?.addEventListener('click', () => {
  setCompactModeEnabled(!compactModeEnabled);
});
updateCompactModeUI();
enableHttpsBtn.addEventListener('click', enableHttps);
dismissSslBtn.addEventListener('click', dismissSslBanner);
messageInput.addEventListener('focus', () => {
  ensurePromptVisible(true);
  setTimeout(() => ensurePromptVisible(false), 120);
  setTimeout(() => ensurePromptVisible(false), 360);
});
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${messageInput.scrollHeight}px`;
  ensurePromptVisible(false);
});
chatContainer.addEventListener('scroll', () => {
  state.userIsScrolling = true;
  state.userScrollLockUntil = Date.now() + USER_SCROLL_LOCK_DURATION;
  clearTimeout(idleTimer);

  const nearBottom =
    chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight <
    140;
  scrollToBottomBtn.classList.toggle('show', !nearBottom);
  if (nearBottom) {
    state.userScrollLockUntil = 0;
  }

  const now = Date.now();
  if (now - state.lastScrollSync > SCROLL_SYNC_DEBOUNCE) {
    state.lastScrollSync = now;
    clearTimeout(scrollSyncTimeout);
    scrollSyncTimeout = setTimeout(syncScrollToDesktop, 90);
  }

  idleTimer = setTimeout(() => {
    state.userIsScrolling = false;
  }, 5000);
});

let activeUserOptionKey = null;
let activeUserOptionTime = 0;
let optionSnapshotDebounce1 = null;
let optionSnapshotDebounce2 = null;

chatContainer.addEventListener('click', async (event) => {
  if (event.target.closest('.mobile-copy-btn')) return;

  // Ignore synthetic click on input if it bubbled from an option label click
  if (event.target.tagName === 'INPUT' && event.target.closest('label[for^="ask-opt-"]')) {
    return;
  }

  // Instant tactile tap & selection feedback for question options
  const optionLabel = event.target.closest('label[for^="ask-opt-"]') || event.target.closest('label');
  if (optionLabel) {
    const forAttr = optionLabel.getAttribute('for') || '';
    const isMultiSelect = optionLabel.closest('[role="radiogroup"]') === null &&
      (optionLabel.closest('.no-focus-ring')?.innerText?.includes('Multi-select') ||
       optionLabel.querySelector('input[type="checkbox"]') !== null);

    if (isMultiSelect) {
      const isSelected = optionLabel.classList.contains('omni-selected') || optionLabel.getAttribute('data-checked') === 'true';
      if (isSelected) {
        optionLabel.classList.remove('omni-selected');
        optionLabel.removeAttribute('data-checked');
        const input = optionLabel.querySelector('input') || (forAttr ? document.getElementById(forAttr) : null);
        if (input) {
          input.checked = false;
          input.removeAttribute('checked');
        }
      } else {
        optionLabel.classList.add('omni-selected');
        optionLabel.setAttribute('data-checked', 'true');
        const input = optionLabel.querySelector('input') || (forAttr ? document.getElementById(forAttr) : null);
        if (input) {
          input.checked = true;
          input.setAttribute('checked', '');
        }
      }
    } else {
      // Single-select radio: update selection key and lock against stale snapshot overrides
      activeUserOptionKey = forAttr;
      activeUserOptionTime = Date.now();

      const groupContainer = optionLabel.closest('[role="radiogroup"]') || optionLabel.parentElement?.parentElement || chatContainer;
      groupContainer.querySelectorAll('label[for^="ask-opt-"]').forEach((l) => {
        if (l === optionLabel) {
          l.classList.add('omni-selected');
          l.setAttribute('data-checked', 'true');
          const inp = l.querySelector('input') || (l.getAttribute('for') ? document.getElementById(l.getAttribute('for')) : null);
          if (inp) {
            inp.checked = true;
            inp.setAttribute('checked', '');
          }
        } else {
          l.classList.remove('omni-selected');
          l.removeAttribute('data-checked');
          const inp = l.querySelector('input') || (l.getAttribute('for') ? document.getElementById(l.getAttribute('for')) : null);
          if (inp) {
            inp.checked = false;
            inp.removeAttribute('checked');
          }
        }
      });
    }
  }

  // Instant feedback on button submission
  const submitBtn = event.target.closest('button[data-testid="interaction-continue-button"]');
  if (submitBtn) {
    submitBtn.classList.add('omni-submitting');
  }

  const annotatedTarget = event.target.closest('[data-omni-idx]');
  const interactionTarget = event.target.closest('label, input, button, [role="button"], [role="radio"], [role="checkbox"], [data-testid^="interaction-"]');
  const target = annotatedTarget || interactionTarget || event.target.closest('div, span, p, summary, details');
  if (!target) return;

  const isInteractionEl = !!interactionTarget;
  const text = (target.getAttribute?.('data-omni-text') || target.innerText || '').trim();
  if (!annotatedTarget && !isInteractionEl && (!/Thought|Thinking/i.test(text) || text.length > 500)) return;

  const omniIndexValue = target.getAttribute?.('data-omni-idx');
  const omniIndex = omniIndexValue !== null ? Number.parseInt(omniIndexValue, 10) : null;

  try {
    const clickTarget = interactionTarget || target;
    await fetchWithAuth('/remote-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selector: clickTarget.tagName.toLowerCase(),
        index: Number.isFinite(omniIndex) ? omniIndex : 0,
        omniIndex: Number.isFinite(omniIndex) ? omniIndex : undefined,
        textContent: text.split('\n')[0].trim(),
      }),
    });

    // Debounce subsequent snapshot fetches so rapid clicks do not trigger stale snapshot rubber-banding
    clearTimeout(optionSnapshotDebounce1);
    clearTimeout(optionSnapshotDebounce2);
    optionSnapshotDebounce1 = setTimeout(loadSnapshot, 300);
    optionSnapshotDebounce2 = setTimeout(loadSnapshot, 800);
  } catch (_) {}
});
document.querySelectorAll('.workspace-tab').forEach((button) => {
  button.addEventListener('click', () => setWorkspacePanel(button.dataset.panel));
});

function ensurePromptVisible(smooth = false) {
  const inputSec = document.querySelector('.input-section');
  if (inputSec) {
    try {
      inputSec.scrollIntoView({ block: 'end', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    } catch (_) {
      inputSec.scrollIntoView(false);
    }
  }
  if (messageInput) {
    messageInput.scrollTop = messageInput.scrollHeight;
  }
}

function adjustViewport() {
  if (!window.visualViewport) return;
  const vh = window.visualViewport.height;
  document.documentElement.style.setProperty('--visual-viewport-height', `${vh}px`);
  document.body.style.height = `${vh}px`;
  if (document.activeElement === messageInput) {
    ensurePromptVisible(false);
  }
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', adjustViewport);
  window.visualViewport.addEventListener('scroll', adjustViewport);
  adjustViewport();
}

function setupTouchGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  chatContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  chatContainer.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1 && Date.now() - touchStartTime < 450) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(deltaX) > 75 && Math.abs(deltaY) < 55) {
        if (deltaX < 0) {
          toggleWorkspace(true);
        } else if (deltaX > 0 && state.workspaceOpen) {
          toggleWorkspace(false);
        }
      }
    }
  }, { passive: true });
}

applyTheme(state.currentTheme, false);
updateSuggestionLabel();
updateSessionStatsLabel();
updateQuotaLabel();
registerServiceWorker();
checkSslStatus();
setupTouchGestures();
setupPlanPreviewModal();
connectWebSocket();
fetchAppState();
loadQuickCommands();
loadSuggestions();
loadSessionStats();
loadQuota();
loadTimeline();
checkChatStatus();
setInterval(fetchAppState, 5000);
setInterval(checkChatStatus, 10000);

