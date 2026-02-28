// @ts-check
/**
 * Hash utilities.
 *
 * @module utils/hash
 */

/**
 * Simple djb2-style hash function. Used for snapshot change detection and token generation.
 *
 * @param {string} str - Input string to hash
 * @returns {string} Base-36 hash string
 */
export function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
}
