type ApiProjectSummary = {
  id: string;
  title: string;
  latestRunId: string | null;
  runCount: number;
  scriptCount: number;
  episodeCount: number;
};

type ApiRunSummary = {
  id: string;
  status: string;
  headline?: string;
  startedAt?: string;
  finishedAt?: string;
};

type ApiEpisode = {
  id: string;
  title: string;
  runs: ApiRunSummary[];
};

type ApiScript = {
  id: string;
  title: string;
  episodes: ApiEpisode[];
};

type ApiProjectDetail = {
  id: string;
  title: string;
  description?: string | null;
  genre?: string | null;
  style?: string | null;
  coverUrl?: string | null;
  aspectRatio?: string | null;
  latestRunId: string | null;
  runCount: number;
  scripts: ApiScript[];
};

type QaOverview = {
  status?: string;
  headline?: string;
  summary?: string;
  passCount?: number;
  warnCount?: number;
  blockCount?: number;
  releasable?: boolean;
  agentSummaries?: QaAgentSummary[];
  topIssues?: Array<string | { title?: string; summary?: string; agentKey?: string; status?: string }>;
  runDebug?: Record<string, unknown>;
};

export type QaAgentSummary = {
  agentKey?: string;
  agentName?: string;
  status?: string;
  headline?: string;
  summary?: string;
  passItems?: string[];
  warnItems?: string[];
  blockItems?: string[];
  nextAction?: string;
  nextActions?: string[];
  evidenceFiles?: string[];
};

type ArtifactSummary = {
  runDir?: string | null;
  agentDirs?: string[];
  outputFiles?: Array<{ agentDir: string; name: string }>;
};

export type ApiRunDetail = {
  id: string;
  projectId: string;
  scriptId: string;
  episodeId: string;
  scriptTitle: string;
  episodeTitle: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  artifactRunDir?: string;
  agentTaskRuns?: WorkbenchTask[];
  qaOverview?: QaOverview | null;
  artifacts?: ArtifactSummary | null;
};

type SnapshotShot = {
  id: string;
  scene?: string;
  characters?: string[];
  action?: string;
  dialogue?: string;
  emotion?: string;
  speaker?: string;
  duration?: number;
  camera_type?: string;
  subtitle?: string;
};

type EpisodeDetailPayload = {
  id: string;
  title?: string;
  shots?: SnapshotShot[];
  characters?: Array<Record<string, any>>;
  scenes?: Array<Record<string, any>>;
  voices?: Array<Record<string, any>>;
};

type SnapshotState = {
  compatibility?: {
    mode?: string;
    scriptFilePath?: string;
  };
  scriptData?: {
    title?: string;
    shots?: SnapshotShot[];
    episodes?: Array<{
      episodeNo?: number;
      title?: string;
      shots?: SnapshotShot[];
    }>;
  };
  characterRegistry?: Array<{
    id?: string;
    episodeCharacterId?: string;
    characterBibleId?: string | null;
    mainCharacterTemplateId?: string | null;
    name: string;
    gender?: string;
    age?: string;
    visualDescription?: string;
    basePromptTokens?: string;
    personality?: string;
    referenceImagePath?: string;
  }>;
  imageResults?: Array<{
    shotId: string;
    imagePath?: string;
    success?: boolean;
    characters?: string[];
    request?: {
      prompt?: string;
      negativePrompt?: string;
      referenceImages?: string[];
    };
  }>;
  videoResults?: Array<{
    shotId: string;
    provider?: string;
    status?: string;
    videoPath?: string;
    targetDurationSec?: number;
    durationSec?: number;
  }>;
  audioVoiceResolution?: Array<{
    shotId: string;
    segmentId?: string;
    hasDialogue?: boolean;
    dialogue?: string;
    speakerName?: string;
    resolvedGender?: string | null;
    ttsOptions?: { provider?: string; gender?: string } | null;
    status?: string;
    audioPath?: string | null;
    voiceSource?: string | null;
    usedDefaultVoiceFallback?: boolean;
  }>;
  audioResults?: Array<{
    shotId: string;
    audioPath?: string | null;
    hasDialogue?: boolean;
  }>;
  scenePacks?: Array<{
    scene_id: string;
    scene_title?: string;
    scene_goal?: string;
    location_anchor?: string;
    cast?: string[];
    visual_motif?: string;
    validation_status?: string;
    validation_issues?: string[];
    action_beats?: Array<{
      shot_ids?: string[];
    }>;
  }>;
  composeResult?: {
    status?: string;
    outputVideo?: {
      uri?: string;
    };
    report?: {
      warnings?: string[];
      blockedReasons?: string[];
      composedShotCount?: number;
      manualReviewShots?: string[];
      qaSummary?: Record<string, string>;
    };
  };
  outputPath?: string;
  deliverySummaryPath?: string;
};

export type WorkbenchStatus = 'pass' | 'warn' | 'block' | 'running';

export type WorkbenchTask = {
  id: string;
  step: string;
  agent?: string;
  status?: string;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
};

export type WorkbenchShot = {
  id: string;
  index: number;
  title: string;
  scene: string;
  sceneId: string | null;
  characters: string[];
  action: string;
  dialogue: string;
  emotion: string;
  speaker: string;
  durationSec: number;
  cameraType: string;
  subtitle: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  provider: string | null;
  status: WorkbenchStatus;
  hasDialogue: boolean;
};

export type WorkbenchCharacter = {
  id: string;
  name: string;
  gender: string;
  age: string;
  roleType: string;
  occupation: string;
  personality: string;
  visualDescription: string;
  promptTokens: string;
  referenceImageUrl: string | null;
  shotCount: number;
  scenes: string[];
  voice: WorkbenchVoice | null;
};

export type WorkbenchScene = {
  id: string;
  title: string;
  goal: string;
  location: string;
  cast: string[];
  shotCount: number;
  imageUrl: string | null;
  visualMotif: string;
  validationStatus: string;
  validationIssues: string[];
};

export type WorkbenchVoice = {
  id: string;
  name: string;
  provider: string;
  gender: string;
  voiceSource: string;
  sampleAudioUrl: string | null;
  segmentCount: number;
  shotCount: number;
  characterNames: string[];
  fallbackUsed: boolean;
};

export type WorkbenchEpisode = {
  id: string;
  scriptId: string;
  scriptTitle: string;
  title: string;
  latestRunId: string | null;
  status: WorkbenchStatus;
  headline: string;
  startedAt: string | null;
  finishedAt: string | null;
  runCount: number;
};

export type WorkbenchProject = {
  id: string;
  title: string;
  description: string;
  latestRunId: string | null;
  runCount: number;
  scriptCount: number;
  episodeCount: number;
  selectedEpisode: WorkbenchEpisode | null;
  episodes: WorkbenchEpisode[];
  currentRun: ApiRunDetail | null;
  qaOverview: QaOverview | null;
  artifactSummary: ArtifactSummary | null;
  snapshot: SnapshotState | null;
  shots: WorkbenchShot[];
  characters: WorkbenchCharacter[];
  scenes: WorkbenchScene[];
  voices: WorkbenchVoice[];
  assetEnrichment: AssetEnrichment;
  finalVideoUrl: string | null;
  deliverySummaryUrl: string | null;
  coverAssetUrl: string | null;
  counts: {
    totalShots: number;
    imageReady: number;
    videoReady: number;
    dialogueShots: number;
  };
};

export type WorkbenchProjectLocator = {
  runId?: string | null;
  scriptId?: string | null;
  episodeId?: string | null;
};

const REVIEWABLE_RUN_STATUSES = new Set([
  'approved',
  'cached',
  'completed',
  'completed_with_warnings',
  'needs_review',
  'pass',
  'ready_for_review',
  'reviewable',
  'success',
  'warn',
  'warning',
]);

function normalizeStatus(value?: string | null): WorkbenchStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'pass' || status === 'completed' || status === 'cached' || status === 'success') {
    return 'pass';
  }
  if (status === 'warn' || status === 'warning') {
    return 'warn';
  }
  if (status === 'block' || status === 'blocked' || status === 'failed' || status === 'error') {
    return 'block';
  }
  return 'running';
}

