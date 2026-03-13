import zlib from "node:zlib";

interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePng(buffer: Buffer): DecodedPng {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Unsupported PNG signature");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    offset += 4;
    const chunkData = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8];
      colorType = chunkData[9];
    } else if (type === "IDAT") {
      idatChunks.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth: ${bitDepth}`);
  }
  if (![0, 2, 4, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG color type: ${colorType}`);
  }

  const channels =
    colorType === 0 ? 1 :
    colorType === 2 ? 3 :
    colorType === 4 ? 2 :
    4;
  const bytesPerPixel = channels;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  const rgba = new Uint8Array(width * height * 4);
  let rawOffset = 0;
  let prevRow = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filterType = raw[rawOffset++];
    const row = raw.subarray(rawOffset, rawOffset + stride);
    rawOffset += stride;
    const reconstructed = new Uint8Array(stride);

    for (let i = 0; i < stride; i++) {
      const left = i >= bytesPerPixel ? reconstructed[i - bytesPerPixel] : 0;
      const up = prevRow[i] ?? 0;
      const upLeft = i >= bytesPerPixel ? (prevRow[i - bytesPerPixel] ?? 0) : 0;
      const value = row[i];
      if (filterType === 0) reconstructed[i] = value;
      else if (filterType === 1) reconstructed[i] = (value + left) & 0xff;
      else if (filterType === 2) reconstructed[i] = (value + up) & 0xff;
      else if (filterType === 3) reconstructed[i] = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filterType === 4) reconstructed[i] = (value + paeth(left, up, upLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }

    for (let x = 0; x < width; x++) {
      const srcOffset = x * bytesPerPixel;
      const dstOffset = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[dstOffset] = reconstructed[srcOffset];
        rgba[dstOffset + 1] = reconstructed[srcOffset + 1];
        rgba[dstOffset + 2] = reconstructed[srcOffset + 2];
        rgba[dstOffset + 3] = reconstructed[srcOffset + 3];
      } else if (colorType === 2) {
        rgba[dstOffset] = reconstructed[srcOffset];
        rgba[dstOffset + 1] = reconstructed[srcOffset + 1];
        rgba[dstOffset + 2] = reconstructed[srcOffset + 2];
        rgba[dstOffset + 3] = 255;
      } else if (colorType === 0) {
        const gray = reconstructed[srcOffset];
        rgba[dstOffset] = gray;
        rgba[dstOffset + 1] = gray;
        rgba[dstOffset + 2] = gray;
        rgba[dstOffset + 3] = 255;
      } else {
        const gray = reconstructed[srcOffset];
        rgba[dstOffset] = gray;
        rgba[dstOffset + 1] = gray;
        rgba[dstOffset + 2] = gray;
        rgba[dstOffset + 3] = reconstructed[srcOffset + 1];
      }
    }

    prevRow = reconstructed;
  }

  return { width, height, data: rgba };
}

export function countPixelDiff(
  img1: Uint8Array,
  img2: Uint8Array,
  width: number,
  height: number,
  options?: { threshold?: number },
) {
  const threshold = options?.threshold ?? 0.1;
  let diffPixels = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    const r = Math.abs(img1[i] - img2[i]) / 255;
    const g = Math.abs(img1[i + 1] - img2[i + 1]) / 255;
    const b = Math.abs(img1[i + 2] - img2[i + 2]) / 255;
    const a = Math.abs(img1[i + 3] - img2[i + 3]) / 255;
    if (Math.max(r, g, b, a) > threshold) {
      diffPixels += 1;
    }
  }
  return diffPixels;
}

export function resizeNearestNeighbor(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight));
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth));
      const srcOffset = (sourceY * sourceWidth + sourceX) * 4;
      const dstOffset = (y * targetWidth + x) * 4;
      output[dstOffset] = source[srcOffset];
      output[dstOffset + 1] = source[srcOffset + 1];
      output[dstOffset + 2] = source[srcOffset + 2];
      output[dstOffset + 3] = source[srcOffset + 3];
    }
  }
  return output;
}

function paeth(left: number, up: number, upLeft: number) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}
