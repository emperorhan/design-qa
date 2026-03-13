import fs from "node:fs";

import { loadPngTools } from "./node";
import type { ScreenshotAnalysis } from "./ir";

export async function analyzeScreenshot(screenshotPath: string): Promise<ScreenshotAnalysis> {
  const tools = await loadPngTools();
  const png = tools.PNG.sync.read(fs.readFileSync(screenshotPath));
  const { width, height, data } = png;

  const dominantColors = extractDominantColors(data, width, height);
  const spacingCandidates = extractSpacingCandidates(data, width, height);
  const radiusCandidates = extractRadiusCandidates(data, width, height);
  const textBandCount = estimateTextBandCount(data, width, height);
  const blockCount = estimateBlockCount(data, width, height);

  return {
    path: screenshotPath,
    width,
    height,
    aspectRatio: round(width / Math.max(height, 1), 4),
    dominantColors,
    spacingCandidates,
    radiusCandidates,
    shadowCandidates: estimateShadowCandidates(data, width, height),
    textBandCount,
    blockCount,
  };
}

function extractDominantColors(data: Uint8Array, width: number, height: number) {
  const buckets = new Map<string, number>();
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 5000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const r = quantize(data[offset]);
      const g = quantize(data[offset + 1]);
      const b = quantize(data[offset + 2]);
      const a = data[offset + 3];
      if (a < 32) continue;
      const key = toHex(r, g, b);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([color]) => color);
}

function extractSpacingCandidates(data: Uint8Array, width: number, height: number) {
  const gaps = new Map<number, number>();
  const rowStep = Math.max(1, Math.floor(height / 40));
  const threshold = 245;

  for (let y = 0; y < height; y += rowStep) {
    let currentGap = 0;
    for (let x = 0; x < width; x += 2) {
      const brightness = getBrightness(data, width, x, y);
      if (brightness >= threshold) {
        currentGap += 2;
      } else if (currentGap > 0) {
        const normalized = normalizeGap(currentGap);
        gaps.set(normalized, (gaps.get(normalized) ?? 0) + 1);
        currentGap = 0;
      }
    }
  }

  return [...gaps.entries()]
    .filter(([gap]) => gap >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([gap]) => gap)
    .sort((a, b) => a - b);
}

function extractRadiusCandidates(data: Uint8Array, width: number, height: number) {
  const samples = [
    sampleCornerContrast(data, width, height, Math.round(width * 0.1), Math.round(height * 0.1)),
    sampleCornerContrast(data, width, height, Math.round(width * 0.5), Math.round(height * 0.2)),
    sampleCornerContrast(data, width, height, Math.round(width * 0.8), Math.round(height * 0.5)),
  ];
  const values = samples
    .map((contrast) => {
      if (contrast > 50) return 16;
      if (contrast > 30) return 12;
      if (contrast > 15) return 8;
      return 4;
    })
    .filter((value, index, items) => items.indexOf(value) === index);
  return values.sort((a, b) => a - b);
}

function estimateShadowCandidates(data: Uint8Array, width: number, height: number) {
  const lowerBand = Math.floor(height * 0.75);
  let dark = 0;
  let total = 0;
  for (let y = lowerBand; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      total += 1;
      if (getBrightness(data, width, x, y) < 200) {
        dark += 1;
      }
    }
  }
  const ratio = dark / Math.max(total, 1);
  if (ratio > 0.18) {
    return ["0 12px 24px rgba(0,0,0,0.18)", "0 2px 8px rgba(0,0,0,0.12)"];
  }
  return ["0 1px 2px rgba(0,0,0,0.08)"];
}

function estimateTextBandCount(data: Uint8Array, width: number, height: number) {
  let bands = 0;
  let active = false;
  for (let y = 0; y < height; y += 3) {
    let darkPixels = 0;
    for (let x = 0; x < width; x += 3) {
      if (getBrightness(data, width, x, y) < 170) {
        darkPixels += 1;
      }
    }
    const dense = darkPixels > Math.max(8, width / 40);
    if (dense && !active) {
      bands += 1;
      active = true;
    } else if (!dense) {
      active = false;
    }
  }
  return bands;
}

function estimateBlockCount(data: Uint8Array, width: number, height: number) {
  let blocks = 0;
  let active = false;
  for (let y = 0; y < height; y += 6) {
    let variance = 0;
    let prev = getBrightness(data, width, 0, y);
    for (let x = 6; x < width; x += 6) {
      const next = getBrightness(data, width, x, y);
      variance += Math.abs(next - prev);
      prev = next;
    }
    const dense = variance > width * 0.8;
    if (dense && !active) {
      blocks += 1;
      active = true;
    } else if (!dense) {
      active = false;
    }
  }
  return Math.max(1, blocks);
}

function sampleCornerContrast(data: Uint8Array, width: number, height: number, cx: number, cy: number) {
  const center = getBrightness(data, width, clamp(cx, 0, width - 1), clamp(cy, 0, height - 1));
  const diagonal = getBrightness(data, width, clamp(cx + 12, 0, width - 1), clamp(cy + 12, 0, height - 1));
  return Math.abs(center - diagonal);
}

function getBrightness(data: Uint8Array, width: number, x: number, y: number) {
  const offset = (y * width + x) * 4;
  return Math.round((data[offset] * 299 + data[offset + 1] * 587 + data[offset + 2] * 114) / 1000);
}

function quantize(value: number) {
  return Math.min(255, Math.round(value / 32) * 32);
}

function normalizeGap(value: number) {
  const candidates = [4, 8, 12, 16, 24, 32, 40, 48];
  return candidates.reduce((best, current) => (Math.abs(current - value) < Math.abs(best - value) ? current : best), candidates[0]);
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
