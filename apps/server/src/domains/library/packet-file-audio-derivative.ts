import { createHash } from "node:crypto";
import { readPacketVerifiedSourceFile } from "./packet-verified-file.js";

/** A deliberately narrow, no-native-code audio preview adapter. This is NOT
 * a full fidelity audio distributor: it decodes checked PCM WAV, downmixes and
 * limits it to an eight-second, 12-kHz 8-bit mono excerpt. All metadata, extra
 * chunks, original filenames and trailing source bytes are discarded.
 * Unsupported/unsafe encodings never fall back to source delivery.
 */
const SOURCE_LIMIT = 1_048_576;
const MAX_PREVIEWS = 8;
const MAX_TOTAL = 1_048_576;
const OUTPUT_RATE = 12_000;
const MAX_SECONDS = 8;
const OUTPUT_LIMIT = 128_000;

export function renderPacketPcmWavPreview(input: Buffer): Buffer {
  if (input.length < 44 || input.length > SOURCE_LIMIT || input.toString("ascii", 0, 4) !== "RIFF" ||
      input.toString("ascii", 8, 12) !== "WAVE" || input.readUInt32LE(4) !== input.length - 8)
    throw new Error("PACKET_AUDIO_INVALID");
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; align: number } | null = null;
  let data: Buffer | null = null;
  let chunkCount = 0;
  while (offset < input.length) {
    if (++chunkCount > 64 || offset + 8 > input.length) throw new Error("PACKET_AUDIO_INVALID");
    const type = input.toString("ascii", offset, offset + 4);
    const length = input.readUInt32LE(offset + 4);
    offset += 8;
    if (length > input.length - offset || offset + length + (length & 1) > input.length)
      throw new Error("PACKET_AUDIO_INVALID");
    if (type === "fmt ") {
      if (fmt || length !== 16 || input.readUInt16LE(offset) !== 1) throw new Error("PACKET_AUDIO_UNSUPPORTED");
      const channels = input.readUInt16LE(offset + 2);
      const sampleRate = input.readUInt32LE(offset + 4);
      const byteRate = input.readUInt32LE(offset + 8);
      const align = input.readUInt16LE(offset + 12);
      const bits = input.readUInt16LE(offset + 14);
      if (![1, 2].includes(channels) || ![8, 16].includes(bits) || sampleRate < 8_000 || sampleRate > 48_000 ||
          align !== channels * (bits / 8) || byteRate !== sampleRate * align)
        throw new Error("PACKET_AUDIO_UNSUPPORTED");
      fmt = { channels, sampleRate, bits, align };
    } else if (type === "data") {
      if (data) throw new Error("PACKET_AUDIO_INVALID");
      data = input.subarray(offset, offset + length);
    }
    offset += length + (length & 1);
  }
  if (!fmt || !data || !data.length || data.length % fmt.align) throw new Error("PACKET_AUDIO_INVALID");
  const format = fmt;
  const samples = data;
  const frames = samples.length / format.align;
  if (frames < 1) throw new Error("PACKET_AUDIO_INVALID");
  const outputFrames = Math.min(OUTPUT_RATE * MAX_SECONDS, Math.floor(frames * OUTPUT_RATE / format.sampleRate));
  if (outputFrames < 1 || outputFrames + 44 > OUTPUT_LIMIT) throw new Error("PACKET_AUDIO_INVALID");
  const output = Buffer.alloc(44 + outputFrames);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(output.length - 8, 4);
  output.write("WAVEfmt ", 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20); // PCM, not float or compressed audio
  output.writeUInt16LE(1, 22); // always mono
  output.writeUInt32LE(OUTPUT_RATE, 24);
  output.writeUInt32LE(OUTPUT_RATE, 28);
  output.writeUInt16LE(1, 32);
  output.writeUInt16LE(8, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(outputFrames, 40);
  const mono = (index: number) => {
    let amplitude = 0;
    const base = index * format.align;
    for (let channel = 0; channel < format.channels; channel++) {
      amplitude += format.bits === 8 ? (samples[base + channel] - 128) / 128 :
        samples.readInt16LE(base + 2 * channel) / 32768;
    }
    return amplitude / format.channels;
  };
  for (let index = 0; index < outputFrames; index++) {
    const position = index * format.sampleRate / OUTPUT_RATE;
    const first = Math.min(frames - 1, Math.floor(position));
    const next = Math.min(frames - 1, first + 1);
    const value = mono(first) * (1 - (position - Math.floor(position))) + mono(next) * (position - Math.floor(position));
    output[44 + index] = Math.max(0, Math.min(255, Math.round(128 + 127 * value)));
  }
  return output;
}

export async function buildPacketFileAudioDerivatives(manifestJson: string, sources: any[], libraryFilesRoot: string,
  prior: { position: number; sizeBytes: number }[] = []) {
  let manifest: any;
  try { manifest = JSON.parse(manifestJson); } catch { throw new Error("PACKET_RELEASE_INVALID"); }
  if (manifest?.schema !== 1 || !Array.isArray(manifest.sourceItems)) throw new Error("PACKET_RELEASE_INVALID");
  const byId = new Map(sources.map(item => [String(item.id), item]));
  const used = new Set(prior.map(item => item.position));
  let total = prior.reduce((sum, item) => sum + item.sizeBytes, 0);
  const candidates: { item: any; entry: any; position: number }[] = [];
  for (const [index, entry] of manifest.sourceItems.entries()) {
    const position = index + 1;
    const item: any = byId.get(String(entry.sourceId));
    if (!item?.fileName || used.has(position) || item.type === "folder") continue;
    if (!["public", "internal"].includes(String(item.classification || "internal")) ||
        !(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(String(item.mimeType || "").toLowerCase())) ||
        String(item.extension || "").toLowerCase() !== "wav") continue;
    if (!/^[a-f0-9]{64}$/.test(String(entry.checksumSha256 || "")) ||
        entry.checksumSha256 !== item.checksumSha256 || entry.revision !== item.revision)
      throw new Error("PACKET_FILE_SOURCE_CHANGED");
    if (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 44 || item.sizeBytes > SOURCE_LIMIT) continue;
    candidates.push({ item, entry, position });
  }
  if (candidates.length > MAX_PREVIEWS) throw new Error("PACKET_AUDIO_LIMIT");
  const derivatives: { position: number; format: "wav"; content: Buffer; sha256: string; sizeBytes: number }[] = [];
  for (const { item, entry, position } of candidates) {
    const source = await readPacketVerifiedSourceFile(libraryFilesRoot, entry, item, SOURCE_LIMIT);
    const content = renderPacketPcmWavPreview(source);
    total += content.length;
    if (total > MAX_TOTAL) throw new Error("PACKET_DERIVATIVES_TOO_LARGE");
    derivatives.push({ position, format: "wav", content, sizeBytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex") });
  }
  return derivatives;
}
