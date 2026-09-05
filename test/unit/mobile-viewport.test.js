import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

describe('Mobile viewport & keyboard handling', () => {
  it('public/index.html includes interactive-widget=resizes-content in viewport meta', () => {
    const html = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
    expect(html).toContain('interactive-widget=resizes-content');
  });

  it('public/css/layout.css configures .shell with visual viewport height and overflow hidden', () => {
    const css = fs.readFileSync(path.join(projectRoot, 'public/css/layout.css'), 'utf8');
    expect(css).toContain('height: var(--visual-viewport-height, 100dvh);');
    expect(css).toContain('max-height: var(--visual-viewport-height, 100dvh);');
    expect(css).toContain('min-height: 0;');
  });

  it('public/css/chat.css configures .input-section with flex-shrink: 0', () => {
    const css = fs.readFileSync(path.join(projectRoot, 'public/css/chat.css'), 'utf8');
    expect(css).toMatch(/\.input-section[\s\S]*?flex-shrink:\s*0/);
  });

  it('public/css/components.css sets scroll-padding-bottom on textarea', () => {
    const css = fs.readFileSync(path.join(projectRoot, 'public/css/components.css'), 'utf8');
    expect(css).toContain('scroll-padding-bottom: 6px;');
  });

  it('public/js/app.js does not automatically focus messageInput on media staging', () => {
    const js = fs.readFileSync(path.join(projectRoot, 'public/js/app.js'), 'utf8');
    
    // Extract stageAudio function body
    const stageAudioMatch = js.match(/function stageAudio\([^)]*\)\s*\{([\s\S]*?)\}/);
    expect(stageAudioMatch).toBeTruthy();
    expect(stageAudioMatch[1]).not.toContain('messageInput');

    // Extract imageInput change listener
    const imageInputMatch = js.match(/imageInput\.addEventListener\('change'[\s\S]*?reader\.onload\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\};/);
    expect(imageInputMatch).toBeTruthy();
    expect(imageInputMatch[1]).not.toContain('messageInput?.focus()');
    expect(imageInputMatch[1]).not.toContain('messageInput.focus()');
  });

  it('public/js/app.js defines ensurePromptVisible and sets visual-viewport-height on resize', () => {
    const js = fs.readFileSync(path.join(projectRoot, 'public/js/app.js'), 'utf8');
    expect(js).toContain('function ensurePromptVisible');
    expect(js).toContain('--visual-viewport-height');
    expect(js).toContain("inputSec.scrollIntoView({ block: 'end'");
  });
});
