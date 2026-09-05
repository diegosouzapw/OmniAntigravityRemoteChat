import { describe, it, expect } from 'vitest';
import {
  evaluateCommandHeuristics,
  extractPendingCommand,
  detectPendingPromptFromHtml
} from '../../src/supervisor.js';

describe('Action & Decision System - Heuristics & Prompts', () => {
  describe('Command Risk Level Classification', () => {
    it('classifies destructive commands as critical risk', () => {
      const criticalCommands = [
        'rm -rf /tmp/data',
        'sudo systemctl restart nginx',
        'kill -9 4281',
        'git push --force origin main',
        'git clean -fdx',
        'drop table users'
      ];

      for (const cmd of criticalCommands) {
        const result = evaluateCommandHeuristics(cmd);
        expect(result.riskLevel).toBe('critical');
        expect(result.safe).toBe(false);
      }
    });

    it('classifies read-only and verification commands as safe risk', () => {
      const safeCommands = [
        'npm test',
        'git status',
        'git diff HEAD~1',
        'git log -n 5',
        'ls -la',
        'cat package.json',
        'pytest tests/',
        'grep -rn "TODO" src/'
      ];

      for (const cmd of safeCommands) {
        const result = evaluateCommandHeuristics(cmd);
        expect(result.riskLevel).toBe('safe');
        expect(result.safe).toBe(true);
      }
    });

    it('classifies unknown or ambiguous commands as warning risk', () => {
      const warningCommands = [
        'python custom_script.py',
        'node server.js',
        'touch newfile.txt',
        'mvn clean install'
      ];

      for (const cmd of warningCommands) {
        const result = evaluateCommandHeuristics(cmd);
        expect(result.riskLevel).toBe('warning');
        expect(result.safe).toBe(false);
      }
    });
  });

  describe('Prompt Detection from HTML Snapshots', () => {
    it('detects a pending command prompt with risk classification', () => {
      const html = `
        <div class="chat-row">
          <div>CommandLine: <code>rm -rf build/</code></div>
          <button>Reject</button>
          <button>Run command</button>
        </div>
      `;
      const prompt = detectPendingPromptFromHtml(html);
      expect(prompt).not.toBeNull();
      expect(prompt?.type).toBe('command');
      expect(prompt?.riskLevel).toBe('critical');
      expect(prompt?.acceptText).toBe('Run command');
      expect(prompt?.rejectText).toBe('Reject');
    });

    it('detects a safe command prompt', () => {
      const html = `
        <div class="chat-row">
          <div>CommandLine: <code>npm test</code></div>
          <button>Reject</button>
          <button>Run command</button>
        </div>
      `;
      const prompt = detectPendingPromptFromHtml(html);
      expect(prompt).not.toBeNull();
      expect(prompt?.type).toBe('command');
      expect(prompt?.riskLevel).toBe('safe');
    });

    it('detects implementation plan proceed prompt with preview and review capability', () => {
      const html = `
        <div class="plan-card">
          <h3>Implementation Plan Ready</h3>
          <button>Proceed with Plan</button>
        </div>
      `;
      const prompt = detectPendingPromptFromHtml(html);
      expect(prompt).not.toBeNull();
      expect(prompt?.type).toBe('plan');
      expect(prompt?.proceedText).toBe('Proceed with Plan');
      expect(prompt?.reviewText).toBe('Review');
      expect(prompt?.hasPreview).toBe(true);
    });

    it('returns null when no actionable prompt is present', () => {
      const html = `
        <div class="chat-message">
          <p>Here is the analysis of the code. Everything looks good.</p>
        </div>
      `;
      const prompt = detectPendingPromptFromHtml(html);
      expect(prompt).toBeNull();
    });

    it('generates deterministic IDs for identical prompts across multiple evaluations', () => {
      const planHtml = '<div class="plan-card"><button>Proceed with Plan</button></div>';
      const prompt1 = detectPendingPromptFromHtml(planHtml);
      const prompt2 = detectPendingPromptFromHtml(planHtml);
      expect(prompt1?.id).toBe('plan-approval');
      expect(prompt1?.id).toBe(prompt2?.id);

      const cmdHtml = '<div>CommandLine: <code>npm test</code><button>Run command</button><button>Reject</button></div>';
      const cmd1 = detectPendingPromptFromHtml(cmdHtml);
      const cmd2 = detectPendingPromptFromHtml(cmdHtml);
      expect(cmd1?.id).toMatch(/^cmd-/);
      expect(cmd1?.id).toBe(cmd2?.id);
    });

    it('does not trigger false positive from conversational chat text or markdown lists', () => {
      const conversationalHtml = `
        <div class="chat-message">
          <p>You can run command or reject it if you prefer.</p>
          <ul>
            <li>Terminal commands: Run command / Reject with code snippet</li>
          </ul>
        </div>
      `;
      const prompt = detectPendingPromptFromHtml(conversationalHtml);
      expect(prompt).toBeNull();
    });
  });

  describe('Implementation Plan File Resolution', () => {
    it('discovers and loads the active implementation plan', async () => {
      const { findLatestImplementationPlan } = await import('../../src/utils/workspace.js');
      const plan = await findLatestImplementationPlan();
      // Should find the implementation plan created for the current conversation
      expect(plan).not.toBeNull();
      expect(typeof plan?.content).toBe('string');
      expect(plan?.content.length).toBeGreaterThan(0);
      expect(plan?.path).toContain('implementation_plan.md');
      expect(typeof plan?.updatedAt).toBe('number');
    });
  });

  describe('Acted-On Plan Action Suppression', () => {
    it('permanently suppresses re-prompting for acted-on plan IDs', async () => {
      const { actedActionIds } = await import('../../src/server.js');
      expect(actedActionIds).toBeDefined();

      const testPlanId = 'plan-test-12345';
      expect(actedActionIds.has(testPlanId)).toBe(false);

      // Mark as acted upon
      actedActionIds.add(testPlanId);
      expect(actedActionIds.has(testPlanId)).toBe(true);

      // Clean up test ID
      actedActionIds.delete(testPlanId);
    });
  });
});
