export function createLipsyncPlaceholderProvider(provider) {
  return async () => {
    throw new Error(`Lip-sync provider "${provider}" 尚未接入，当前仅保留 provider routing 插槽`);
  };
}
