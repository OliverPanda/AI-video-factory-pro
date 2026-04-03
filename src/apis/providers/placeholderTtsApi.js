export function createPlaceholderProvider(provider) {
  return () => {
    throw new Error(`TTS provider "${provider}" 尚未接入，当前仅保留 provider routing 插槽`);
  };
}
