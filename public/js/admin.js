const metaGrid = document.getElementById('adminMetaGrid');
const tunnelStatus = document.getElementById('adminTunnelStatus');
const logsNode = document.getElementById('adminLogs');
const quickCommandsEditor = document.getElementById('quickCommandsEditor');
const refreshBtn = document.getElementById('adminRefreshBtn');
const tunnelStartBtn = document.getElementById('tunnelStartBtn');
const tunnelStopBtn = document.getElementById('tunnelStopBtn');
const tunnelProviderSelect = document.getElementById('tunnelProviderSelect');
const addCommandBtn = document.getElementById('adminAddCommandBtn');
const saveCommandsBtn = document.getElementById('adminSaveCommandsBtn');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
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

function createCommandRow(command = { icon: '•', label: '', prompt: '' }) {
  const row = document.createElement('div');
  row.className = 'quick-command-row';
  row.innerHTML = `
    <div class="quick-command-fields" style="flex:1">
      <input placeholder="Icon" value="${escapeHtml(command.icon || '•')}" data-field="icon" />
      <input placeholder="Label" value="${escapeHtml(command.label || '')}" data-field="label" />
      <textarea rows="3" placeholder="Prompt" data-field="prompt">${escapeHtml(command.prompt || '')}</textarea>
    </div>
    <button class="panel-btn danger" type="button">Remove</button>
  `;
  row.querySelector('button').addEventListener('click', () => row.remove());
  quickCommandsEditor.appendChild(row);
}

function collectCommands() {
  return Array.from(quickCommandsEditor.querySelectorAll('.quick-command-row')).map((row) => ({
    icon: row.querySelector('[data-field="icon"]').value.trim() || '•',
    label: row.querySelector('[data-field="label"]').value.trim(),
    prompt: row.querySelector('[data-field="prompt"]').value.trim(),
  }));
}

async function loadCommands() {
  const response = await fetchWithAuth('/api/quick-commands');
  const payload = await response.json();
  quickCommandsEditor.innerHTML = '';
  (payload.commands || []).forEach(createCommandRow);
}

async function saveCommands() {
  const commands = collectCommands();
  await fetchWithAuth('/api/admin/quick-commands', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commands }),
  });
  await loadCommands();
}

async function loadMetrics() {
  const [metricsResponse, logsResponse] = await Promise.all([
    fetchWithAuth('/api/admin/metrics'),
    fetchWithAuth('/api/admin/logs?limit=80'),
  ]);
  const metrics = await metricsResponse.json();
  const logsPayload = await logsResponse.json();
  const supervisorState = metrics.supervisor?.enabled ? 'Enabled' : 'Disabled';
  const supervisorDetails = [
    supervisorState,
    metrics.supervisor?.provider,
    metrics.supervisor?.model,
  ].filter(Boolean).join(' · ');

  metaGrid.innerHTML = `
    <div class="meta-card"><strong>Version</strong><div>${escapeHtml(metrics.version)}</div></div>
    <div class="meta-card"><strong>Uptime</strong><div>${Math.round(metrics.uptime)}s</div></div>
    <div class="meta-card"><strong>WebSocket Clients</strong><div>${metrics.wsClients}</div></div>
    <div class="meta-card"><strong>CDP</strong><div>${metrics.cdpConnected ? 'Connected' : 'Disconnected'}</div></div>
    <div class="meta-card"><strong>Workspace</strong><div>${escapeHtml(metrics.workspaceRoot)}</div></div>
    <div class="meta-card"><strong>Supervisor</strong><div>${escapeHtml(supervisorDetails)}</div></div>
  `;

  if (metrics.tunnel?.provider) {
    tunnelProviderSelect.value = metrics.tunnel.provider;
  }

  tunnelStatus.textContent = metrics.tunnel?.url
    ? `Provider: ${metrics.tunnel.provider || 'unknown'}\nURL: ${metrics.tunnel.url}\n\nStarted at: ${metrics.tunnel.startedAt || 'n/a'}`
    : metrics.tunnel?.error || 'No active tunnel.';

  logsNode.textContent = (logsPayload.logs || [])
    .map((line) => `[${line.timestamp}] ${line.level.toUpperCase()} ${line.message}`)
    .join('\n');
}

async function startTunnel() {
  const provider = tunnelProviderSelect.value || 'cloudflare';
  await fetchWithAuth('/api/admin/tunnel/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
  await loadMetrics();
}

async function stopTunnel() {
  await fetchWithAuth('/api/admin/tunnel/stop', { method: 'POST' });
  await loadMetrics();
}

refreshBtn.addEventListener('click', loadMetrics);
tunnelStartBtn.addEventListener('click', startTunnel);
tunnelStopBtn.addEventListener('click', stopTunnel);
addCommandBtn.addEventListener('click', () => createCommandRow());
saveCommandsBtn.addEventListener('click', saveCommands);

// ─── Developer & Diagnostic Tools ──────────────────────────────────
const toggleDevModeBtn = document.getElementById('toggleDevModeBtn');
const adminDevStatus = document.getElementById('adminDevStatus');

function updateDevModeUI() {
  const isDev = localStorage.getItem('omni_dev_mode') === 'true';
  if (toggleDevModeBtn) {
    toggleDevModeBtn.textContent = isDev ? 'Disable Dev Mode' : 'Enable Dev Mode';
    toggleDevModeBtn.className = isDev ? 'panel-btn danger' : 'panel-btn primary';
  }
  if (adminDevStatus) {
    adminDevStatus.textContent = isDev
      ? 'Developer Mode is ENABLED for this browser. Diagnostic menu is accessible in the chat view.'
      : 'Developer Mode is DISABLED. Mobile chat displays clean production UI only.';
  }
}

if (toggleDevModeBtn) {
  toggleDevModeBtn.addEventListener('click', () => {
    const isDev = localStorage.getItem('omni_dev_mode') === 'true';
    if (isDev) {
      localStorage.removeItem('omni_dev_mode');
    } else {
      localStorage.setItem('omni_dev_mode', 'true');
    }
    updateDevModeUI();
  });
}

document.querySelectorAll('[data-status-mode]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const mode = btn.dataset.statusMode;
    if (adminDevStatus) adminDevStatus.textContent = `Triggering status simulation: ${mode}...`;
    try {
      const res = await fetchWithAuth('/api/status/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (adminDevStatus) adminDevStatus.textContent = `Server response (${res.status}): ${data.error || 'Failed to trigger mock status'}`;
      } else {
        if (adminDevStatus) adminDevStatus.textContent = `Status simulation "${mode}" broadcast to all connected clients!`;
      }
    } catch (err) {
      if (adminDevStatus) adminDevStatus.textContent = `Network error: ${err.message}`;
    }
  });
});

document.querySelectorAll('[data-action-type]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const type = btn.dataset.actionType;
    if (adminDevStatus) adminDevStatus.textContent = `Triggering action mock: ${type}...`;
    try {
      const res = await fetchWithAuth('/api/action/mock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (adminDevStatus) adminDevStatus.textContent = `Server response (${res.status}): ${data.error || 'Failed to trigger mock action'}`;
      } else {
        if (adminDevStatus) adminDevStatus.textContent = `Mock action "${type}" generated and displayed on active mobile views!`;
      }
    } catch (err) {
      if (adminDevStatus) adminDevStatus.textContent = `Network error: ${err.message}`;
    }
  });
});

updateDevModeUI();
loadCommands();
loadMetrics();
setInterval(loadMetrics, 6000);

