// parser/index.js — routes files to the correct parser
// All parsers return { points: [[lat, lon], ...], name, fileType }

import { parseGPX, parseTCX } from './gpx.js';
import { parseFIT } from './fit.js';

export async function parseFile(file, ext) {
  if (ext === 'fit') {
    const buffer = await file.arrayBuffer();
    return parseFIT(buffer);
  }

  const text = await file.text();
  if (ext === 'gpx') return parseGPX(text);
  if (ext === 'tcx') return parseTCX(text);

  throw new Error(`Unsupported file type: .${ext}`);
}
