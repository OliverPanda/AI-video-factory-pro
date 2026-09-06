const CANONICAL_OPERATIONS = new Set([
  'generate_image',
  'edit_image',
  'generate_video',
  'synthesize_speech',
  'unknown',
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePath(value) {
  return normalizeText(value).replace(/\\/g, '/');
}

function normalizeKnownOperation(value) {
  const normalized = normalizeText(value).replace(/[\s.-]+/g, '_');
  if (!normalized) return '';
  if (CANONICAL_OPERATIONS.has(normalized)) return normalized;
  if (['image_generation', 'generate_images', 'image_generate', 'txt2img'].includes(normalized)) return 'generate_image';
  if (['image_edit', 'edit_images', 'img2img', 'inpaint', 'outpaint'].includes(normalized)) return 'edit_image';
  if (['video_generation', 'generate_videos', 'video_generate', 'image_to_video', 'i2v'].includes(normalized)) return 'generate_video';
  if (['tts', 'text_to_speech', 'speech'].includes(normalized)) return 'synthesize_speech';
  return '';
}

export function classifyBillingOperation(input = {}) {
  const direct = normalizeKnownOperation(input.operation);
  if (direct) return direct;

  const raw = input.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload : {};
  const other = raw.other && typeof raw.other === 'object' ? raw.other : {};
  const requestPath = normalizePath(
    input.requestPath
      || input.path
      || input.url
      || raw.request_path
      || raw.requestPath
      || raw.path
      || other.request_path
      || other.requestPath
      || other.path
  );
  const modelName = normalizeText(input.modelName || raw.model_name || raw.modelName);
  const category = normalizeText(input.category || raw.category);

  if (requestPath.includes('/images/edits') || requestPath.includes('/image/edit')) {
    return 'edit_image';
  }
  if (requestPath.includes('/images/generations') || requestPath.includes('/image/generation')) {
    return 'generate_image';
  }
  if (requestPath.includes('/videos') || requestPath.includes('/video/') || requestPath.includes('/v1/video')) {
    return 'generate_video';
  }
  if (requestPath.includes('/audio/speech') || requestPath.includes('/tts') || requestPath.includes('/speech')) {
    return 'synthesize_speech';
  }

  if (modelName.includes('image-edit') || modelName.includes('image_edit')) return 'edit_image';
  if (modelName.includes('image')) return 'generate_image';
  if (modelName.includes('video') || modelName.includes('seedance') || modelName.includes('sora')) return 'generate_video';
  if (modelName.includes('tts') || modelName.includes('speech')) return 'synthesize_speech';

  if (category === 'image') return 'generate_image';
  if (category === 'video') return 'generate_video';
  if (category === 'audio' || category === 'tts') return 'synthesize_speech';
  return 'unknown';
}

export default {
  classifyBillingOperation,
};
