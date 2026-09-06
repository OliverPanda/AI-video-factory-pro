import type { StoryboardShotPatch, WorkbenchScene, WorkbenchShot } from '../lib/workbench';

export function revertFailedShotPatch(
  current: WorkbenchShot,
  previous: WorkbenchShot,
  patch: StoryboardShotPatch
): WorkbenchShot {
  const reverted = { ...current };

  if (Object.prototype.hasOwnProperty.call(patch, 'dialogue')) {
    reverted.dialogue = previous.dialogue;
    reverted.hasDialogue = previous.hasDialogue;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'emotion')) {
    reverted.emotion = previous.emotion;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'scene')) {
    reverted.scene = previous.scene;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'cameraType')) {
    reverted.cameraType = previous.cameraType;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'durationSec')) {
    reverted.durationSec = previous.durationSec;
  }

  return reverted;
}

export function reconcileShotSceneDraft(
  shot: WorkbenchShot,
  scenes: WorkbenchScene[],
  nextScene: string
): WorkbenchShot {
  const normalizedScene = nextScene.trim();
  const matchedScene = scenes.find((scene) => scene.title === normalizedScene || scene.id === normalizedScene) || null;

  return {
    ...shot,
    scene: nextScene,
    sceneId: matchedScene?.id || null,
  };
}
