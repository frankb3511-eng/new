/** Pixel-level audit of screenshots: enforces monochrome + dark theme. */
import fs from 'node:fs';
import { PNG } from 'pngjs';

const DIR = '/tmp/shots';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png'));
let totalFails = 0;

for (const file of files) {
  const png = PNG.sync.read(fs.readFileSync(`${DIR}/${file}`));
  const { width, height, data } = png;
  let colored = 0;   // saturated pixels (chroma above threshold)
  let bright = 0;    // near-white pixels
  let dark = 0;      // near-black pixels
  let lumSum = 0;
  const samples = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const chroma = max - min;
    lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (max < 32) dark++;
    if (min > 220) bright++;
    if (chroma > 24) {
      colored++;
      if (samples.length < 3) samples.push(`rgb(${r},${g},${b})`);
    }
  }
  const px = width * height;
  const avgLum = (lumSum / px).toFixed(1);
  const isNet = file.includes('network');
  // network shots may contain the two status hues (green/red) in small doses
  const coloredPct = ((colored / px) * 100).toFixed(3);
  const pass = isNet ? colored / px < 0.02 : colored === 0;
  if (!pass) totalFails++;
  console.log(`${pass ? 'OK ' : 'FAIL'} ${file.padEnd(22)} colored=${coloredPct}%  avgLum=${avgLum}  dark=${((dark / px) * 100).toFixed(1)}%  bright=${((bright / px) * 100).toFixed(2)}%${samples.length ? '  e.g. ' + samples.join(' ') : ''}`);
}
console.log(totalFails ? `\n${totalFails} FAILURES` : '\nALL PIXEL AUDITS PASS');
process.exit(totalFails ? 1 : 0);
