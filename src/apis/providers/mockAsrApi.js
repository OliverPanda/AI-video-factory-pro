export async function transcribeWithMock(audioPath, options = {}) {
  if (typeof options.mockTranscript === 'string') {
    return options.mockTranscript;
  }

  return `[mock transcript] ${audioPath}`;
}
