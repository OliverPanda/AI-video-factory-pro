export async function lipsyncWithMock() {
  // Mock provider intentionally produces no real video artifact.
  // Returning null prevents downstream stages from treating placeholders as valid MP4 clips.
  return null;
}