// Simple request cache to avoid duplicate fetches
const requestCache = new Map<string, Promise<unknown>>();

export function clearRequestCache(pattern?: string) {
  if (!pattern) {
    requestCache.clear();
    return;
  }
  for (const key of requestCache.keys()) {
    if (key.includes(pattern)) requestCache.delete(key);
  }
}

function clearProjectRequestCache(projectId: string, scriptId?: string | null, episodeId?: string | null, runId?: string | null) {
  clearRequestCache('/api/projects');
  clearRequestCache(`/api/projects/${encodeURIComponent(projectId)}`);
  clearRequestCache(`/api/projects/${encodeURIComponent(projectId)}/scripts`);
  if (scriptId) {
    clearRequestCache(`/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}`);
  }
  if (scriptId && episodeId) {
    clearRequestCache(`/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}`);
    clearRequestCache(`/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}/storyboard`);
  }
  if (runId) {
    clearRequestCache(`/api/runs/${encodeURIComponent(runId)}`);
  }
}

function getRunArtifactCacheUrls(artifactRunDir?: string | null): string[] {
  if (!artifactRunDir) return [];
  const candidates = [
    `${artifactRunDir}\\state.snapshot.json`,
    `${artifactRunDir}\\02-character-registry\\1-outputs\\character-registry.json`,
    `${artifactRunDir}\\05-consistency-checker\\0-inputs\\character-registry.json`,
    `${artifactRunDir}\\05-consistency-checker\\1-outputs\\consistency-report.json`,
  ];
  return candidates.map((value) => toAssetUrl(value)).filter((value): value is string => Boolean(value));
}

function clearRunArtifactCaches(artifactRunDir?: string | null) {
  for (const url of getRunArtifactCacheUrls(artifactRunDir)) {
    clearRequestCache(url);
    missingFilesCache.delete(url);
  }
}

function requestJson<T>(url: string): Promise<T> {
  if (requestCache.has(url)) {
    return requestCache.get(url) as Promise<T>;
  }
  const promise = fetch(url)
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `HTTP ${response.status}: ${url}`);
      }
      return response.json() as Promise<T>;
    })
    .catch((error) => {
      requestCache.delete(url);
      throw error;
    });
  requestCache.set(url, promise);
  return promise;
}

async function requestOptionalJson<T>(url: string): Promise<T | null> {
  const cacheKey = `opt:${url}`;
  if (requestCache.has(cacheKey)) {
    return requestCache.get(cacheKey) as Promise<T | null>;
  }
  const promise = fetch(url).then((response) => {
    if (!response.ok) {
      return null;
    }
    return response.json() as Promise<T>;
  });
  requestCache.set(cacheKey, promise);
  return promise;
}

export function toAssetUrl(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let normalized = raw.replace(/\\/g, '/');
  const repoMarker = '/AI-video-factory-pro/';
  const markerIndex = normalized.toLowerCase().indexOf(repoMarker.toLowerCase());

  if (markerIndex >= 0) {
    normalized = `/${normalized.slice(markerIndex + repoMarker.length)}`;
  } else if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  return encodeURI(normalized);
}

function flattenEpisodes(project: ApiProjectDetail): WorkbenchEpisode[] {
  const items: WorkbenchEpisode[] = [];

  for (const script of project.scripts || []) {
    for (const episode of script.episodes || []) {
      const latestRun = [...(episode.runs || [])].sort((a, b) => {
        return Date.parse(b.startedAt || '') - Date.parse(a.startedAt || '');
      })[0];

      items.push({
        id: episode.id,
        scriptId: script.id,
        scriptTitle: script.title,
        title: episode.title,
        latestRunId: latestRun?.id || null,
        status: normalizeStatus(latestRun?.status),
        headline: latestRun?.headline || '',
        startedAt: latestRun?.startedAt || null,
        finishedAt: latestRun?.finishedAt || null,
        runCount: episode.runs?.length || 0,
      });
    }
  }

  return items.sort((a, b) => Date.parse(b.startedAt || '') - Date.parse(a.startedAt || ''));
}

function buildSceneIdByShotId(scenePacks: SnapshotState['scenePacks']) {
  const map = new Map<string, string>();
  for (const pack of scenePacks || []) {
    for (const beat of pack.action_beats || []) {
      for (const shotId of beat.shot_ids || []) {
        map.set(shotId, pack.scene_id);
      }
    }
  }
  return map;
}

function getSnapshotShots(snapshot: SnapshotState | null): SnapshotShot[] {
  const directShots = snapshot?.scriptData?.shots;
  if (Array.isArray(directShots) && directShots.length > 0) {
    return directShots;
  }

  const episodeShots = (snapshot?.scriptData?.episodes || []).flatMap((episode) =>
    Array.isArray(episode?.shots) ? episode.shots : []
  );
  if (episodeShots.length > 0) {
    return episodeShots;
  }

  const seen = new Set<string>();
  const ids = [
    ...(snapshot?.imageResults || []).map((entry) => entry.shotId),
    ...(snapshot?.videoResults || []).map((entry) => entry.shotId),
    ...(snapshot?.audioResults || []).map((entry) => entry.shotId),
  ].filter(Boolean);

  return ids
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((id) => ({ id, scene: '当前 run 已生成产物，但快照里缺少镜头文本信息' }));
}

function mapShots(snapshot: SnapshotState | null, episodeDetail?: EpisodeDetailPayload | null): WorkbenchShot[] {
  const scriptShots = episodeDetail?.shots?.length ? episodeDetail.shots : getSnapshotShots(snapshot);
  const imageByShotId = new Map((snapshot?.imageResults || []).map((entry) => [entry.shotId, entry]));
  const videoByShotId = new Map((snapshot?.videoResults || []).map((entry) => [entry.shotId, entry]));
  const audioByShotId = new Map((snapshot?.audioResults || []).map((entry) => [entry.shotId, entry]));
  const sceneIdByShotId = buildSceneIdByShotId(snapshot?.scenePacks);

  return scriptShots.map((shot, index) => {
    const image = imageByShotId.get(shot.id);
    const video = videoByShotId.get(shot.id);
    const audio = audioByShotId.get(shot.id);
    const imageCharacters = (image?.characters || [])
      .map((character: any) => character?.name || character?.characterName || character?.episodeCharacterId || character?.id || character)
      .filter(Boolean);
    const imageUrl = toAssetUrl(image?.imagePath);
    const videoUrl = toAssetUrl(video?.videoPath);
    const audioUrl = toAssetUrl(audio?.audioPath);

    return {
      id: shot.id,
      index,
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      scene: shot.scene || '未标注场景',
      sceneId: sceneIdByShotId.get(shot.id) || null,
      characters: shot.characters?.length ? shot.characters : imageCharacters,
      action: shot.action || '',
      dialogue: shot.dialogue || '',
      emotion: shot.emotion || '',
      speaker: shot.speaker || '',
      durationSec: Number(shot.duration || 0),
      cameraType: shot.camera_type || '',
      subtitle: shot.subtitle || '',
      imageUrl,
      videoUrl,
      audioUrl,
      prompt: image?.request?.prompt || null,
      negativePrompt: image?.request?.negativePrompt || null,
      provider: video?.provider || null,
      status: videoUrl ? 'pass' : imageUrl ? 'warn' : 'running',
      hasDialogue: Boolean(shot.dialogue),
    };
  });
}

