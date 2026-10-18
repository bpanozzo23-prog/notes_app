// Generated pixels only: reusable PNG writer for the sample, screenshots and measurements.
import { deflateSync, crc32 } from "node:zlib";
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
export function makePng(width = 480, height = 270, noise = false, seed = 1) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  let state = seed;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * (width * 3 + 1) + 1 + x * 3;
    const circle = (x - width * .73) ** 2 + (y - height * .35) ** 2 < (height * .18) ** 2;
    const hill = y > height * .8 - Math.sin(x / width * Math.PI) * height * .25;
    const color = circle ? [252, 211, 77] : hill ? [52, 124, 96] : [100 + Math.round(x / width * 70), 175 + Math.round(y / height * 35), 230];
    for (let c = 0; c < 3; c++) rows[at + c] = noise ? random() : color[c];
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
