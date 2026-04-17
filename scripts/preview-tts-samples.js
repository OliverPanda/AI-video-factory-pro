#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { textToSpeech } from '../src/apis/ttsApi.js';

function sanitizeFileSegment(value, fallback = 'sample') {
  const normalized = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
  return normalized || fallback;
}

export function parseTtsEvalSamples(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim());

  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (!line) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks
    .map((block) => {
      if (block.length === 1) {
        return { label: null, text: block[0] };
      }
      return { label: block[0], text: block.slice(1).join(' ') };
    })
    .filter((entry) => Boolean(entry.text));
}

async function main() {
  const inputPath = path.resolve(process.cwd(), process.argv[2] || 'samples/tts-eval-lines.txt');
  const outputDir = path.resolve(process.cwd(), process.argv[3] || 'temp/tts-eval-samples');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`找不到输入文件：${inputPath}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const samples = parseTtsEvalSamples(fs.readFileSync(inputPath, 'utf-8'));
  if (samples.length === 0) {
    throw new Error(`输入文件没有可生成的试听样本：${inputPath}`);
  }

  console.log(`[tts-preview] input=${inputPath}`);
  console.log(`[tts-preview] output=${outputDir}`);
  console.log(`[tts-preview] provider=${process.env.TTS_PROVIDER || 'minimax'}`);

  const manifest = [];
  for (const [index, sample] of samples.entries()) {
    const prefix = String(index + 1).padStart(2, '0');
    const fileName = `${prefix}_${sanitizeFileSegment(sample.label || sample.text.slice(0, 12))}.mp3`;
    const outputPath = path.join(outputDir, fileName);
    await textToSpeech(sample.text, outputPath, {
      provider: process.env.TTS_PROVIDER || 'minimax',
    });
    manifest.push({
      index: index + 1,
      label: sample.label,
      text: sample.text,
      outputPath,
    });
    console.log(`[tts-preview] ok ${fileName}`);
  }

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`[tts-preview] done ${manifest.length} files`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[tts-preview] ${error.message}`);
    process.exitCode = 1;
  });
}
