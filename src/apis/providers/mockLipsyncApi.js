import { saveBuffer } from '../../utils/fileHelper.js';

export async function lipsyncWithMock(_input, outputPath, options = {}) {
  const source = options.audioPath || options.shotId || 'mock';
  saveBuffer(outputPath, Buffer.from(`mock-lipsync:${source}`, 'utf-8'));
  return outputPath;
}
