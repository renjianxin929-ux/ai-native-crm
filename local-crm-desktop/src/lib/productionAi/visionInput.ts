export const VISION_INPUT_LIMITS = {
  allowed_mime: ['image/jpeg', 'image/png', 'image/webp'] as const,
  max_bytes: 8 * 1024 * 1024,
  max_dimension: 8192,
  max_pixels: 25_000_000,
  max_images: 1,
} as const;

export type AllowedVisionMime = typeof VISION_INPUT_LIMITS.allowed_mime[number];

export type VisionFormatVariant = 'JPEG_BASELINE' | 'JPEG_PROGRESSIVE' | 'PNG' | 'WEBP_LOSSY' | 'WEBP_LOSSLESS' | 'WEBP_EXTENDED';

export const VISION_FORMAT_SUPPORT_MATRIX = [
  { format: 'JPEG_BASELINE', supported: true },
  { format: 'JPEG_PROGRESSIVE', supported: true },
  { format: 'PNG', supported: true },
  { format: 'WEBP_LOSSY', supported: true },
  { format: 'WEBP_LOSSLESS', supported: true },
  { format: 'WEBP_EXTENDED', supported: true, condition: 'non_animated' },
] as const;

export interface VisionFormatInspection {
  readonly variant: VisionFormatVariant;
  readonly animated: boolean;
  readonly exif_orientation_policy: 'PRESERVE_ORIGINAL_ENCODED_ORIENTATION';
}

export function detectImageMime(bytes: Uint8Array): AllowedVisionMime | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

export function inspectVisionFormat(bytes: Uint8Array): VisionFormatInspection {
  const mime = detectImageMime(bytes);
  if (mime === 'image/jpeg') {
    let variant: VisionFormatVariant | null = null;
    for (let index = 2; index + 1 < bytes.length; index += 1) {
      if (bytes[index] !== 0xff) continue;
      if (bytes[index + 1] === 0xc0) { variant = 'JPEG_BASELINE'; break; }
      if (bytes[index + 1] === 0xc2) { variant = 'JPEG_PROGRESSIVE'; break; }
    }
    if (!variant) throw new Error('JPEG 编码类型无法确认或文件已截断。');
    return { variant, animated: false, exif_orientation_policy: 'PRESERVE_ORIGINAL_ENCODED_ORIENTATION' };
  }
  if (mime === 'image/png') {
    const animated = containsAscii(bytes, 'acTL');
    if (animated) throw new Error('暂不支持动态 PNG。');
    return { variant: 'PNG', animated: false, exif_orientation_policy: 'PRESERVE_ORIGINAL_ENCODED_ORIENTATION' };
  }
  if (mime === 'image/webp') {
    if (bytes.length < 16) throw new Error('WebP 文件已截断。');
    const chunk = new TextDecoder().decode(bytes.slice(12, 16));
    const variant = chunk === 'VP8 ' ? 'WEBP_LOSSY' : chunk === 'VP8L' ? 'WEBP_LOSSLESS' : chunk === 'VP8X' ? 'WEBP_EXTENDED' : null;
    if (!variant) throw new Error('WebP 编码类型不受支持。');
    const animated = variant === 'WEBP_EXTENDED' && (bytes.length < 21 || (bytes[20]! & 0x02) !== 0);
    if (animated) throw new Error('暂不支持动态 WebP。');
    return { variant, animated: false, exif_orientation_policy: 'PRESERVE_ORIGINAL_ENCODED_ORIENTATION' };
  }
  throw new Error('图片损坏或格式不受支持。');
}

export function validateVisionImageMetadata(input: {
  readonly declaredMime: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}): AllowedVisionMime {
  if (!VISION_INPUT_LIMITS.allowed_mime.includes(input.declaredMime as AllowedVisionMime)) throw new Error('仅支持 JPEG、PNG、WebP 图片。');
  if (input.bytes.length === 0 || input.bytes.length > VISION_INPUT_LIMITS.max_bytes) throw new Error('图片大小必须在 1 字节到 8 MB 之间。');
  const detected = detectImageMime(input.bytes);
  if (detected !== input.declaredMime) throw new Error('图片 MIME 与实际文件内容不一致。');
  inspectVisionFormat(input.bytes);
  const extension = input.fileName.toLowerCase().split('.').pop() ?? '';
  const validExtension = detected === 'image/jpeg' ? ['jpg', 'jpeg'].includes(extension)
    : detected === 'image/png' ? extension === 'png' : extension === 'webp';
  if (!validExtension) throw new Error('图片扩展名与实际格式不一致。');
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1
    || input.width > VISION_INPUT_LIMITS.max_dimension || input.height > VISION_INPUT_LIMITS.max_dimension
    || input.width * input.height > VISION_INPUT_LIMITS.max_pixels) throw new Error('图片尺寸超过安全限制。');
  return detected;
}

function containsAscii(bytes: Uint8Array, marker: string): boolean {
  const encoded = new TextEncoder().encode(marker);
  outer: for (let index = 0; index <= bytes.length - encoded.length; index += 1) {
    for (let offset = 0; offset < encoded.length; offset += 1) if (bytes[index + offset] !== encoded[offset]) continue outer;
    return true;
  }
  return false;
}

export async function readAndValidateVisionFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('图片损坏或无法解码。');
  try {
    validateVisionImageMetadata({ declaredMime: file.type, fileName: file.name, bytes, width: bitmap.width, height: bitmap.height });
  } finally {
    bitmap.close();
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });
}
