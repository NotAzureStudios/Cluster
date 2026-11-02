/** Bounded-memory authenticated download writer. Caller owns file picker and request. */
export type ClusterDownloadSink = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
};

export async function streamDownloadToSink(response: Response, sink: ClusterDownloadSink, options: {
  signal?: AbortSignal;
  ensureCurrent?: () => void;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
} = {}): Promise<{ bytesWritten: number; totalBytes: number | null }> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let completed = false;
  try {
    if (response.status !== 200) throw new Error(`Download returned HTTP ${response.status}, not a complete file.`);
    if (response.headers.get("content-range")) throw new Error("The server returned a partial download instead of the complete file.");
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (type.includes("text/html") || type.includes("application/problem+json")) {
      throw new Error("The download returned a page or API response instead of a file.");
    }
    const length = response.headers.get("content-length");
    const totalBytes = length === null ? null : Number(length);
    if (totalBytes !== null && (!Number.isSafeInteger(totalBytes) || totalBytes < 0)) {
      throw new Error("The server returned an invalid download length.");
    }
    if (!response.body) throw new Error("The download has no readable file stream.");
    reader = response.body.getReader();
    let bytesWritten = 0;
    while (true) {
      if (options.signal?.aborted) throw new DOMException("Download cancelled.", "AbortError");
      options.ensureCurrent?.();
      const { done, value } = await reader.read();
      if (done) break;
      if (options.signal?.aborted) throw new DOMException("Download cancelled.", "AbortError");
      options.ensureCurrent?.();
      if (!value?.byteLength) continue;
      bytesWritten += value.byteLength;
      if (!Number.isSafeInteger(bytesWritten) || (totalBytes !== null && bytesWritten > totalBytes)) {
        throw new Error("The server sent more data than the declared file size.");
      }
      await sink.write(value);
      options.onProgress?.(bytesWritten, totalBytes);
    }
    if (totalBytes !== null && bytesWritten !== totalBytes) throw new Error("Download ended before its declared file size.");
    if (options.signal?.aborted) throw new DOMException("Download cancelled.", "AbortError");
    options.ensureCurrent?.();
    await sink.close();
    completed = true;
    return { bytesWritten, totalBytes };
  } catch (error) {
    if (reader) await reader.cancel().catch(() => undefined);
    await sink.abort(error).catch(() => undefined);
    throw error;
  } finally {
    reader?.releaseLock();
    // A rejected write must never leave a partial user-selected file committed.
    void completed;
  }
}
