/** Enforces the byte limit while streaming, not after buffering an arbitrarily
 * large response. Used for 3D source payloads with missing/untrusted lengths. */
export async function readBoundedViewerBlob(response: Response, limit: number): Promise<Blob> {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid viewer source budget.');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error(`Viewer response exceeds the ${limit} byte source budget.`);
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > limit) throw new Error(`Viewer response exceeds the ${limit} byte source budget.`);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel('Viewer source exceeds the configured byte budget.');
        throw new Error(`Viewer response exceeds the ${limit} byte source budget.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return new Blob([result.buffer]);
}