function mapCharacters(
  snapshot: SnapshotState | null,
  shots: WorkbenchShot[],
  episodeDetail?: EpisodeDetailPayload | null
): WorkbenchCharacter[] {
  const scenesByCharacter = new Map<string, Set<string>>();
  const shotCountByCharacter = new Map<string, number>();

  for (const shot of shots) {
    for (const character of shot.characters) {
      shotCountByCharacter.set(character, (shotCountByCharacter.get(character) || 0) + 1);
      if (!scenesByCharacter.has(character)) {
        scenesByCharacter.set(character, new Set());
      }
      scenesByCharacter.get(character)?.add(shot.scene);
    }
  }

  const source: Array<Record<string, any>> = Array.isArray(episodeDetail?.characters) && episodeDetail.characters.length
    ? episodeDetail.characters
    : ((snapshot?.characterRegistry || []) as Array<Record<string, any>>);

  const voiceByCharacterName = new Map<string, WorkbenchVoice>();
  for (const voice of mapVoices(snapshot, [], episodeDetail)) {
    for (const characterName of voice.characterNames) {
      if (!voiceByCharacterName.has(characterName)) {
        voiceByCharacterName.set(characterName, voice);
      }
    }
    if (!voiceByCharacterName.has(voice.name)) {
      voiceByCharacterName.set(voice.name, voice);
    }
  }

  return source.map((character) => {
    const name = String(character.name || character.characterName || character.id || '未命名角色');
    return {
      id: String(character.episodeCharacterId || character.id || name),
      name,
      gender: String(character.gender || 'unknown'),
      age: String(character.age || 'unknown'),
      roleType: String(character.roleType || character.role || character.identity || character.characterType || ''),
      occupation: String(character.occupation || character.profession || character.job || character.career || ''),
      personality: String(character.personality || '未记录'),
      visualDescription: String(character.visualDescription || '未记录视觉描述'),
      promptTokens: String(character.promptTokens || character.basePromptTokens || ''),
      referenceImageUrl: toAssetUrl(character.referenceImageUrl || character.referenceImagePath),
      shotCount: Number((character.shotCount ?? shotCountByCharacter.get(name)) || 0),
      scenes: Array.isArray(character.scenes) && character.scenes.length
        ? character.scenes.map(String)
        : [...(scenesByCharacter.get(name) || new Set())],
      voice: voiceByCharacterName.get(name) || null,
    };
  });
}

function mapScenes(
  snapshot: SnapshotState | null,
  shots: WorkbenchShot[],
  episodeDetail?: EpisodeDetailPayload | null
): WorkbenchScene[] {
  const imageBySceneId = new Map<string, string | null>();
  const shotCountBySceneId = new Map<string, number>();

  for (const shot of shots) {
    if (!shot.sceneId) continue;
    shotCountBySceneId.set(shot.sceneId, (shotCountBySceneId.get(shot.sceneId) || 0) + 1);
    if (!imageBySceneId.has(shot.sceneId) && shot.imageUrl) {
      imageBySceneId.set(shot.sceneId, shot.imageUrl);
    }
  }

  const source: Array<Record<string, any>> = Array.isArray(episodeDetail?.scenes) && episodeDetail.scenes.length
    ? episodeDetail.scenes
    : ((snapshot?.scenePacks || []) as Array<Record<string, any>>);

  return source.map((scene) => {
    const id = String(scene.id || scene.scene_id || scene.title || scene.scene_title || 'scene');
    return {
      id,
      title: String(scene.title || scene.name || scene.scene_title || scene.location_anchor || id),
      goal: String(scene.goal || scene.scene_goal || '未记录场景目标'),
      location: String(scene.location || scene.location_anchor || '未记录空间锚点'),
      cast: Array.isArray(scene.cast) ? scene.cast.map(String) : [],
      shotCount: Number((scene.shotCount ?? shotCountBySceneId.get(id)) || 0),
      imageUrl: toAssetUrl(scene.imageUrl) || imageBySceneId.get(id) || null,
      visualMotif: String(scene.visualMotif || scene.visual_motif || '未记录视觉母题'),
      validationStatus: String(scene.validationStatus || scene.validation_status || 'unknown'),
      validationIssues: Array.isArray(scene.validationIssues)
        ? scene.validationIssues.map(String)
        : Array.isArray(scene.validation_issues)
          ? scene.validation_issues.map(String)
          : [],
    };
  });
}

function mapVoices(
  snapshot: SnapshotState | null,
  characters: WorkbenchCharacter[],
  episodeDetail?: EpisodeDetailPayload | null
): WorkbenchVoice[] {
  const persistedVoices = Array.isArray(episodeDetail?.voices) ? episodeDetail.voices : [];
  const entries = (snapshot?.audioVoiceResolution || []).filter((entry) => entry.hasDialogue && entry.speakerName);
  const characterNames = new Set(characters.map((item) => item.name));
  const voiceMap = new Map<string, WorkbenchVoice>();
  const segmentIds = new Map<string, Set<string>>();
  const shotIds = new Map<string, Set<string>>();

  for (const entry of entries) {
    const name = entry.speakerName || '未命名配音';
    const voiceId = name;
    if (!voiceMap.has(voiceId)) {
      voiceMap.set(voiceId, {
        id: voiceId,
        name,
        provider: entry.ttsOptions?.provider || 'unknown',
        gender: entry.resolvedGender || 'unknown',
        voiceSource: entry.voiceSource || 'unknown',
        sampleAudioUrl: toAssetUrl(entry.audioPath),
        segmentCount: 0,
        shotCount: 0,
        characterNames: characterNames.has(name) ? [name] : [],
        fallbackUsed: Boolean(entry.usedDefaultVoiceFallback),
      });
      segmentIds.set(voiceId, new Set());
      shotIds.set(voiceId, new Set());
    }

    const voice = voiceMap.get(voiceId)!;
    voice.fallbackUsed = voice.fallbackUsed || Boolean(entry.usedDefaultVoiceFallback);
    if (!voice.sampleAudioUrl && entry.audioPath) {
      voice.sampleAudioUrl = toAssetUrl(entry.audioPath);
    }
    segmentIds.get(voiceId)?.add(entry.segmentId || `${entry.shotId}:${entry.dialogue}`);
    shotIds.get(voiceId)?.add(entry.shotId);
  }

  for (const [voiceId, voice] of voiceMap.entries()) {
    voice.segmentCount = segmentIds.get(voiceId)?.size || 0;
    voice.shotCount = shotIds.get(voiceId)?.size || 0;
  }

  for (const persisted of persistedVoices) {
    const id = String(persisted.id || persisted.name || persisted.speaker || 'voice');
    const current = voiceMap.get(id);
    voiceMap.set(id, {
      id,
      name: String(persisted.name || persisted.speaker || current?.name || '未命名配音'),
      provider: String(persisted.provider || current?.provider || 'unknown'),
      gender: String(persisted.gender || current?.gender || 'unknown'),
      voiceSource: String(persisted.voiceSource || current?.voiceSource || 'unknown'),
      sampleAudioUrl: toAssetUrl(persisted.sampleAudioUrl) || current?.sampleAudioUrl || null,
      segmentCount: Number(persisted.segmentCount || current?.segmentCount || 0),
      shotCount: Number(persisted.shotCount || current?.shotCount || 0),
      characterNames: Array.isArray(persisted.characterNames)
        ? persisted.characterNames.map(String)
        : persisted.speaker ? [String(persisted.speaker)] : current?.characterNames || [],
      fallbackUsed: Boolean(persisted.fallbackUsed ?? current?.fallbackUsed),
    });
  }

  return [...voiceMap.values()].sort((a, b) => b.segmentCount - a.segmentCount);
}

function buildDescription(project: ApiProjectDetail, snapshot: SnapshotState | null, qaOverview: QaOverview | null) {
  const issue = qaOverview?.topIssues?.[0];
  if (qaOverview?.summary) return qaOverview.summary;
  if (typeof issue === 'string') return issue;
  if (issue?.summary) return issue.summary;
  if (snapshot?.compatibility?.scriptFilePath) {
    return `来源脚本：${snapshot.compatibility.scriptFilePath}`;
  }
  return `${project.title} 的本地运行产物工作台`;
}

