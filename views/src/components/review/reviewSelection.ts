import type { ReviewClip } from '../../lib/workbench';

export function resolveSelectedClipId(
  filteredClips: ReviewClip[],
  selectedClipId: string | null
): string | null {
  if (!filteredClips.length) return null;
  if (!selectedClipId || !filteredClips.some((clip) => clip.id === selectedClipId)) {
    return filteredClips[0].id;
  }
  return selectedClipId;
}
