function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return fallback;
}

export function resolveVideoProviderCapabilities(provider, env = process.env) {
  const normalizedProvider = normalizeString(provider)?.toLowerCase() || 'seedance';

  if (normalizedProvider === 'happyhorse') {
    return {
      provider: 'happyhorse',
      supportsReferenceImages: true,
      supportsReferenceVideos: false,
      supportsFirstLastFrame: normalizeBoolean(env.HAPPYHORSE_SUPPORTS_FIRST_LAST_FRAME, false),
      maxReferenceImages: 9,
      minDurationSec: 3,
      maxDurationSec: 15,
      preferredContinuityModes: [
        'single_shot_reference',
        'multi_shot_sequence_reference',
        'image_reference_bridge',
      ],
    };
  }

  return {
    provider: normalizedProvider,
    supportsReferenceImages: true,
    supportsReferenceVideos: true,
    supportsFirstLastFrame: true,
    maxReferenceImages: null,
    minDurationSec: null,
    maxDurationSec: null,
    preferredContinuityModes: ['video_continuation', 'first_last_keyframe', 'image_reference_bridge'],
  };
}

export function chooseBridgeContinuityStrategy({ bridgeType, continuityRisk, provider }, env = process.env) {
  const capabilities = resolveVideoProviderCapabilities(provider, env);
  const requiresStrictFrameBinding =
    continuityRisk === 'high' && (bridgeType === 'motion_carry' || bridgeType === 'spatial_transition');

  if (!requiresStrictFrameBinding) {
    return {
      strategy: 'image_reference_bridge',
      bridgeGenerationMode: 'image_to_video_bridge',
      reason: 'transition_can_be_expressed_as_reference_image_bridge',
      capabilities,
    };
  }

  if (capabilities.supportsFirstLastFrame) {
    return {
      strategy: 'first_last_frame_bridge',
      bridgeGenerationMode: 'first_last_keyframe',
      reason: 'provider_supports_strict_first_last_frame_bridge',
      capabilities,
    };
  }

  if (capabilities.supportsReferenceImages) {
    return {
      strategy: 'image_reference_bridge',
      bridgeGenerationMode: 'image_to_video_bridge',
      reason: 'provider_lacks_first_last_frame_support_using_image_reference_bridge',
      capabilities,
    };
  }

  return {
    strategy: 'manual_review',
    bridgeGenerationMode: 'manual_review_required',
    reason: 'provider_cannot_satisfy_bridge_reference_requirements',
    capabilities,
  };
}

export default {
  chooseBridgeContinuityStrategy,
  resolveVideoProviderCapabilities,
};