function buildProjectViewModel(
  project: ApiProjectDetail,
  selectedEpisode: WorkbenchEpisode | null,
  run: ApiRunDetail | null,
  snapshot: SnapshotState | null,
  episodeDetail: EpisodeDetailPayload | null,
  assetEnrichment: AssetEnrichment = { characterRegistry: [], consistencyReports: [] }
): WorkbenchProject {
  const shots = mapShots(snapshot, episodeDetail);
  const characters = mapCharacters(snapshot, shots, episodeDetail);
  const scenes = mapScenes(snapshot, shots, episodeDetail);
  const voices = mapVoices(snapshot, characters, episodeDetail);
  const qaOverview = run?.qaOverview || null;
  const finalVideoUrl = toAssetUrl(snapshot?.composeResult?.outputVideo?.uri || snapshot?.outputPath);
  const deliverySummaryUrl = toAssetUrl(snapshot?.deliverySummaryPath);
  const coverAssetUrl = finalVideoUrl || characters[0]?.referenceImageUrl || shots[0]?.imageUrl || null;

  return {
    id: project.id,
    title: project.title,
    description: buildDescription(project, snapshot, qaOverview),
    latestRunId: project.latestRunId,
    runCount: project.runCount,
    scriptCount: project.scripts.length,
    episodeCount: flattenEpisodes(project).length,
    selectedEpisode,
    episodes: flattenEpisodes(project),
    currentRun: run,
    qaOverview,
    artifactSummary: run?.artifacts || null,
    snapshot,
    assetEnrichment,
    shots,
    characters,
    scenes,
    voices,
    finalVideoUrl,
    deliverySummaryUrl,
    coverAssetUrl,
    counts: {
      totalShots: shots.length,
      imageReady: shots.filter((shot) => Boolean(shot.imageUrl)).length,
      videoReady: shots.filter((shot) => Boolean(shot.videoUrl)).length,
      dialogueShots: shots.filter((shot) => shot.hasDialogue).length,
    },
  };
}

async function fetchRunSnapshot(run: ApiRunDetail | null) {
  if (!run?.artifactRunDir) return null;
  const snapshotUrl = toAssetUrl(`${run.artifactRunDir}\\state.snapshot.json`);
  if (!snapshotUrl) return null;
  return requestOptionalJson<SnapshotState>(snapshotUrl);
}

async function fetchEpisodeDetail(projectId: string, selectedEpisode: WorkbenchEpisode | null): Promise<EpisodeDetailPayload | null> {
  if (!selectedEpisode?.scriptId || !selectedEpisode.id) return null;
  return requestOptionalJson<EpisodeDetailPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(selectedEpisode.scriptId)}/episodes/${encodeURIComponent(selectedEpisode.id)}`
  );
}

function mergeEpisodeDetailIntoSnapshot(
  snapshot: SnapshotState | null,
  episodeDetail: EpisodeDetailPayload | null
): SnapshotState | null {
  if (!episodeDetail?.shots?.length) return snapshot;

  return {
    ...(snapshot || {}),
    scriptData: {
      ...(snapshot?.scriptData || {}),
      title: snapshot?.scriptData?.title || episodeDetail.title,
      shots: episodeDetail.shots,
    },
  };
}

function findEpisodeByRunId(project: ApiProjectDetail, episodes: WorkbenchEpisode[], runId?: string | null) {
  if (!runId) return null;
  for (const script of project.scripts || []) {
    for (const episode of script.episodes || []) {
      if ((episode.runs || []).some((run) => run.id === runId)) {
        return episodes.find((item) => item.id === episode.id && item.scriptId === script.id) || null;
      }
    }
  }
  return null;
}

export async function fetchWorkbenchProject(
  projectId: string,
  locator?: string | null | WorkbenchProjectLocator
): Promise<WorkbenchProject> {
  const project = await requestJson<ApiProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`);
  const episodes = flattenEpisodes(project);
  const resolvedLocator: WorkbenchProjectLocator =
    typeof locator === 'string'
      ? { runId: locator }
      : (locator || {});
  const episodeFromRunId = findEpisodeByRunId(project, episodes, resolvedLocator.runId);
  const explicitEpisode =
    episodes.find((episode) => resolvedLocator.episodeId && resolvedLocator.scriptId
      ? episode.id === resolvedLocator.episodeId && episode.scriptId === resolvedLocator.scriptId
      : false) ||
    episodes.find((episode) => resolvedLocator.episodeId ? episode.id === resolvedLocator.episodeId : false) ||
    null;
  const selectedEpisode =
    episodeFromRunId ||
    explicitEpisode ||
    episodes.find((episode) => resolvedLocator.runId ? episode.latestRunId === resolvedLocator.runId : false) ||
    episodes.find((episode) => episode.latestRunId === project.latestRunId) ||
    episodes[0] ||
    null;

  const activeRunId = episodeFromRunId
    ? resolvedLocator.runId || null
    : explicitEpisode
      ? explicitEpisode.latestRunId || null
      : resolvedLocator.runId || selectedEpisode?.latestRunId || project.latestRunId || null;
  const run = activeRunId
    ? await requestJson<ApiRunDetail>(`/api/runs/${encodeURIComponent(activeRunId)}`)
    : null;
  
  // Parallelize snapshot + enrichment fetches (both depend on run but not on each other)
  const [snapshot, assetEnrichment, episodeDetail] = await Promise.all([
    fetchRunSnapshot(run),
    fetchAssetEnrichment(run),
    fetchEpisodeDetail(projectId, selectedEpisode),
  ]);

  return buildProjectViewModel(
    project,
    selectedEpisode,
    run,
    mergeEpisodeDetailIntoSnapshot(snapshot, episodeDetail),
    episodeDetail,
    assetEnrichment
  );
}

export async function fetchWorkbenchProjects(): Promise<WorkbenchProject[]> {
  const summaries = await requestJson<ApiProjectSummary[]>('/api/projects');
  return Promise.all(summaries.map((project) => fetchWorkbenchProject(project.id)));
}

/** 轻量级项目详情：仅获取 project→scripts→episodes 层级，不加载 run/snapshot */
export type ProjectRunSummary = { id: string; status: string; headline?: string; startedAt?: string; finishedAt?: string };
export type ProjectEpisodeDetail = { id: string; title: string; runs: ProjectRunSummary[] };
export type ProjectScriptDetail = { id: string; title: string; episodes: ProjectEpisodeDetail[] };
export type ProjectDetailData = {
  id: string;
  title: string;
  description?: string | null;
  genre?: string | null;
  style?: string | null;
  coverUrl?: string | null;
  aspectRatio?: string | null;
  latestRunId: string | null;
  runCount: number;
  scripts: ProjectScriptDetail[];
  episodeCount: number;
};

