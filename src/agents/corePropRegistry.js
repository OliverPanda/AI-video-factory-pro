import { normalizeText } from '../utils/normalization.js';

function shotText(shot = {}) {
  return [shot.action, shot.dialogue, shot.scene, shot.subtitle]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');
}

function detectBindingChainShots(shots = []) {
  return (Array.isArray(shots) ? shots : []).filter((shot) => /锁链/.test(shotText(shot)));
}

function normalizeCorePropContract(candidate = {}, options = {}) {
  return {
    propId: candidate.propId,
    displayName: candidate.displayName,
    aliases: Array.isArray(candidate.aliases) ? candidate.aliases : [],
    appearance: candidate.appearance,
    activeShotIds: Array.isArray(candidate.activeShotIds) ? candidate.activeShotIds : [],
    placementPolicy: {
      anchorType: candidate.placementPolicy?.anchorType || null,
      requiredVisibleAnchors: Array.isArray(candidate.placementPolicy?.requiredVisibleAnchors)
        ? candidate.placementPolicy.requiredVisibleAnchors
        : [],
      forbiddenAnchors: Array.isArray(candidate.placementPolicy?.forbiddenAnchors)
        ? candidate.placementPolicy.forbiddenAnchors
        : [],
    },
    source: {
      kind: 'script_inference',
      projectId: options.projectId || null,
      scriptId: options.scriptId || null,
      episodeId: options.episodeId || null,
    },
  };
}

function detectPropCandidates(shots = []) {
  const chainShots = detectBindingChainShots(shots);
  if (chainShots.length < 2) {
    return [];
  }

  return [
    {
      propId: 'binding_chain',
      displayName: '绑定锁链',
      aliases: ['锁链', '黑色锁链'],
      appearance: 'semi-transparent black chain',
      activeShotIds: chainShots.map((shot) => shot.id).filter(Boolean),
      placementPolicy: {
        anchorType: 'wrist_endpoint_pair',
        requiredVisibleAnchors: ['left_character_wrist', 'right_character_wrist'],
        forbiddenAnchors: ['neck', 'collar', 'throat'],
      },
    },
  ];
}

export function buildCorePropRegistry(shots = [], options = {}) {
  return detectPropCandidates(shots).map((candidate) => normalizeCorePropContract(candidate, options));
}

export const __testables = {
  detectBindingChainShots,
  detectPropCandidates,
  normalizeCorePropContract,
  shotText,
};
