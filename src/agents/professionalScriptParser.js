const TITLE_RE = /《([^》]+)》/;
const EPISODE_HEADING_RE = /^第\s*(\d+)\s*集(?:《([^》]+)》)?\s*$/;
const SCENE_RE = /^【场景】\s*(.+)$/;
const PICTURE_RE = /^【画面\s*(\d+)】\s*$/;
const SFX_RE = /^(?:SFX|音效)[:：]\s*(.+)$/i;
const SUBTITLE_RE = /^字幕(?:浮现)?[:：]\s*(.+)$/;
const SPEAKER_RE = /^([^：:（）()\s]{1,20})(?:[（(]([^）)]+)[）)])?[:：]\s*(.+)$/;
const CAMERA_PREFIX_RE = /^(特写|近景|中景|全景|远景|俯拍|航拍|推镜|拉镜|摇镜|跟拍)[。\.、,，]?\s*/;
const RESERVED_SPEAKERS = new Set(['系统音', '旁白', '字幕', 'SFX', '音效']);

function normalizeScriptText(scriptText) {
  return String(scriptText || '').replace(/\r\n?/g, '\n');
}

function clampDuration(seconds) {
  return Math.max(3, Math.min(8, seconds));
}

function pushUnique(items, value) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function isEpisodeHeading(line) {
  return EPISODE_HEADING_RE.test(line.trim());
}

function extractTitle(scriptText, options = {}) {
  const lines = scriptText.split('\n');
  const firstEpisodeLineIndex = lines.findIndex((line) => isEpisodeHeading(line));
  const preambleLines = firstEpisodeLineIndex >= 0 ? lines.slice(0, firstEpisodeLineIndex) : lines;
  const titleMatch = preambleLines.join('\n').match(TITLE_RE);

  return titleMatch?.[1] || options.title || '未命名剧本';
}

export function splitProfessionalEpisodes(scriptText) {
  const normalized = normalizeScriptText(scriptText);
  const lines = normalized.split('\n');
  const episodes = [];
  let preamble = [];
  let currentEpisode = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(EPISODE_HEADING_RE);

    if (headingMatch) {
      currentEpisode = {
        episodeNo: Number(headingMatch[1]),
        title: headingMatch[2] || `第${Number(headingMatch[1])}集`,
        lines: [],
      };
      episodes.push(currentEpisode);
      continue;
    }

    if (currentEpisode) {
      currentEpisode.lines.push(line);
    } else {
      preamble.push(line);
    }
  }

  return {
    preamble: preamble.join('\n'),
    episodes,
  };
}

