// @ts-check
/**
 * Process management — port cleanup, availability checks, Antigravity launcher.
 *
 * @module utils/process
 */

import http from 'http';
import { execSync, spawn } from 'child_process';
import { PORTS } from '../config.js';

/**
 * Kill any existing process on the given port (prevents EADDRINUSE).
 *
 * @param {number} port
 * @returns {Promise<void>}
 */
export function killPortProcess(port) {
    try {
        if (process.platform === 'win32') {
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
                encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });
            const pids = new Set(
                result.trim().split('\n')
                    .map(line => line.trim().split(/\s+/).pop())
                    .filter(pid => pid && pid !== '0')
            );
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (_) { /* Process may have already exited */ }
            }
        } else {
            const result = execSync(`lsof -ti:${port}`, {
                encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
            });
            for (const pid of result.trim().split('\n').filter(Boolean)) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (_) { /* Process may have already exited */ }
            }
        }
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (_) {
        // No process found on port — this is fine
        return Promise.resolve();
    }
}

/**
 * Check if a specific port is free.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortFree(port) {
    return new Promise((resolve) => {
        const server = http.createServer();
        server.once('error', (err) => {
            resolve(/** @type {any} */(err).code !== 'EADDRINUSE');
        });
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        server.listen(port);
    });
}

/**
 * Launch a new Antigravity instance on the next available port.
 *
 * @returns {Promise<number>} The port the instance was launched on
 * @throws {Error} If no free port found between 7800-7850
 */
export async function launchAntigravity() {
    console.log('🚀 Attempting to launch a new Antigravity window...');

    let targetPort = null;
    for (let port = 7800; port <= 7850; port++) {
        if (await isPortFree(port)) {
            targetPort = port;
            break;
        }
    }

    if (!targetPort) {
        throw new Error('Could not find a free port between 7800-7850 to launch Antigravity');
    }

    if (!PORTS.includes(targetPort)) {
        PORTS.push(targetPort);
    }

    console.log(`Starting antigravity on port ${targetPort}...`);
    const subprocess = spawn('antigravity', [`--port=${targetPort}`], {
        detached: true,
        stdio: 'ignore'
    });
    subprocess.unref();

    await new Promise(r => setTimeout(r, 2500));
    return targetPort;
}
