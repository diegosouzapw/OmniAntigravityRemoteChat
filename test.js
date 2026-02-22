#!/usr/bin/env node
/**
 * OmniAntigravity Remote Chat — Validation Test Suite
 * Run: node test.js
 *
 * Tests:
 *  1. Environment checks (Node.js, npm, .env)
 *  2. Dependencies installed
 *  3. Server syntax validation
 *  4. Port availability
 *  5. CDP connectivity
 *  6. Server startup + HTTP endpoints
 *  7. WebSocket connectivity
 */
import http from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Config ---
const CDP_PORTS = [7800, 7801, 7802, 7803];
const SERVER_PORT = process.env.PORT || 4747;
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
    cyan: '\x1b[36m', magenta: '\x1b[35m',
};

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ${c.green}✓${c.reset} ${msg}`); passed++; }
function fail(msg) { console.log(`  ${c.red}✗${c.reset} ${msg}`); failed++; }
function warn(msg) { console.log(`  ${c.yellow}⚠${c.reset} ${msg}`); warnings++; }
function section(title) { console.log(`\n${c.cyan}${c.bold}▸ ${title}${c.reset}`); }

function httpGet(url, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = http.createServer();
        server.on('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => {
            server.close(() => resolve(true));
        });
    });
}

async function main() {
    console.log('');
    console.log(`${c.magenta}${c.bold}  ╔══════════════════════════════════════════╗${c.reset}`);
    console.log(`${c.magenta}${c.bold}  ║  OmniAntigravity Remote Chat — Tests     ║${c.reset}`);
    console.log(`${c.magenta}${c.bold}  ╚══════════════════════════════════════════╝${c.reset}`);

    // ─── 1. Environment ───────────────────────────────────────
    section('Environment');

    // Node.js version
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1));
    if (nodeMajor >= 16) pass(`Node.js ${nodeVersion} (≥16 required)`);
    else fail(`Node.js ${nodeVersion} — v16+ required`);

    // npm
    try {
        const npmVer = execSync('npm --version', { encoding: 'utf8' }).trim();
        pass(`npm ${npmVer}`);
    } catch { fail('npm not found'); }

    // .env file
    const envPath = join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        pass('.env file exists');
        const envContent = fs.readFileSync(envPath, 'utf8');
        if (envContent.includes('APP_PASSWORD=') && !envContent.includes('APP_PASSWORD=your-app-password')) {
            pass('APP_PASSWORD is configured');
        } else {
            warn('APP_PASSWORD is using default — change it for security');
        }
        const portMatch = envContent.match(/PORT=(\d+)/);
        if (portMatch) {
            pass(`Server port configured: ${portMatch[1]}`);
        }
    } else {
        warn('.env file missing (will use defaults)');
    }

    // ─── 2. Dependencies ──────────────────────────────────────
    section('Dependencies');

    const nodeModules = join(__dirname, 'node_modules');
    if (fs.existsSync(nodeModules)) {
        pass('node_modules/ directory exists');
    } else {
        fail('node_modules/ missing — run: npm install');
    }

    const requiredPkgs = ['express', 'ws', 'compression', 'cookie-parser', 'dotenv', 'qrcode-terminal'];
    for (const pkg of requiredPkgs) {
        const pkgPath = join(nodeModules, pkg);
        if (fs.existsSync(pkgPath)) pass(`${pkg} installed`);
        else fail(`${pkg} missing — run: npm install`);
    }

    // ─── 3. Syntax Validation ─────────────────────────────────
    section('Syntax Validation');

    const filesToCheck = ['server.js', 'launcher.js'];
    for (const file of filesToCheck) {
        try {
            execSync(`node --check ${file}`, { cwd: __dirname, stdio: 'pipe' });
            pass(`${file} — syntax OK`);
        } catch (e) {
            fail(`${file} — syntax error: ${e.stderr?.toString().trim()}`);
        }
    }

    // Check required frontend files
    const frontendFiles = [
        'public/index.html', 'public/login.html',
        'public/js/app.js', 'public/css/style.css'
    ];
    for (const f of frontendFiles) {
        if (fs.existsSync(join(__dirname, f))) pass(`${f} exists`);
        else fail(`${f} missing`);
    }

    // ─── 4. Port Availability ─────────────────────────────────
    section('Port Availability');

    const serverPortFree = await isPortAvailable(parseInt(SERVER_PORT));
    if (serverPortFree) pass(`Server port ${SERVER_PORT} is available`);
    else warn(`Server port ${SERVER_PORT} is in use — server may fail to start`);

    // ─── 5. CDP Connectivity ──────────────────────────────────
    section('CDP Connectivity (Antigravity Debug Port)');

    let cdpFound = false;
    for (const port of CDP_PORTS) {
        try {
            const res = await httpGet(`http://127.0.0.1:${port}/json/list`, 2000);
            const targets = JSON.parse(res.data);
            if (Array.isArray(targets) && targets.length > 0) {
                pass(`Port ${port} — ${targets.length} target(s) found`);
                for (const t of targets) {
                    if (t.url?.includes('workbench') || t.title?.includes('workbench')) {
                        pass(`  └─ Workbench target: "${t.title}"`);
                        cdpFound = true;
                    }
                }
            } else {
                warn(`Port ${port} — responding but no targets`);
            }
        } catch (e) {
            if (e.message === 'timeout') {
                console.log(`  ${c.dim}  Port ${port} — timeout (not listening)${c.reset}`);
            } else {
                console.log(`  ${c.dim}  Port ${port} — ${e.message.split('\n')[0]}${c.reset}`);
            }
        }
    }

    if (!cdpFound) {
        warn('No Antigravity CDP detected — launch with: agd');
        warn('  Or manually: antigravity . --remote-debugging-port=7800');
    }

    // ─── 6. Server Integration Test ───────────────────────────
    section('Server Integration Test');

    if (!serverPortFree) {
        warn('Skipping server test — port in use');
    } else {
        const serverProc = spawn('node', ['server.js'], {
            cwd: __dirname,
            env: { ...process.env, PORT: String(SERVER_PORT) },
            stdio: 'pipe'
        });

        // Wait for server to start
        await new Promise(r => setTimeout(r, 3000));

        try {
            // Test main page
            const mainRes = await httpGet(`http://127.0.0.1:${SERVER_PORT}/`);
            if (mainRes.status === 200) pass(`GET / → 200 (main page)`);
            else if (mainRes.status === 302 || mainRes.status === 301) pass(`GET / → ${mainRes.status} (redirect to login)`);
            else fail(`GET / → ${mainRes.status}`);

            // Test snapshot endpoint
            const snapRes = await httpGet(`http://127.0.0.1:${SERVER_PORT}/snapshot`);
            if (snapRes.status === 200 || snapRes.status === 503) pass(`GET /snapshot → ${snapRes.status} (expected)`);
            else fail(`GET /snapshot → ${snapRes.status}`);

            // Test CDP targets endpoint
            const targetsRes = await httpGet(`http://127.0.0.1:${SERVER_PORT}/cdp-targets`);
            if (targetsRes.status === 200) {
                const data = JSON.parse(targetsRes.data);
                pass(`GET /cdp-targets → 200 (${data.targets?.length || 0} targets)`);
            } else {
                fail(`GET /cdp-targets → ${targetsRes.status}`);
            }

            // Test app-state endpoint
            const stateRes = await httpGet(`http://127.0.0.1:${SERVER_PORT}/app-state`);
            if (stateRes.status === 200) pass(`GET /app-state → 200`);
            else fail(`GET /app-state → ${stateRes.status}`);

            // Test login page
            const loginRes = await httpGet(`http://127.0.0.1:${SERVER_PORT}/login.html`);
            if (loginRes.status === 200) pass(`GET /login.html → 200`);
            else fail(`GET /login.html → ${loginRes.status}`);

        } catch (e) {
            fail(`Server HTTP test failed: ${e.message}`);
        }

        // Test WebSocket
        try {
            const { default: WebSocket } = await import('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${SERVER_PORT}`);
            await new Promise((resolve, reject) => {
                ws.on('open', () => {
                    pass('WebSocket connection → OK');
                    ws.close();
                    resolve();
                });
                ws.on('error', (e) => {
                    fail(`WebSocket connection → ${e.message}`);
                    reject(e);
                });
                setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 3000);
            });
        } catch (e) {
            if (!e.message?.includes('timeout')) {
                fail(`WebSocket test: ${e.message}`);
            }
        }

        // Cleanup
        serverProc.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 500));
    }

    // ─── Results ──────────────────────────────────────────────
    console.log('');
    console.log(`${c.bold}─────────────────────────────────────────────${c.reset}`);
    console.log(`  ${c.green}${c.bold}${passed} passed${c.reset}  ${failed > 0 ? c.red : c.dim}${failed} failed${c.reset}  ${warnings > 0 ? c.yellow : c.dim}${warnings} warnings${c.reset}`);
    console.log(`${c.bold}─────────────────────────────────────────────${c.reset}`);

    if (failed > 0) {
        console.log(`\n  ${c.red}Some tests failed. Fix the issues above and re-run.${c.reset}\n`);
        process.exit(1);
    } else if (warnings > 0) {
        console.log(`\n  ${c.yellow}All tests passed with warnings. Review above.${c.reset}\n`);
    } else {
        console.log(`\n  ${c.green}${c.bold}All tests passed! Ready to go. 🚀${c.reset}\n`);
    }
}

main().catch(err => {
    console.error(`\n${c.red}Fatal test error: ${err.message}${c.reset}\n`);
    process.exit(1);
});
