import { randomUUID } from 'node:crypto';

export function createEntity(input = {}, prefix) {
  const now = new Date().toISOString();

  return {
    ...input,
    id: input.id ?? `${prefix}_${randomUUID()}`,
    status: input.status ?? 'draft',
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };
}

