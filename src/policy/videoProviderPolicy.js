import { normalizeDecisionRecord } from '../runtime/schemas/decisionRecord.js';

function normalizeProviderName(rawProvider) {
  const value = String(rawProvider || '').trim().toLowerCase();
  if (!value) return 'seedance';
  if (value === 'fallback_video') return 'sora2';
  return value;
}

export function resolveDefaultVideoProvider(options = {}) {
  return normalizeProviderName(options.videoProvider || process.env.VIDEO_PROVIDER || 'seedance');
}

export function decideShotVideoProvider({
  shot,
  motionEntry,
  imageResult,
  options = {},
} = {}) {
  const hasReferenceImage = Boolean(imageResult?.imagePath);
  const requestedProvider = resolveDefaultVideoProvider(options);
  const preferredProvider = hasReferenceImage ? requestedProvider : 'static_image';
  const fallbackProviders = [];

  return {
    preferredProvider,
    fallbackProviders,
    decisionRecord: normalizeDecisionRecord({
      decisionType: 'video_provider_selection',
      policySource: 'videoProviderPolicy',
      decisionKey: shot?.id || motionEntry?.shotId || '',
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        shotId: shot?.id || motionEntry?.shotId || null,
        requestedProvider,
        hasReferenceImage,
        motionShotType: motionEntry?.shotType || null,
      },
      outputSnapshot: {
        preferredProvider,
        fallbackProviders,
      },
      rationale: hasReferenceImage
        ? `reference image available, using requested provider ${requestedProvider}`
        : 'reference image missing, forcing static_image',
      tags: ['video-routing', hasReferenceImage ? 'reference-available' : 'reference-missing'],
    }),
  };
}

export default {
  resolveDefaultVideoProvider,
  decideShotVideoProvider,
};
