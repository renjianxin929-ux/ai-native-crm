import { describe, expect, it } from 'vitest';
import { inspectVisionFormat, VISION_FORMAT_SUPPORT_MATRIX } from '../lib/productionAi/visionInput';

const ascii = (text: string) => [...new TextEncoder().encode(text)];
const jpeg = (marker: number) => new Uint8Array([0xff, 0xd8, 0xff, marker, 0x00, 0x11, 0xff, 0xd9]);
const webp = (chunk: 'VP8 ' | 'VP8L' | 'VP8X', flags = 0) => new Uint8Array([
  ...ascii('RIFF'), 24, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, flags,
]);

describe('vision-format-matrix', () => {
  it('behaviorally classifies every formally supported still-image variant', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspectVisionFormat(jpeg(0xc0)).variant).toBe('JPEG_BASELINE');
    expect(inspectVisionFormat(jpeg(0xc2)).variant).toBe('JPEG_PROGRESSIVE');
    expect(inspectVisionFormat(png).variant).toBe('PNG');
    expect(inspectVisionFormat(webp('VP8 ')).variant).toBe('WEBP_LOSSY');
    expect(inspectVisionFormat(webp('VP8L')).variant).toBe('WEBP_LOSSLESS');
    expect(inspectVisionFormat(webp('VP8X')).variant).toBe('WEBP_EXTENDED');
    expect(VISION_FORMAT_SUPPORT_MATRIX).toHaveLength(6);
  });

  it('rejects animation, truncation and unknown container chunks without false success', () => {
    expect(() => inspectVisionFormat(webp('VP8X', 0x02))).toThrow(/动态 WebP/);
    expect(() => inspectVisionFormat(new Uint8Array(ascii('RIFF0000WEBP')))).toThrow(/截断/);
    expect(() => inspectVisionFormat(jpeg(0xdb))).toThrow(/截断/);
  });

  it('formally preserves original encoded EXIF orientation for predictable host pass-through', () => {
    expect(inspectVisionFormat(jpeg(0xc0)).exif_orientation_policy).toBe('PRESERVE_ORIGINAL_ENCODED_ORIENTATION');
  });
});
