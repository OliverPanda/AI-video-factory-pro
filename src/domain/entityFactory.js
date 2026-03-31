import { randomUUID } from 'node:crypto';

const DRAFT_STATUS = 'draft';

export function createEntity(input = {}, prefix) {
  const now = new Date().toISOString();

  return {
    ...input,
    id: input.id ?? `${prefix}_${randomUUID()}`,
    status: input.status ?? DRAFT_STATUS,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? input.createdAt ?? now,
  };
}

