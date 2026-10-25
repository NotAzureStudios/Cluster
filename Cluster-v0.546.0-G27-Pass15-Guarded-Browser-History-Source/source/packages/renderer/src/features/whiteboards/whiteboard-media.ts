import type { WhiteboardImageElement, WhiteboardPoint } from "../application/application-models";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1800;

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = source;
  });
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

export async function createWhiteboardImageElement(file: File, position: WhiteboardPoint, categoryId?: string | null): Promise<WhiteboardImageElement> {
  if (!file.type.startsWith("image/")) throw new Error("Whiteboards only accept image files here.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Whiteboard images are limited to 12 MB before optimization.");
  const originalSource = await readFile(file);
  const image = await loadImage(originalSource);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const pixelWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const pixelHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image processing is unavailable in this browser.");
  context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
  const optimizedSource = canvas.toDataURL("image/webp", 0.86);
  const displayScale = Math.min(1, 620 / Math.max(pixelWidth, pixelHeight));
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: "image",
    x: position.x,
    y: position.y,
    width: Math.max(120, Math.round(pixelWidth * displayScale)),
    height: Math.max(90, Math.round(pixelHeight * displayScale)),
    src: optimizedSource,
    alt: file.name.replace(/\.[^.]+$/, "") || "Whiteboard image",
    originalName: file.name,
    opacity: 1,
    categoryId: categoryId || null,
  };
}
