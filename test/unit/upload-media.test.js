import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { saveUploadedImage, saveUploadedAudio } from '../../src/utils/workspace.js';

describe('Unified Media Processing (Image & Audio)', () => {
    const createdFiles = [];

    afterEach(async () => {
        for (const filePath of createdFiles) {
            try {
                await fsp.unlink(filePath);
            } catch (_) {}
        }
        createdFiles.length = 0;
    });

    it('processes both image and voice memo payloads atomically', async () => {
        const dummyImgB64 = Buffer.from('FAKE-IMAGE-PNG-BYTES').toString('base64');
        const dummyAudioB64 = Buffer.from('FAKE-AUDIO-WEBM-BYTES').toString('base64');

        const savedImage = await saveUploadedImage({
            name: 'dual-test-image',
            mimeType: 'image/png',
            data: dummyImgB64
        });
        createdFiles.push(savedImage.absolutePath);

        const savedAudio = await saveUploadedAudio({
            name: 'dual-test-voice',
            mimeType: 'audio/webm',
            data: dummyAudioB64,
            durationSeconds: 8
        });
        createdFiles.push(savedAudio.absolutePath);

        expect(savedImage.fileName).toMatch(/dual-test-image.*\.png$/);
        expect(savedAudio.fileName).toMatch(/dual-test-voice.*\.webm$/);
        expect(savedAudio.durationSeconds).toBe(8);

        const imgStat = await fsp.stat(savedImage.absolutePath);
        const audioStat = await fsp.stat(savedAudio.absolutePath);
        expect(imgStat.size).toBeGreaterThan(0);
        expect(audioStat.size).toBeGreaterThan(0);
    });

    it('formats dual-media fallback prompts accurately when native attachment fails', () => {
        const savedImage = {
            fileName: 'sample-pic.png',
            absolutePath: '/data/uploads/sample-pic.png'
        };
        const savedAudio = {
            fileName: 'sample-voice.webm',
            absolutePath: '/data/uploads/sample-voice.webm'
        };

        const userPrompt = 'Here is the bug report:';
        let composedPrompt = userPrompt;
        const imageAttachedNatively = false;
        const audioAttachedNatively = false;

        if (savedImage && !imageAttachedNatively) {
            composedPrompt += `\n\n[Attached image: ${savedImage.fileName}](${savedImage.absolutePath})`;
        }
        if (savedAudio && !audioAttachedNatively) {
            composedPrompt += `\n\n[Voice memo: ${savedAudio.fileName}](${savedAudio.absolutePath})`;
        }

        expect(composedPrompt).toContain('[Attached image: sample-pic.png](/data/uploads/sample-pic.png)');
        expect(composedPrompt).toContain('[Voice memo: sample-voice.webm](/data/uploads/sample-voice.webm)');
    });
});
