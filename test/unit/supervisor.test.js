import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AISupervisor,
  SuggestQueue,
  evaluateCommandHeuristics,
  extractPendingCommand,
} from '../../src/supervisor.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('supervisor heuristics', () => {
  it('marks rm commands as risky', () => {
    expect(evaluateCommandHeuristics('rm -rf /tmp/cache')).toEqual({
      safe: false,
      reason: 'heuristic-risky-command',
      riskLevel: 'critical',
    });
  });

  it('marks force push commands as risky', () => {
    expect(evaluateCommandHeuristics('git push --force origin main').safe).toBe(
      false
    );
  });

  it('marks npm test as safe', () => {
    expect(evaluateCommandHeuristics('npm test')).toEqual({
      safe: true,
      reason: 'heuristic-safe-command',
      riskLevel: 'safe',
    });
  });

  it('marks grep commands as safe', () => {
    expect(evaluateCommandHeuristics('grep -R "TODO" src').safe).toBe(true);
  });

  it('marks unknown commands as unsafe by default', () => {
    expect(evaluateCommandHeuristics('some-random-command')).toEqual({
      safe: false,
      reason: 'heuristic-unknown-command',
      riskLevel: 'warning',
    });
  });

  it('extracts a compact run-command summary from HTML', () => {
    const html =
      '<div><strong>Run Command</strong> npm test -- --runInBand <button>Accept</button></div>';
    expect(extractPendingCommand(html)).toContain('Run Command npm test -- --runInBand');
  });
});

describe('SuggestQueue', () => {
  it('adds pending suggestions and exposes them in pending order', () => {
    const queue = new SuggestQueue({ maxSize: 5, ttlMs: 60000 });
    const { suggestion, created } = queue.add({
      action: 'accept',
      command: 'Run Command npm test',
      reason: 'heuristic-safe-command',
    });

    expect(created).toBe(true);
    expect(queue.getPendingCount()).toBe(1);
    expect(queue.getPending()[0].id).toBe(suggestion.id);
  });

  it('deduplicates the same pending command signature', () => {
    const queue = new SuggestQueue({ maxSize: 5, ttlMs: 60000 });
    const first = queue.add({
      action: 'accept',
      command: 'Run Command npm test',
      reason: 'heuristic-safe-command',
    });
    const second = queue.add({
      action: 'accept',
      command: '  run   command   npm test  ',
      reason: 'heuristic-safe-command',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.suggestion.id).toBe(first.suggestion.id);
    expect(queue.getPendingCount()).toBe(1);
  });

  it('approves a pending suggestion and removes it from the pending count', () => {
    const queue = new SuggestQueue({ maxSize: 5, ttlMs: 60000 });
    const { suggestion } = queue.add({
      action: 'accept',
      command: 'Run Command git status',
      reason: 'heuristic-safe-command',
    });

    const approved = queue.approve(suggestion.id);
    expect(approved?.status).toBe('approved');
    expect(queue.getPendingCount()).toBe(0);
  });

  it('rejects a pending suggestion and preserves it in history', () => {
    const queue = new SuggestQueue({ maxSize: 5, ttlMs: 60000 });
    const { suggestion } = queue.add({
      action: 'reject',
      command: 'Run Command rm -rf /',
      reason: 'heuristic-risky-command',
    });

    const rejected = queue.reject(suggestion.id);
    expect(rejected?.status).toBe('rejected');
    expect(queue.getAll()[0].status).toBe('rejected');
  });

  it('expires pending suggestions when their ttl elapses', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const queue = new SuggestQueue({ maxSize: 5, ttlMs: 1000 });
    const { suggestion } = queue.add({
      action: 'accept',
      command: 'Run Command npm test',
      reason: 'heuristic-safe-command',
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:02.000Z'));

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.find(suggestion.id)?.status).toBe('expired');
  });
});

describe('AISupervisor review flow', () => {
  it('suggests rejection for risky commands even when remote supervision is disabled', async () => {
    const supervisor = new AISupervisor();
    supervisor.enabled = false;

    const result = await supervisor.reviewPendingAction({
      html: '<div>Run Command rm -rf /tmp/cache</div>',
    });

    expect(result.suggestedAction).toBe('reject');
    expect(result.reason).toBe('heuristic-risky-command');
  });

  it('suggests approval for safe commands when remote supervision is disabled', async () => {
    const supervisor = new AISupervisor();
    supervisor.enabled = false;

    const result = await supervisor.reviewPendingAction({
      html: '<div>Run Command npm test</div>',
    });

    expect(result.approved).toBe(true);
    expect(result.suggestedAction).toBe('accept');
  });

  it('uses the remote decision for safe commands when supervision is enabled', async () => {
    const supervisor = new AISupervisor();
    supervisor.enabled = true;
    const remoteDecision = vi
      .spyOn(supervisor, 'requestRemoteDecision')
      .mockResolvedValue({
        approved: false,
        source: 'omniroute',
        reason: 'omniroute-denied',
        commandText: 'Run Command npm test',
      });

    const result = await supervisor.reviewPendingAction({
      html: '<div>Run Command npm test</div>',
    });

    expect(remoteDecision).toHaveBeenCalledTimes(1);
    expect(result.suggestedAction).toBe('reject');
    expect(result.reason).toBe('omniroute-denied');
  });

  it('builds actionable local assist replies when the remote supervisor is disabled', async () => {
    const supervisor = new AISupervisor();
    supervisor.enabled = false;

    const result = await supervisor.chatWithUser('What should I do with pending suggestions?', {
      pendingSuggestions: 1,
      suggestions: [
        {
          action: 'accept',
          command: 'Run Command npm test',
        },
      ],
      stats: {
        uptime: '5m',
        metrics: {
          messagesSent: 3,
          actionsApproved: 1,
          errorsDetected: 0,
        },
      },
      quota: {
        available: true,
        criticalModels: 0,
        models: [
          {
            name: 'Gemini 3.1 Pro (High)',
            usagePercent: 20,
          },
        ],
      },
    });

    expect(result.source).toBe('local');
    expect(result.reply).toContain('Pending suggestions: 1.');
    expect(result.actions.map((action) => action.type)).toEqual(
      expect.arrayContaining([
        'show_suggestions',
        'approve_suggestion',
        'reject_suggestion',
      ])
    );
    expect(supervisor.getAssistHistory()).toHaveLength(2);
  });

  it('clears assist history on demand', async () => {
    const supervisor = new AISupervisor();
    supervisor.enabled = false;

    await supervisor.chatWithUser('Give me a summary', {
      pendingSuggestions: 0,
      stats: { uptime: '1m', metrics: {} },
      quota: { available: false, models: [] },
    });

    expect(supervisor.getAssistHistory()).toHaveLength(2);
    supervisor.clearAssistHistory();
    expect(supervisor.getAssistHistory()).toHaveLength(0);
  });
});
