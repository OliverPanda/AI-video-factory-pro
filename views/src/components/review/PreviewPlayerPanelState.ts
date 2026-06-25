import type { RunReviewData } from '../../lib/workbench.ts';
import { toAssetUrl } from '../../lib/workbench.ts';

export type PreviewPlayerErrorState = {
  message: string;
  detail: string | null;
  artifactHref: string | null;
  artifactLabel: string;
};

export function buildPreviewPlayerErrorState(
  review: Pick<RunReviewData, 'artifactRunDir'>,
  videoError: string | null
): PreviewPlayerErrorState {
  return {
    message: '无法加载成片视频',
    detail: videoError || null,
    artifactHref: toAssetUrl(review.artifactRunDir),
    artifactLabel: '查看 Artifact',
  };
}
