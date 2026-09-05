import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fsp } from 'fs';
import { saveUploadedAudio } from '../../src/utils/workspace.js';

describe('saveUploadedAudio', () => {
    const createdFiles = [];

    afterEach(async () => {
        for (const filePath of createdFiles) {
            try {
                await fsp.unlink(filePath);
            } catch (_) {}
        }
        createdFiles.length = 0;
    });

    it('persists a valid webm voice memo and calculates duration', async () => {
        const dummyAudio = Buffer.from('FAKE-AUDIO-DATA-WEBM-OPUS').toString('base64');
        const result = await saveUploadedAudio({
            name: 'test-recording',
            mimeType: 'audio/webm;codecs=opus',
            data: dummyAudio,
            durationSeconds: 12
        });

        createdFiles.push(result.absolutePath);

        assert.ok(result.fileName.includes('test-recording'));
        assert.ok(result.fileName.endsWith('.webm'));
        assert.equal(result.mimeType, 'audio/webm;codecs=opus');
        assert.equal(result.durationSeconds, 12);
        assert.ok(result.publicPath.includes('/uploads/'));
        assert.ok(result.dataUrl.includes('data:audio/webm;codecs=opus;base64,'));

        const stat = await fsp.stat(result.absolutePath);
        assert.ok(stat.size > 0);
    });

    it('persists an mp4/m4a audio recording with correct extension', async () => {
        const dummyAudio = Buffer.from('FAKE-AUDIO-DATA-MP4').toString('base64');
        const result = await saveUploadedAudio({
            name: 'mobile-m4a',
            mimeType: 'audio/mp4',
            data: dummyAudio,
            durationSeconds: 5
        });

        createdFiles.push(result.absolutePath);

        assert.ok(result.fileName.endsWith('.m4a'));
        assert.equal(result.durationSeconds, 5);
    });

    it('persists an ogg audio recording with .ogg extension', async () => {
        const dummyAudio = Buffer.from('FAKE-AUDIO-DATA-OGG').toString('base64');
        const result = await saveUploadedAudio({
            name: 'mobile-ogg',
            mimeType: 'audio/ogg',
            data: dummyAudio,
            durationSeconds: 3
        });

        createdFiles.push(result.absolutePath);

        assert.ok(result.fileName.endsWith('.ogg'));
    });

    it('rejects unsupported MIME types', async () => {
        const dummyData = Buffer.from('HELLO').toString('base64');
        await assert.rejects(
            saveUploadedAudio({
                name: 'bad-file',
                mimeType: 'application/x-msdownload',
                data: dummyData
            }),
            /Unsupported audio MIME type/
        );
    });

    it('rejects empty audio payload', async () => {
        await assert.rejects(
            saveUploadedAudio({
                name: 'empty',
                mimeType: 'audio/webm',
                data: ''
            }),
            /Audio payload is empty/
        );
    });

    it('rejects audio payload exceeding 15MB limit', async () => {
        const largeData = Buffer.alloc(16 * 1024 * 1024).toString('base64');
        await assert.rejects(
            saveUploadedAudio({
                name: 'huge',
                mimeType: 'audio/webm',
                data: largeData
            }),
            /exceeds 15 MB limit/
        );
    });
});