export async function fetchProjectDetail(projectId: string): Promise<ProjectDetailData> {
  const raw = await requestJson<ApiProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`);
  const episodeCount = raw.scripts.reduce((sum, s) => sum + s.episodes.length, 0);
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description || null,
    genre: raw.genre || null,
    style: raw.style || null,
    coverUrl: raw.coverUrl || null,
    aspectRatio: raw.aspectRatio || '9:16',
    latestRunId: raw.latestRunId,
    runCount: raw.runCount,
    scripts: raw.scripts.map(s => ({
      id: s.id,
      title: s.title,
      episodes: s.episodes.map(e => ({
        id: e.id,
        title: e.title,
        runs: e.runs.map(r => ({
          id: r.id,
          status: r.status,
          headline: r.headline,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        })),
      })),
    })),
    episodeCount,
  };
}

export type ReviewFindingSeverity = 'blocker' | 'high' | 'warn' | 'info';

export type ReviewFinding = {
  id: string;
  severity: ReviewFindingSeverity;
  category: string;
  message: string;
  confidence: number;
  targetRef: {
    type: string;
    id: string;
    timelineStartMs?: number;
    timelineEndMs?: number;
  };
  evidenceRefs: string[];
};

export type ReviewTaskStatus = 'pending_approval' | 'approved' | 'skipped' | 'manual_review';

export type ReviewTask = {
  id: string;
  action: string;
  status: ReviewTaskStatus;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  approvalRequired: boolean;
  confidence: number;
  targetRef: {
    type: string;
    id: string;
    timelineStartMs?: number;
    timelineEndMs?: number;
  };
  evidenceRefs: string[];
};

export type ReviewClip = {
  id: string;
  kind: 'shot' | 'sequence' | 'bridge' | 'audio' | 'final';
  label: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: string;
  riskLevel: 'blocker' | 'warn' | 'info';
  thumbnailUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  findingIds: string[];
  taskIds: string[];
  targetRef: {
    type: string;
    id: string;
  };
};

export type RunReviewData = {
  runId: string;
  projectId: string;
  projectTitle: string;
  scriptId: string;
  scriptTitle: string;
  episodeId: string;
  episodeTitle: string;
  status: string;
  createdAt: string | null;
  finalVideoUrl: string | null;
  artifactRunDir: string | null;
  reviewSummary: {
    status: string;
    totalFindings: number;
    blockingFindings: number;
    taskCount: number;
    manualTaskCount: number;
    estimatedRepairCost?: {
      currency?: string;
      min?: number | null;
      max?: number | null;
    } | null;
  };
  findings: ReviewFinding[];
  tasks: ReviewTask[];
};

export type ReviewTaskMutationResult = {
  taskId: string;
  status: ReviewTaskStatus;
};

export type StoryboardPayload = {
  projectId: string;
  scriptId: string;
  episodeId: string;
  title: string;
  shots: WorkbenchShot[];
  characters: WorkbenchCharacter[];
  scenes: WorkbenchScene[];
  voices: WorkbenchVoice[];
};

export type StoryboardShotPatch = {
  dialogue?: string;
  emotion?: string;
  scene?: string;
  cameraType?: string;
  durationSec?: number;
};

export function isRunReviewable(status?: string | null): boolean {
  return REVIEWABLE_RUN_STATUSES.has(String(status || '').toLowerCase());
}

async function parseErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({}));
  return payload?.error || `HTTP ${response.status}`;
}

function normalizeReviewSeverity(value?: string | null): ReviewFindingSeverity {
  const status = String(value || '').toLowerCase();
  if (status === 'blocker' || status === 'block' || status === 'failed' || status === 'fail' || status === 'error') {
    return 'blocker';
  }
  if (status === 'high') return 'high';
  if (status === 'info' || status === 'low') return 'info';
  return 'warn';
}

function normalizeReviewRisk(value?: string | null): ReviewClip['riskLevel'] {
  const severity = normalizeReviewSeverity(value);
  if (severity === 'blocker' || severity === 'high') return 'blocker';
  if (severity === 'warn') return 'warn';
  return 'info';
}

function normalizeReviewTaskStatus(value?: string | null): ReviewTaskStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'approved') return 'approved';
  if (status === 'skipped' || status === 'skip') return 'skipped';
  if (status === 'manual_review' || status === 'needs_review' || status === 'review') return 'manual_review';
  return 'pending_approval';
}

function normalizeTimelineMs(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return numeric > 1000 ? Math.round(numeric) : Math.round(numeric * 1000);
}

function normalizeReviewTargetRef(
  value: any,
  fallbackType = 'final_video',
  fallbackId = 'final_video'
): ReviewFinding['targetRef'] {
  const raw = value && typeof value === 'object' ? value : {};
  const startMs = normalizeTimelineMs(raw.timelineStartMs ?? raw.startMs ?? raw.startSec);
  const endMs = normalizeTimelineMs(raw.timelineEndMs ?? raw.endMs ?? raw.endSec);
  return {
    type: String(raw.type || raw.kind || fallbackType),
    id: String(raw.id || raw.targetId || fallbackId),
    ...(startMs != null ? { timelineStartMs: startMs } : {}),
    ...(endMs != null ? { timelineEndMs: endMs } : {}),
  };
}

function normalizeReviewFinding(raw: any, index: number): ReviewFinding {
  const targetRef = normalizeReviewTargetRef(raw?.targetRef, raw?.targetType || 'final_video', raw?.targetId || raw?.id || `finding_${index + 1}`);
  return {
    id: String(raw?.id || `finding_${String(index + 1).padStart(3, '0')}`),
    severity: normalizeReviewSeverity(raw?.severity || raw?.status),
    category: String(raw?.category || 'review'),
    message: String(raw?.message || raw?.summary || raw?.reason || '需要人工确认'),
    confidence: Number(raw?.confidence ?? 0.75),
    targetRef,
    evidenceRefs: Array.isArray(raw?.evidenceRefs) ? raw.evidenceRefs.map(String) : [],
  };
}

function normalizeReviewTask(raw: any, index: number): ReviewTask {
  const targetRef = normalizeReviewTargetRef(raw?.targetRef, raw?.targetType || 'final_video', raw?.targetId || raw?.id || `task_${index + 1}`);
  return {
    id: String(raw?.id || `edit_task_${String(index + 1).padStart(3, '0')}`),
    action: String(raw?.action || raw?.recommendedAction || 'manual_review'),
    status: normalizeReviewTaskStatus(raw?.status),
    priority: raw?.priority === 'high' || raw?.priority === 'low' ? raw.priority : 'medium',
    reason: String(raw?.reason || raw?.message || '待确认审片动作'),
    approvalRequired: Boolean(raw?.approvalRequired ?? raw?.needsApproval ?? true),
    confidence: Number(raw?.confidence ?? 0.75),
    targetRef,
    evidenceRefs: Array.isArray(raw?.evidenceRefs) ? raw.evidenceRefs.map(String) : [],
  };
}

function normalizeReviewClip(raw: any, index: number): ReviewClip {
  const startMs = normalizeTimelineMs(raw?.startMs ?? raw?.timelineStartMs ?? raw?.startSec) ?? 0;
  const endMs =
    normalizeTimelineMs(raw?.endMs ?? raw?.timelineEndMs ?? raw?.endSec)
    ?? (startMs + (normalizeTimelineMs(raw?.durationMs ?? raw?.durationSec) ?? 0));
  const kind = String(raw?.kind || raw?.type || raw?.targetRef?.type || 'shot').toLowerCase();
  const normalizedKind = kind === 'sequence' || kind === 'bridge' || kind === 'audio' || kind === 'final' ? kind : 'shot';
  const label = String(raw?.label || raw?.title || raw?.name || raw?.id || `片段 ${index + 1}`);
  const targetRef = normalizeReviewTargetRef(raw?.targetRef, kind, raw?.targetRef?.id || raw?.id || label);
  const sourceId = String(raw?.id || raw?.clipId || targetRef.id || `clip_${index + 1}`);
  return {
    id: `${normalizedKind}:${sourceId}`,
    kind: normalizedKind,
    label,
    startMs,
    endMs: endMs >= startMs ? endMs : startMs,
    durationMs: Math.max(0, endMs - startMs),
    status: String(raw?.status || raw?.reviewStatus || 'ready'),
    riskLevel: normalizeReviewRisk(raw?.riskLevel || raw?.severity || raw?.status),
    thumbnailUrl: toAssetUrl(raw?.thumbnailUrl || raw?.thumbnail || raw?.posterUrl || raw?.imageUrl),
    videoUrl: toAssetUrl(raw?.videoUrl || raw?.clipUrl || raw?.src || raw?.path),
    audioUrl: toAssetUrl(raw?.audioUrl || raw?.audioSrc),
    findingIds: Array.isArray(raw?.findingIds) ? raw.findingIds.map(String) : [],
    taskIds: Array.isArray(raw?.taskIds) ? raw.taskIds.map(String) : [],
    targetRef: {
      type: targetRef.type,
      id: targetRef.id,
    },
  };
}

function normalizeStoryboardPayload(raw: any, projectId: string, scriptId: string, episodeId: string): StoryboardPayload {
  const normalizedShots = Array.isArray(raw?.shots)
    ? raw.shots.map((shot: any, index: number): WorkbenchShot => ({
        id: String(shot?.id || `shot_${index + 1}`),
        index,
        title: String(shot?.title || `镜头 ${String(index + 1).padStart(2, '0')}`),
        scene: String(shot?.scene || '未标注场景'),
        sceneId: shot?.sceneId || null,
        characters: Array.isArray(shot?.characters) ? shot.characters.map(String) : [],
        action: String(shot?.action || ''),
        dialogue: String(shot?.dialogue || ''),
        emotion: String(shot?.emotion || ''),
        speaker: String(shot?.speaker || ''),
        durationSec: Number(shot?.durationSec ?? shot?.duration ?? 0),
        cameraType: String(shot?.cameraType || shot?.camera_type || ''),
        subtitle: String(shot?.subtitle || ''),
        imageUrl: toAssetUrl(shot?.imageUrl || shot?.imagePath),
        videoUrl: toAssetUrl(shot?.videoUrl || shot?.videoPath),
        audioUrl: toAssetUrl(shot?.audioUrl || shot?.audioPath),
        prompt: shot?.prompt || null,
        negativePrompt: shot?.negativePrompt || null,
        provider: shot?.provider || null,
        status: normalizeStatus(shot?.status),
        hasDialogue: Boolean(shot?.dialogue),
      }))
    : [];

  return {
    projectId: String(raw?.projectId || projectId),
    scriptId: String(raw?.scriptId || scriptId),
    episodeId: String(raw?.episodeId || episodeId),
    title: String(raw?.title || raw?.episodeTitle || episodeId),
    shots: normalizedShots,
    characters: Array.isArray(raw?.characters) ? raw.characters : [],
    scenes: Array.isArray(raw?.scenes) ? raw.scenes : [],
    voices: Array.isArray(raw?.voices) ? raw.voices : [],
  };
}

export async function fetchRunDetail(runId: string): Promise<ApiRunDetail> {
  return requestJson<ApiRunDetail>(`/api/runs/${encodeURIComponent(runId)}`);
}

export function getRunReviewVideoUrl(runId: string) {
  return `/api/runs/${encodeURIComponent(runId)}/review/video`;
}

export async function fetchRunReview(runId: string): Promise<RunReviewData> {
  const [raw, run] = await Promise.all([
    requestJson<any>(`/api/runs/${encodeURIComponent(runId)}/review`),
    fetchRunDetail(runId),
  ]);
  const report = raw?.report || raw?.review || raw || {};
  const taskPack = raw?.editTaskPack || raw?.edit_task_pack || raw?.taskPack || raw || {};
  const findings = (Array.isArray(raw?.findings) ? raw.findings : Array.isArray(taskPack?.findings) ? taskPack.findings : report?.findings || [])
    .map(normalizeReviewFinding);
  const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : Array.isArray(taskPack?.tasks) ? taskPack.tasks : [])
    .map(normalizeReviewTask);

  return {
    runId: run.id,
    projectId: String(raw?.projectId || taskPack?.projectId || run.projectId),
    projectTitle: String(raw?.projectTitle || raw?.title || run.projectId),
    scriptId: String(raw?.scriptId || taskPack?.scriptId || run.scriptId),
    scriptTitle: String(raw?.scriptTitle || run.scriptTitle || '未命名剧本'),
    episodeId: String(raw?.episodeId || taskPack?.episodeId || run.episodeId),
    episodeTitle: String(raw?.episodeTitle || run.episodeTitle || '未命名分集'),
    status: String(raw?.status || report?.status || taskPack?.reviewSummary?.status || run.status || 'needs_review'),
    createdAt: String(raw?.createdAt || taskPack?.createdAt || run.finishedAt || run.startedAt || '') || null,
    finalVideoUrl: toAssetUrl(raw?.finalVideoUrl || raw?.videoUrl || taskPack?.finalVideoRef),
    artifactRunDir: run.artifactRunDir || null,
    reviewSummary: {
      status: String(report?.summary?.status || taskPack?.reviewSummary?.status || raw?.status || 'needs_review'),
      totalFindings: Number(report?.summary?.totalFindings ?? taskPack?.reviewSummary?.totalFindings ?? findings.length),
      blockingFindings: Number(report?.summary?.blockingFindings ?? taskPack?.reviewSummary?.blockingFindings ?? findings.filter((item: ReviewFinding) => item.severity === 'blocker' || item.severity === 'high').length),
      taskCount: Number(report?.summary?.taskCount ?? taskPack?.reviewSummary?.taskCount ?? tasks.length),
      manualTaskCount: Number(report?.summary?.manualTaskCount ?? taskPack?.reviewSummary?.manualTaskCount ?? tasks.filter((item: ReviewTask) => item.status !== 'approved').length),
      estimatedRepairCost: report?.summary?.estimatedRepairCost || taskPack?.reviewSummary?.estimatedRepairCost || null,
    },
    findings,
    tasks,
  };
}

export async function fetchRunReviewClips(runId: string): Promise<ReviewClip[]> {
  const raw = await requestJson<any>(`/api/runs/${encodeURIComponent(runId)}/review/clips`);
  const source = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.clips)
      ? raw.clips
      : raw?.clips && typeof raw.clips === 'object'
        ? Object.values(raw.clips).flatMap((group) => (Array.isArray(group) ? group : []))
        : Array.isArray(raw?.items)
          ? raw.items
          : [];
  const clips = source.map(normalizeReviewClip);
  return clips.sort((a: ReviewClip, b: ReviewClip) => a.startMs - b.startMs);
}

export async function updateRunReviewTask(runId: string, taskId: string, status: ReviewTaskStatus): Promise<ReviewTaskMutationResult> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/review/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  clearRequestCache(`/api/runs/${runId}/review`);
  clearRequestCache(`/api/runs/${runId}/review/clips`);
  clearRequestCache(`/api/runs/${runId}`);
  return { taskId, status };
}

export async function fetchStoryboard(projectId: string, scriptId: string, episodeId: string, runId?: string | null): Promise<StoryboardPayload> {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  const raw = await requestJson<any>(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}/storyboard${query}`
  );
  return normalizeStoryboardPayload(raw, projectId, scriptId, episodeId);
}

