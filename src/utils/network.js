// @ts-check
/**
 * Network utilities — IP detection, local request checks, HTTP helpers.
 *
 * @module utils/network
 */

import http from 'http';
import os from 'os';

/**
 * Get local IP address for mobile access.
 * Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters (172.x.x.x from WSL/Docker).
 * @returns {string} Best local IP address or 'localhost'
 */
export function getLocalIP() {
    const interfaces = os.networkInterfaces();
    /** @type {Array<{address: string, name: string, priority: number}>} */
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    name,
                    priority: iface.address.startsWith('192.168.') ? 1 :
                        iface.address.startsWith('10.') ? 2 :
                            iface.address.startsWith('172.') ? 3 : 4
                });
            }
        }
    }

    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

/**
 * Check if a request originates from the local network (same Wi-Fi).
 * Returns false for requests coming through external proxies/tunnels.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isLocalRequest(req) {
    // Check for proxy headers (Cloudflare, ngrok, etc.)
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) {
        return false;
    }

    const ip = req.ip || req.socket.remoteAddress || '';

    return ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
        ip.startsWith('172.2') || ip.startsWith('172.3') ||
        ip.startsWith('::ffff:192.168.') ||
        ip.startsWith('::ffff:10.');
}

/**
 * HTTP GET JSON — lightweight helper without external dependencies.
 *
 * @param {string} url - URL to fetch
 * @returns {Promise<any>} Parsed JSON response
 */
export function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}
