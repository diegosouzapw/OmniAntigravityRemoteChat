import { describe, expect, it, beforeEach } from 'vitest';
import {
    withSendLock,
    sendHash,
    isRecentDuplicate,
    recentSends,
    SEND_DEDUPE_MS,
    SEND_BACKOFF_MS
} from '../../src/server.js';

describe('withSendLock (Promise-chain concurrency serializer)', () => {
    it('serializes concurrent tasks strictly in order without interleaving', async () => {
        const order = [];
        const task1 = withSendLock(async () => {
            order.push('start_1');
            await new Promise((r) => setTimeout(r, 40));
            order.push('end_1');
            return 'res_1';
        });

        const task2 = withSendLock(async () => {
            order.push('start_2');
            await new Promise((r) => setTimeout(r, 10));
            order.push('end_2');
            return 'res_2';
        });

        const [r1, r2] = await Promise.all([task1, task2]);

        expect(r1).toBe('res_1');
        expect(r2).toBe('res_2');
        expect(order).toEqual(['start_1', 'end_1', 'start_2', 'end_2']);
    });

    it('resolves a {threw: err} sentinel instead of rejecting on task error', async () => {
        const error = new Error('simulated injection failure');
        const outcome = await withSendLock(async () => {
            throw error;
        });

        expect(outcome).toBeDefined();
        expect(outcome.threw).toBe(error);
        expect(outcome.threw.message).toBe('simulated injection failure');
    });

    it('survives an error without poisoning subsequent tasks in the chain', async () => {
        const failedTask = await withSendLock(async () => {
            throw new Error('failed');
        });
        expect(failedTask.threw).toBeDefined();

        const subsequentTask = await withSendLock(async () => {
            return 'alive_and_well';
        });
        expect(subsequentTask).toBe('alive_and_well');
    });

    it('preserves FIFO ordering across throwing tasks', async () => {
        const events = [];
        const task1 = withSendLock(async () => {
            events.push('t1_start');
            await new Promise((r) => setTimeout(r, 30));
            events.push('t1_throw');
            throw new Error('t1_err');
        });

        const task2 = withSendLock(async () => {
            events.push('t2_start');
            await new Promise((r) => setTimeout(r, 10));
            events.push('t2_done');
            return 't2_ok';
        });

        const [o1, o2] = await Promise.all([task1, task2]);
        expect(o1.threw).toBeDefined();
        expect(o2).toBe('t2_ok');
        expect(events).toEqual(['t1_start', 't1_throw', 't2_start', 't2_done']);
    });
});

describe('Message Deduplication & Hashing', () => {
    beforeEach(() => {
        recentSends.clear();
    });

    it('computes consistent 16-character hex hash', () => {
        const hash1 = sendHash('Hello world');
        const hash2 = sendHash('Hello world');
        const hashOther = sendHash('Hello world!');

        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(16);
        expect(hash1).not.toBe(hashOther);
    });

    it('identifies recent duplicates within dedupe window', () => {
        const hash = sendHash('Test duplicate prompt');
        expect(isRecentDuplicate(hash)).toBe(false);

        recentSends.set(hash, Date.now());
        expect(isRecentDuplicate(hash)).toBe(true);
    });

    it('expires and purges entries older than SEND_DEDUPE_MS', () => {
        const hash = sendHash('Old message');
        const expiredTimestamp = Date.now() - (SEND_DEDUPE_MS + 1000);

        recentSends.set(hash, expiredTimestamp);
        expect(isRecentDuplicate(hash)).toBe(false);
        expect(recentSends.has(hash)).toBe(false);
    });

    it('has standard backoff intervals configured', () => {
        expect(SEND_BACKOFF_MS).toEqual([1000, 2000, 4000]);
        expect(SEND_DEDUPE_MS).toBe(120_000);
    });
});