export async function updateStoryboardShot(
  projectId: string,
  scriptId: string,
  episodeId: string,
  shotId: string,
  patch: StoryboardShotPatch,
  runId?: string | null,
  runArtifactDir?: string | null
): Promise<void> {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}/shots/${encodeURIComponent(shotId)}${query}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  clearProjectRequestCache(projectId, scriptId, episodeId);
  clearRunArtifactCaches(runArtifactDir);
  await response.json().catch(() => null);
}

export async function updateCharacterAsset(
  projectId: string,
  scriptId: string,
  episodeId: string,
  characterId: string,
  patch: Partial<WorkbenchCharacter>,
  runArtifactDir?: string | null
): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}/characters/${encodeURIComponent(characterId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  clearProjectRequestCache(projectId, scriptId, episodeId);
  clearRunArtifactCaches(runArtifactDir);
  await response.json().catch(() => null);
}

export async function updateSceneAsset(
  projectId: string,
  scriptId: string,
  episodeId: string,
  sceneId: string,
  patch: Partial<WorkbenchScene>,
  runArtifactDir?: string | null
): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}/scenes/${encodeURIComponent(sceneId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  clearProjectRequestCache(projectId, scriptId, episodeId);
  clearRunArtifactCaches(runArtifactDir);
  await response.json().catch(() => null);
}

export async function updateVoiceAsset(
  projectId: string,
  scriptId: string,
  episodeId: string,
  voiceId: string,
  patch: Partial<WorkbenchVoice>,
  runArtifactDir?: string | null
): Promise<void> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}/episodes/${encodeURIComponent(episodeId)}/voices/${encodeURIComponent(voiceId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  clearProjectRequestCache(projectId, scriptId, episodeId);
  clearRunArtifactCaches(runArtifactDir);
  await response.json().catch(() => null);
}

export type CreateProjectInput = {
  title: string;
  description?: string;
  genre?: string;
  style?: string;
  coverUrl?: string;
  aspectRatio?: string;
};

export type CreatedProject = {
  id: string;
  title: string;
  description?: string | null;
  genre?: string | null;
  style?: string | null;
  coverUrl?: string | null;
  aspectRatio?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
};

export async function createProjectApi(input: CreateProjectInput): Promise<CreatedProject> {
  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function updateProjectApi(id: string, input: Partial<CreateProjectInput>): Promise<CreatedProject> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function deleteProjectApi(id: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
}

// ── Script API ─────────────────────────────────────────────

export type ScriptEntry = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  charCount: number;
  episodeId?: string;
  parseOk?: boolean;
  parseError?: string | null;
  shotCount?: number;
  lastParsedAt?: string | null;
};

export type ScriptDetail = ScriptEntry & {
  content: string;
};

export async function fetchScripts(projectId: string): Promise<ScriptEntry[]> {
  return requestJson<ScriptEntry[]>(`/api/projects/${encodeURIComponent(projectId)}/scripts`);
}

export async function fetchScriptDetail(projectId: string, scriptId: string): Promise<ScriptDetail> {
  return requestJson<ScriptDetail>(`/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}`);
}

export async function uploadScript(projectId: string, title: string, content: string): Promise<ScriptEntry> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/scripts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  clearProjectRequestCache(projectId);
  return response.json();
}

