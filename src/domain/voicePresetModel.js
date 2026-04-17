import { randomUUID } from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

export function createVoicePreset(input = {}) {
  const timestamp = nowIso();

  return {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    name: input.name,
    provider: input.provider ?? 'minimax',
    tags: input.tags ? [...input.tags] : [],
    sampleAudioPath: input.sampleAudioPath ?? null,
    status: input.status ?? 'draft',
    rate: input.rate,
    pitch: input.pitch,
    volume: input.volume,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}
