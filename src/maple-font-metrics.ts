import { Buffer } from "node:buffer";

import { create, type Font } from "fontkit";

export const MAPLE_TEXT_WIDTH_SAFETY_FACTOR = 1.35;

let font: Font | null = null;
let loading: Promise<void> | null = null;

export const loadMapleFontMetrics = async (url: string): Promise<void> => {
  if (font) {
    return;
  }
  loading ??= fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load Maple Mono font: ${response.status}`);
      }
      font = create(Buffer.from(await response.arrayBuffer())) as Font;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  await loading;
};

export const setMapleFontMetricsBuffer = (buffer: Uint8Array): void => {
  font = create(Buffer.from(buffer)) as Font;
  loading = Promise.resolve();
};

export const measureMapleTextWidth = (
  text: string,
  fontSize: number,
): number => {
  if (!font) {
    throw new Error("Maple Mono font metrics are not loaded");
  }
  return (
    (font.layout(text).advanceWidth *
      fontSize *
      MAPLE_TEXT_WIDTH_SAFETY_FACTOR) /
    font.unitsPerEm
  );
};

export const hasMapleFontMetrics = (): boolean => font !== null;
