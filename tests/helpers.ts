// Test helper: build a small synthetic JPEG in-memory with jpeg-js.
import jpeg from "jpeg-js";

export function jpegDecodeForTest(fill: number = 128): Buffer {
  const width = 32;
  const height = 32;
  const frameData = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Gradient + fill baseline so hashes have signal.
      frameData[i] = (fill + x * 4) & 0xff;       // R
      frameData[i + 1] = (fill + y * 4) & 0xff;   // G
      frameData[i + 2] = (fill + x + y) & 0xff;   // B
      frameData[i + 3] = 0xff;                     // A
    }
  }
  const { data } = jpeg.encode({ width, height, data: frameData }, 90);
  return Buffer.from(data);
}
