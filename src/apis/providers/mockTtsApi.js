import { saveBuffer } from '../../utils/fileHelper.js';

export async function ttsWithMock(text, outputPath) {
  saveBuffer(outputPath, Buffer.from(`mock:${text}`, 'utf-8'));
  return outputPath;
}