export async function professionalizeScript(title: string, content: string): Promise<{ content: string; charCount: number }> {
  const response = await fetch('/api/scripts/professionalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export async function updateScript(projectId: string, scriptId: string, input: { title?: string; content?: string }): Promise<ScriptEntry> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  clearProjectRequestCache(projectId, scriptId);
  return response.json();
}

export async function deleteScript(projectId: string, scriptId: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/scripts/${encodeURIComponent(scriptId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  clearProjectRequestCache(projectId, scriptId);
}

export async function fetchWorkbenchOverview() {
  return requestJson<{
    summary: {
      projectCount: number;
      episodeCount: number;
      runCount: number;
      passCount: number;
      blockCount: number;
    };
  }>('/api/workbench');
}

export async function fetchProviderSettings() {
  return requestJson<ProviderSettingsPayload>('/api/settings/providers');
}

export type ProviderSettingField = {
  key: string;
  label: string;
  kind: 'text' | 'secret' | 'select';
  required: boolean;
  options: string[];
  value: string;
  configured: boolean;
  maskedValue?: string;
};

export type ProviderSettingSection = {
  id: string;
  title: string;
  description: string;
  fields: ProviderSettingField[];
};

export type ProviderSettingsPayload = {
  workbenchApiBase: string;
  frontendDevServer: string | null;
  mode: string;
  note: string;
  sections: ProviderSettingSection[];
};

export async function saveProviderSettings(sections: ProviderSettingSection[]) {
  const response = await fetch('/api/settings/providers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sections }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<ProviderSettingsPayload>;
}

export type ProviderPrecheckResult = {
  sectionId: string;
  sectionTitle: string;
  checkType: 'live' | 'config';
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  message: string;
  hint?: string;
};

export async function runProviderPrecheckAll() {
  const response = await fetch('/api/settings/providers/precheck', {
    method: 'POST',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<{
    checkedAt: string;
    results: ProviderPrecheckResult[];
  }>;
}

export type LlmHealthCheckResult = {
  ok: boolean;
  provider: string;
  model: string;
  latencyMs: number;
  error?: string;
  hint?: string;
};

export async function fetchLlmHealthCheck(params?: {
  projectId?: string;
  scriptId?: string;
  episodeId?: string;
}) {
  const query = new URLSearchParams();
  if (params?.projectId) query.set('projectId', params.projectId);
  if (params?.scriptId) query.set('scriptId', params.scriptId);
  if (params?.episodeId) query.set('episodeId', params.episodeId);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  const response = await fetch(`/api/health/llm${suffix}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json() as Promise<LlmHealthCheckResult>;
}

export type RunStopAt =
  | 'full'
  | 'after_ref_sheets'
  | 'after_images'
  | 'before_video';

export type RunMode =
  | { kind: 'stop'; stopAt: RunStopAt }
  | { kind: 'continue'; stopAt?: 'before_video' }
  | { kind: 'retry'; stopAt?: RunStopAt };

export async function triggerRun(
  projectId: string,
  scriptId: string,
  episodeId: string,
  options?: { style?: string; stopAt?: RunStopAt; mode?: RunMode }
) {
  const mode: RunMode | undefined = options?.mode
    ?? (options?.stopAt ? { kind: 'stop', stopAt: options.stopAt } : undefined);
  const body: Record<string, unknown> = {
    projectId,
    scriptId,
    episodeId,
  };
  if (options?.style) body.style = options.style;
  if (mode) body.mode = mode;

  const response = await fetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Trigger failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// ── SSE: Real-time run-job stream ──────────────────────────────────

export type RunStreamStatusEvent = {
  id: string;
  status: string;
  scriptTitle?: string | null;
  episodeTitle?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  artifactRunDir?: string | null;
  agentTaskRuns?: WorkbenchTask[];
};

export type RunStreamSubscription = {
  close: () => void;
};

const TERMINAL_STATUSES = new Set([
  'completed', 'failed', 'error', 'blocked', 'cancelled',
]);

/**
 * Subscribe to real-time updates for a running job via Server-Sent Events.
 * Returns an object with a `close()` method to disconnect.
 */
export function subscribeToRunStream(
  runId: string,
  callbacks: {
    onStatus: (data: RunStreamStatusEvent) => void;
    onDone?: (data: RunStreamStatusEvent) => void;
    onServerError?: (error: string) => void;
    onConnectionError?: () => void;
  }
): RunStreamSubscription {
  const eventSource = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
  let closedByClient = false;

  eventSource.addEventListener('status', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as RunStreamStatusEvent;
      callbacks.onStatus(data);
    } catch {
      // ignore malformed messages
    }
  });

  eventSource.addEventListener('done', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as RunStreamStatusEvent;
      callbacks.onDone?.(data);
    } catch {
      // ignore malformed messages
    }
    closedByClient = true;
    eventSource.close();
  });

  eventSource.addEventListener('error', (event) => {
    if (closedByClient) {
      return;
    }
    try {
      const data = JSON.parse((event as MessageEvent).data);
      callbacks.onServerError?.(data?.message || 'SSE error');
    } catch {
      callbacks.onConnectionError?.();
    }
  });

  // Safety timeout: close after 10 minutes regardless
  const safetyTimeout = window.setTimeout(() => {
    eventSource.close();
  }, 10 * 60 * 1000);

  return {
    close() {
      closedByClient = true;
      window.clearTimeout(safetyTimeout);
      eventSource.close();
    },
  };
}

/** Check if a run status string indicates a terminal (finished) state */
export function isRunTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

// ── 用户友好的错误翻译（前端兜底层）─────────────────────────

const ERROR_PATTERNS: Array<{ pattern: RegExp; friendly: string; hint: string }> = [
  { pattern: /status code 401/i, friendly: 'API 密钥无效或已过期', hint: '请检查 .env 中的 API Key' },
  { pattern: /status code 403/i, friendly: 'API 访问被拒绝', hint: '可能是 API Key 权限不足、账户余额不足或模型未开通' },
  { pattern: /status code 404/i, friendly: 'API 接口不存在', hint: '请检查 .env 中的 BASE_URL 和模型名称' },
  { pattern: /status code 429/i, friendly: 'API 请求频率超限', hint: '请稍后重试或提升并发额度' },
  { pattern: /status code 5\d{2}/i, friendly: 'AI 服务暂时不可用', hint: '服务商端问题，通常几分钟后恢复' },
  { pattern: /ECONNREFUSED/i, friendly: '无法连接到服务', hint: '请检查网络连接和 BASE_URL 配置' },
  { pattern: /ETIMEDOUT|timeout/i, friendly: '请求超时', hint: '网络不稳定或服务繁忙，请稍后重试' },
  { pattern: /ENOTFOUND|getaddrinfo/i, friendly: '域名无法解析', hint: '请检查网络和 DNS 设置' },
  { pattern: /quota|balance|insufficient|余额/i, friendly: 'API 额度不足', hint: '请登录服务商平台充值' },
];

const TERM_TRANSLATIONS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /Character Registry/gi, label: '角色档案' },
  { pattern: /Consistency Checker/gi, label: '角色一致性检查' },
  { pattern: /Human Review Queue/gi, label: '人工复核队列' },
  { pattern: /Character Asset Governance/gi, label: '角色资产治理' },
  { pattern: /Video Generation Agent/gi, label: '视频生成' },
  { pattern: /Shot QA Agent/gi, label: '镜头质检' },
  { pattern: /Image Generation Agent/gi, label: '图片生成' },
  { pattern: /Prompt Engineer/gi, label: '提示词整理' },
  { pattern: /DataInspectionFailed/i, label: '服务商内容审核未通过，通常是画面、人物或动作描述触发了平台风控' },
  { pattern: /ECONNRESET/i, label: '视频服务连接中断，通常是网络抖动或服务商临时断开' },
  { pattern: /provider_generation_failed/i, label: '视频生成失败，需要重试或检查该镜头提示词' },
  { pattern: /provider_timeout/i, label: '视频生成等待超时' },
  { pattern: /HAPPY_HORSE_CHARACTER_MISSING/i, label: 'HappyHorse 没找到对应角色，需要检查角色名和角色档案是否一致' },
  { pattern: /HAPPY_HORSE_REFERENCE_MISSING/i, label: 'HappyHorse 缺少角色参考图' },
  { pattern: /STORYBOARD_CONTEXT_CONFLICT/i, label: '分镜前后状态不一致，需要人工复核动作衔接' },
  { pattern: /entry_exit_state_mismatch/i, label: '角色进入/离开画面的状态前后不一致' },
  { pattern: /missing_ref_sheet_result/i, label: '角色参考图没有生成成功' },
  { pattern: /missing_reference_stack/i, label: '缺少关键参考图，后续视频生成会不稳定' },
  { pattern: /anatomy_structure_invalid/i, label: '人体结构疑似异常' },
  { pattern: /reference_sheet_background_invalid/i, label: '角色参考图背景不干净，可能影响一致性' },
  { pattern: /prompt_tighten/i, label: '需要收紧提示词' },
  { pattern: /reanchor_regenerate/i, label: '需要带角色参考图重新生成' },
  { pattern: /coverage/i, label: '镜头信息不够完整，系统做了兜底推断' },
  { pattern: /blocking/i, label: '存在会阻断交付的风险' },
  { pattern: /continuity/i, label: '连贯性信息不足' },
];

export function humanizeQaText(value?: string | null): string {
  let text = String(value || '').trim();
  if (!text) return '';

  for (const { pattern, label } of TERM_TRANSLATIONS) {
    text = text.replace(pattern, label);
  }

  text = text
    .replace(/\bwarn\b/gi, '提醒')
    .replace(/\bblock\b/gi, '阻断')
    .replace(/\bpass\b/gi, '通过')
    .replace(/\bagent\b/gi, '处理模块')
    .replace(/\bprofile\b/gi, '角色档案')
    .replace(/HappyHorse character not found in character registry or governance report\./gi, 'HappyHorse 没找到对应角色，请检查角色档案和角色名。')
    .replace(/Storyboard context conflict detected:/gi, '分镜上下文冲突：')
    .replace(/blocking:\s*true/gi, '会阻断交付')
    .replace(/blocking:\s*false/gi, '不阻断交付');

  const shotMatch = text.match(/^(shot_\d+)[:：](.+)$/i);
  if (shotMatch) {
    text = `${shotMatch[1]}：${shotMatch[2].trim()}`;
  }

  return text;
}

/**
 * 将技术错误信息翻译成用户友好的中文提示。
 * 如果错误已经被后端 formatRunError 格式化过（包含"技术详情"标记），则原样返回。
 * @returns {{ friendly: string; hint: string; raw: string; isTranslated: boolean }}
 */
export function translateError(rawMessage: string): { friendly: string; hint: string; raw: string; isTranslated: boolean } {
  const msg = String(rawMessage || '').trim();

  // Already formatted by backend — return as-is
  if (msg.includes('技术详情') || msg.includes('💡')) {
    return { friendly: msg.split('\n')[0], hint: '', raw: msg, isTranslated: false };
  }

  for (const entry of ERROR_PATTERNS) {
    if (entry.pattern.test(msg)) {
      return { friendly: entry.friendly, hint: entry.hint, raw: msg, isTranslated: true };
    }
  }

  return { friendly: msg.length > 80 ? '运行过程中出现错误' : msg || '未知错误', hint: '', raw: msg, isTranslated: false };
}

export function formatRunStatus(status: WorkbenchStatus) {
  if (status === 'pass') return '已完成';
  if (status === 'warn') return '待复核';
  if (status === 'block') return '已阻断';
  return '运行中';
}

export function getStatusTone(status: WorkbenchStatus) {
  if (status === 'pass') return 'bg-emerald-100 text-emerald-700 border-emerald-300';
  if (status === 'warn') return 'bg-amber-100 text-amber-700 border-amber-300';
  if (status === 'block') return 'bg-red-100 text-red-600 border-red-300';
  return 'bg-cyan-100 text-cyan-700 border-cyan-300';
}

// ── Asset Library enrichment types ──────────────────────────────

export type CharacterRegistryEntry = {
  id?: string;
  episodeCharacterId?: string;
  name: string;
  gender?: string;
  age?: string;
  visualDescription?: string;
  basePromptTokens?: string;
  personality?: string;
  priority?: 'lead' | 'support' | 'temporary';
  referenceImages?: string[];
  identityAnchor?: string;
  negativeDriftTokens?: string | null;
  forbiddenIdentityTokens?: string;
  characterBibleId?: string | null;
  mainCharacterTemplateId?: string | null;
  referenceImagePath?: string;
};

export type ConsistencyReportEntry = {
  character: string;
  overallScore: number;
  identityDriftTags?: string[];
  hardFailureReasons?: string[];
  softRiskTags?: string[];
  anchorSummary?: Record<string, string>;
  suggestion?: string;
  problematicImageIndices?: number[];
  imageList?: Array<{ shotId: string; imagePath?: string; characters?: string[] }>;
};

export type AssetEnrichment = {
  characterRegistry: CharacterRegistryEntry[];
  consistencyReports: ConsistencyReportEntry[];
};

// Cache for missing files to avoid repeated 404 requests
const missingFilesCache = new Set<string>();

/** Try loading character-registry.json from multiple possible agent output paths */
async function fetchCharacterRegistry(artifactRunDir: string): Promise<CharacterRegistryEntry[]> {
  const candidates = [
    `${artifactRunDir}\\02-character-registry\\1-outputs\\character-registry.json`,
    `${artifactRunDir}\\05-consistency-checker\\0-inputs\\character-registry.json`,
  ];
  for (const p of candidates) {
    const url = toAssetUrl(p);
    if (!url || missingFilesCache.has(url)) continue;
    const data = await requestOptionalJson<CharacterRegistryEntry[]>(url);
    if (data) return data;
    missingFilesCache.add(url);
  }
  return [];
}

/** Try loading consistency-report.json from the consistency checker output */
async function fetchConsistencyReport(artifactRunDir: string): Promise<ConsistencyReportEntry[]> {
  const p = `${artifactRunDir}\\05-consistency-checker\\1-outputs\\consistency-report.json`;
  const url = toAssetUrl(p);
  if (!url || missingFilesCache.has(url)) return [];
  const data = await requestOptionalJson<ConsistencyReportEntry[]>(url);
  if (!data) missingFilesCache.add(url);
  return data || [];
}

/** Load enriched asset data (character registry + consistency reports) for the given run */
export async function fetchAssetEnrichment(run: ApiRunDetail | null): Promise<AssetEnrichment> {
  if (!run?.artifactRunDir) return { characterRegistry: [], consistencyReports: [] };
  const [characterRegistry, consistencyReports] = await Promise.all([
    fetchCharacterRegistry(run.artifactRunDir),
    fetchConsistencyReport(run.artifactRunDir),
  ]);
  return { characterRegistry, consistencyReports };
}
