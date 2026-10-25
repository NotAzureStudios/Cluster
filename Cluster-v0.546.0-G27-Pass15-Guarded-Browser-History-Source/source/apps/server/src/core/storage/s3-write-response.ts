/** S3 CopyObject and CompleteMultipartUpload may return HTTP 200 containing an
 * XML error. Success status alone must never advance a managed storage pointer.
 * This parser deliberately fails closed on unfamiliar or oversized responses. */
export async function requireS3WriteSuccess(
  body: AsyncIterable<Buffer | string>,
  operation: "CopyObject" | "CompleteMultipartUpload",
): Promise<void> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += data.length;
    if (total > 64 * 1024) throw new Error(`S3 ${operation} response exceeded safety limit.`);
    chunks.push(data);
  }
  const xml = Buffer.concat(chunks).toString("utf8");
  const success = operation === "CopyObject" ? "CopyObjectResult" : "CompleteMultipartUploadResult";
  if (/<(?:[\w-]+:)?Error(?:\s|>)/i.test(xml)) throw new Error(`S3 ${operation} returned an embedded error despite HTTP success.`);
  if (!new RegExp(`<(?:(?:[\\w-]+):)?${success}(?:\\s|>)`, "i").test(xml)
      || !/<(?:[\w-]+:)?ETag(?:\s|>)/i.test(xml)) {
    throw new Error(`S3 ${operation} did not return verified success XML.`);
  }
}