function splitEpisodePictureBlocks(episode) {
  const blocks = [];
  let currentScene = '';
  let currentBlock = null;

  function finishBlock() {
    if (currentBlock) {
      currentBlock.rawBlock = [currentBlock.markerLine, ...currentBlock.lines].join('\n');
      blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  for (const line of episode.lines) {
    const trimmed = line.trim();
    const sceneMatch = trimmed.match(SCENE_RE);
    const pictureMatch = trimmed.match(PICTURE_RE);

    if (sceneMatch) {
      finishBlock();
      currentScene = sceneMatch[1].trim();
      continue;
    }

    if (pictureMatch) {
      finishBlock();
      currentBlock = {
        episodeNo: episode.episodeNo,
        episodeTitle: episode.title,
        pictureNo: Number(pictureMatch[1]),
        markerLine: line,
        scene: currentScene,
        lines: [],
        rawBlock: '',
      };
      continue;
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }

  finishBlock();
  return blocks;
}

function parseSpeakerCue(line) {
  const systemMatch = line.match(/^系统音[:：]\s*(.+)$/);
  if (systemMatch) {
    return {
      type: 'system_voice',
      speaker: '系统音',
      text: systemMatch[1].trim(),
    };
  }

  const speakerMatch = line.match(SPEAKER_RE);
  if (!speakerMatch) {
    return null;
  }

  const speaker = speakerMatch[1].trim();
  if (speaker === 'SFX' || speaker === '音效' || speaker.startsWith('字幕')) {
    return null;
  }

  return {
    type: 'dialogue',
    speaker,
    performance: speakerMatch[2]?.trim() || undefined,
    text: speakerMatch[3].trim(),
  };
}

function cleanActionLine(line, shot) {
  const cameraMatch = line.match(CAMERA_PREFIX_RE);
  if (cameraMatch && !shot.camera_type) {
    shot.camera_type = cameraMatch[1];
  }

  return line.replace(CAMERA_PREFIX_RE, '').trim();
}

export function parsePictureBlock(block, options = {}) {
  const shot = {
    id: options.id || '',
    scene: block.scene || '',
    characters: [],
    action: '',
    dialogue: '',
    speaker: '',
    duration: 3,
    camera_type: '',
    audioCues: [],
    sfx: [],
    subtitle: '',
    blackScreen: false,
    source: {
      inputFormat: 'professional-script',
      episodeNo: block.episodeNo,
      episodeTitle: block.episodeTitle,
      pictureNo: block.pictureNo,
      rawBlock: block.rawBlock,
    },
  };
  const actionLines = [];

  for (const rawLine of block.lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const sfxMatch = line.match(SFX_RE);
    if (sfxMatch) {
      shot.sfx.push({ type: 'sfx', text: sfxMatch[1].trim() });
      continue;
    }

    const subtitleMatch = line.match(SUBTITLE_RE);
    if (subtitleMatch) {
      shot.subtitle = subtitleMatch[1].trim();
      continue;
    }

    const audioCue = parseSpeakerCue(line);
    if (audioCue) {
      shot.audioCues.push(audioCue);
      continue;
    }

    if (line.includes('黑屏')) {
      shot.blackScreen = true;
    }

    const actionLine = cleanActionLine(line, shot);
    if (actionLine) {
      actionLines.push(actionLine);
    }
  }

  shot.action = actionLines.join('\n');

  const dialogueCues = shot.audioCues.filter((cue) => cue.type === 'dialogue');
  const systemCue = shot.audioCues.find((cue) => cue.type === 'system_voice');
  if (dialogueCues.length > 0) {
    shot.speaker = dialogueCues[0].speaker;
    shot.dialogue = dialogueCues.map(formatDialogueCue).join('\n');
  } else if (systemCue) {
    shot.speaker = systemCue.speaker;
    shot.dialogue = systemCue.text;
  }

  const dialogueText = dialogueCues.map((cue) => cue.text).join('');
  const dialogueSeconds = dialogueText ? Math.ceil(dialogueText.length / 12) : 0;
  shot.duration = clampDuration(3 + dialogueSeconds);

  return shot;
}

function formatDialogueCue(cue) {
  const performance = cue.performance ? `（${cue.performance}）` : '';
  return `${cue.speaker}${performance}：${cue.text}`;
}

export function extractCharacters(shots) {
  const knownNames = [];

  for (const shot of shots) {
    for (const cue of shot.audioCues || []) {
      if (cue.type === 'dialogue' && !RESERVED_SPEAKERS.has(cue.speaker)) {
        pushUnique(knownNames, cue.speaker);
      }
    }
  }

  for (const shot of shots) {
    const shotCharacters = [];

    for (const cue of shot.audioCues || []) {
      if (cue.type === 'dialogue' && !RESERVED_SPEAKERS.has(cue.speaker)) {
        pushUnique(shotCharacters, cue.speaker);
      }
    }

    for (const name of knownNames) {
      if ((shot.action || '').includes(name)) {
        pushUnique(shotCharacters, name);
      }
    }

    shot.characters = shotCharacters;
  }

  return knownNames.map((name) => ({ name }));
}

function buildMetrics(episodes, shots) {
  return {
    episode_count: episodes.length,
    picture_block_count: shots.length,
    preserved_picture_count: shots.filter((shot) => shot.source?.pictureNo).length,
    sfx_count: shots.reduce((count, shot) => count + (shot.sfx?.length || 0), 0),
    system_voice_count: shots.reduce(
      (count, shot) => count + (shot.audioCues || []).filter((cue) => cue.type === 'system_voice').length,
      0
    ),
    subtitle_count: shots.filter((shot) => shot.subtitle).length,
    black_screen_count: shots.filter((shot) => shot.blackScreen).length,
  };
}

export function parseProfessionalScript(scriptText, options = {}) {
  const normalized = normalizeScriptText(scriptText);
  const title = extractTitle(normalized, options);
  const structure = splitProfessionalEpisodes(normalized);
  const pictureBlocks = structure.episodes.flatMap((episode) => splitEpisodePictureBlocks(episode));

  if (pictureBlocks.length === 0) {
    throw new Error('professional-script 模式未找到任何【画面N】，如需改编散文/小说请使用 --input-format=raw-novel');
  }

  const shots = pictureBlocks.map((block, index) =>
    parsePictureBlock(block, {
      id: `shot_${String(index + 1).padStart(3, '0')}`,
    })
  );
  const characters = extractCharacters(shots);
  const episodes = structure.episodes.map((episode) => ({
    episodeNo: episode.episodeNo,
    title: episode.title,
    shots: shots.filter((shot) => shot.source.episodeNo === episode.episodeNo),
  }));
  const metrics = buildMetrics(episodes, shots);

  return {
    title,
    totalDuration: shots.reduce((sum, shot) => sum + shot.duration, 0),
    characters,
    episodes,
    shots,
    professionalStructure: {
      preamble: structure.preamble,
      episodes: structure.episodes.map((episode) => ({
        episodeNo: episode.episodeNo,
        title: episode.title,
      })),
    },
    parserMetadata: {
      inputFormat: 'professional-script',
      parserMode: 'deterministic-professional-script',
      fallbackUsed: false,
      llmRewriteUsed: false,
      metrics,
    },
  };
}

export const __testables = {
  splitProfessionalEpisodes,
  parsePictureBlock,
  extractCharacters,
};
