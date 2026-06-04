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
  topIssues?: Array<{ title?: string; summary?: string }>;
};

type ArtifactSummary = {
  runDir?: string | null;
  agentDirs?: string[];
  outputFiles?: Array<{ agentDir: string; name: string }>;
};

type ApiRunDetail = {
  id: string;
  projectId: string;
  scriptId: string;
  episodeId: string;
  scriptTitle: string;
  episodeTitle: string;
  status: string;
  startedAt?: string;
  finishedAt?: string;
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
  speaker?: string;
  duration?: number;
  camera_type?: string;
  subtitle?: string;
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
  personality: string;
  visualDescription: string;
  promptTokens: string;
  referenceImageUrl: string | null;
  shotCount: number;
  scenes: string[];
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

function requestJson<T>(url: string): Promise<T> {
  return fetch(url).then(async (response) => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return response.json() as Promise<T>;
  });
}

async function requestOptionalJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return response.json() as Promise<T>;
}

function toAssetUrl(value?: string | null): string | null {
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

function mapShots(snapshot: SnapshotState | null): WorkbenchShot[] {
  const scriptShots = snapshot?.scriptData?.shots || [];
  const imageByShotId = new Map((snapshot?.imageResults || []).map((entry) => [entry.shotId, entry]));
  const videoByShotId = new Map((snapshot?.videoResults || []).map((entry) => [entry.shotId, entry]));
  const audioByShotId = new Map((snapshot?.audioResults || []).map((entry) => [entry.shotId, entry]));
  const sceneIdByShotId = buildSceneIdByShotId(snapshot?.scenePacks);

  return scriptShots.map((shot, index) => {
    const image = imageByShotId.get(shot.id);
    const video = videoByShotId.get(shot.id);
    const audio = audioByShotId.get(shot.id);
    const imageUrl = toAssetUrl(image?.imagePath);
    const videoUrl = toAssetUrl(video?.videoPath);
    const audioUrl = toAssetUrl(audio?.audioPath);

    return {
      id: shot.id,
      index,
      title: `镜头 ${String(index + 1).padStart(2, '0')}`,
      scene: shot.scene || '未标注场景',
      sceneId: sceneIdByShotId.get(shot.id) || null,
      characters: shot.characters || [],
      action: shot.action || '',
      dialogue: shot.dialogue || '',
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

function mapCharacters(snapshot: SnapshotState | null, shots: WorkbenchShot[]): WorkbenchCharacter[] {
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

  return (snapshot?.characterRegistry || []).map((character) => ({
    id: character.name,
    name: character.name,
    gender: character.gender || 'unknown',
    age: character.age || 'unknown',
    personality: character.personality || '未记录',
    visualDescription: character.visualDescription || '未记录视觉描述',
    promptTokens: character.basePromptTokens || '',
    referenceImageUrl: toAssetUrl(character.referenceImagePath),
    shotCount: shotCountByCharacter.get(character.name) || 0,
    scenes: [...(scenesByCharacter.get(character.name) || new Set())],
  }));
}

function mapScenes(snapshot: SnapshotState | null, shots: WorkbenchShot[]): WorkbenchScene[] {
  const imageBySceneId = new Map<string, string | null>();
  const shotCountBySceneId = new Map<string, number>();

  for (const shot of shots) {
    if (!shot.sceneId) continue;
    shotCountBySceneId.set(shot.sceneId, (shotCountBySceneId.get(shot.sceneId) || 0) + 1);
    if (!imageBySceneId.has(shot.sceneId) && shot.imageUrl) {
      imageBySceneId.set(shot.sceneId, shot.imageUrl);
    }
  }

  return (snapshot?.scenePacks || []).map((scene) => ({
    id: scene.scene_id,
    title: scene.scene_title || scene.location_anchor || scene.scene_id,
    goal: scene.scene_goal || '未记录场景目标',
    location: scene.location_anchor || '未记录空间锚点',
    cast: scene.cast || [],
    shotCount: shotCountBySceneId.get(scene.scene_id) || 0,
    imageUrl: imageBySceneId.get(scene.scene_id) || null,
    visualMotif: scene.visual_motif || '未记录视觉母题',
    validationStatus: scene.validation_status || 'unknown',
    validationIssues: scene.validation_issues || [],
  }));
}

function mapVoices(snapshot: SnapshotState | null, characters: WorkbenchCharacter[]): WorkbenchVoice[] {
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

  return [...voiceMap.values()].sort((a, b) => b.segmentCount - a.segmentCount);
}

function buildDescription(project: ApiProjectDetail, snapshot: SnapshotState | null, qaOverview: QaOverview | null) {
  const issue = qaOverview?.topIssues?.[0];
  if (qaOverview?.summary) return qaOverview.summary;
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
  snapshot: SnapshotState | null
): WorkbenchProject {
  const shots = mapShots(snapshot);
  const characters = mapCharacters(snapshot, shots);
  const scenes = mapScenes(snapshot, shots);
  const voices = mapVoices(snapshot, characters);
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

export async function fetchWorkbenchProject(projectId: string, runId?: string | null): Promise<WorkbenchProject> {
  const project = await requestJson<ApiProjectDetail>(`/api/projects/${encodeURIComponent(projectId)}`);
  const episodes = flattenEpisodes(project);
  const selectedEpisode =
    episodes.find((episode) => episode.latestRunId === runId) ||
    episodes.find((episode) => episode.latestRunId === project.latestRunId) ||
    episodes[0] ||
    null;

  const activeRunId = runId || selectedEpisode?.latestRunId || project.latestRunId || null;
  const run = activeRunId
    ? await requestJson<ApiRunDetail>(`/api/runs/${encodeURIComponent(activeRunId)}`)
    : null;
  const snapshot = await fetchRunSnapshot(run);

  return buildProjectViewModel(project, selectedEpisode, run, snapshot);
}

export async function fetchWorkbenchProjects(): Promise<WorkbenchProject[]> {
  const summaries = await requestJson<ApiProjectSummary[]>('/api/projects');
  return Promise.all(summaries.map((project) => fetchWorkbenchProject(project.id)));
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
  return requestJson<{
    workbenchApiBase: string;
    frontendDevServer: string;
    mode: string;
    note: string;
  }>('/api/settings/providers');
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
