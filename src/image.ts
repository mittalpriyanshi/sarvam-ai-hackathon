export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // what the user may pick
const MAX_SEND_BYTES = 3.8 * 1024 * 1024; // what we send (Vercel body limit is 4.5 MB)

/**
 * Sarvam Vision accepts JPG/PNG. WEBP or oversized images are re-encoded to JPEG in the
 * browser so the upload stays under the serverless request limit.
 */
export async function prepareImage(file: File): Promise<File> {
  if (file.type !== 'image/webp' && file.size <= MAX_SEND_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  let maxDim = 2400;
  let quality = 0.9;
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_SEND_BYTES) {
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
    maxDim = Math.round(maxDim * 0.75);
    quality -= 0.1;
  }
  throw new Error('Could not shrink this image enough. Try a smaller screenshot.');
}

export function formatBytes(n: number) {
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
