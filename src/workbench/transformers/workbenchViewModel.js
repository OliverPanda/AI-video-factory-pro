const stageConfig = {
  preproduction: new Set([
    'build_character_registry',
    'generate_character_ref_sheets',
    'generate_prompts',
    'generate_images',
    'consistency_check',
    'continuity_check',
    'plan_scene_grammar',
    'plan_director_packs',
  ]),
  video: new Set([
    'plan_motion',
    'plan_performance',
    'route_video_shots',
    'preflight_qa',
    'generate_video_clips',
    'enhance_video_clips',
    'shot_qa',
    'plan_bridge_shots',
    'route_bridge_shots',
    'generate_bridge_clips',
    'bridge_qa',
    'plan_action_sequences',
    'route_action_sequences',
    'generate_sequence_clips',
    'sequence_qa',
  ]),
  delivery: new Set([
    'normalize_dialogue',
    'generate_audio',
    'tts_qa',
    'lipsync',
    'compose_video',
  ]),
};

const stageFlowConfig = {
  preproduction: [
    { step: 'build_character_registry', label: '角色档案' },
    { step: 'generate_character_ref_sheets', label: '三视图' },
    { step: 'generate_prompts', label: 'Prompt' },
    { step: 'generate_images', label: '出图' },
    { step: 'consistency_check', label: '一致性' },
    { step: 'continuity_check', label: '连续性' },
  ],
  video: [
    { step: 'plan_motion', label: '运镜' },
    { step: 'plan_performance', label: '表演' },
    { step: 'route_video_shots', label: '路由' },
    { step: 'generate_video_clips', label: '视频生成' },
    { step: 'shot_qa', label: '镜头QA' },
    { step: 'sequence_qa', label: '动作段QA' },
  ],
  delivery: [
    { step: 'normalize_dialogue', label: '对白' },
    { step: 'generate_audio', label: '配音' },
    { step: 'tts_qa', label: '音频QA' },
    { step: 'lipsync', label: '口型' },
    { step: 'compose_video', label: '合成' },
  ],
};

function parseDate(value) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
}

function normalizeRunStatus(runJob, qaOverview) {
  const status = String(runJob?.status || '').toLowerCase();
  if (qaOverview?.blockCount > 0) return 'block';
  if (qaOverview?.warnCount > 0) return 'warn';
  if (status === 'completed') return 'pass';
  if (status === 'failed' || status === 'error' || status === 'blocked') return 'block';
  return 'running';
}

function normalizeTaskStatus(value) {
  const status = String(value || '').toLowerCase();
  if (['completed', 'pass', 'passed', 'cached', 'skipped'].includes(status)) return 'pass';
  if (['warn', 'warning'].includes(status)) return 'warn';
  if (['failed', 'error', 'blocked', 'block'].includes(status)) return 'block';
  return 'running';
}

function humanStatusLabel(statusClass) {
  if (statusClass === 'pass') return '已完成';
  if (statusClass === 'warn') return '有提醒';
  if (statusClass === 'block') return '已阻断';
  return '运行中';
}

function scoreRunJob(runJob, qaOverview) {
  let score = 0;
  const title = `${runJob.scriptTitle || ''} ${runJob.episodeTitle || ''}`.toLowerCase();

  score += (runJob.agentTaskRuns || []).length;
  if (qaOverview.agentSummaries?.length) score += 10;
  if (qaOverview.releasable) score += 6;
  if (title.includes('demo')) score -= 12;
  if (title.includes('legacy')) score -= 8;
  if (runJob.projectId?.startsWith('legacy_')) score -= 8;
  if ((runJob.artifactRunDir || '').includes('legacy_project')) score -= 6;
  return score;
}

function buildStageItems(runJob, qaOverview) {
  const grouped = {
    preproduction: [],
    video: [],
    delivery: [],
  };

  for (const task of runJob.agentTaskRuns || []) {
    const stageKey = Object.entries(stageConfig).find(([, steps]) => steps.has(task.step))?.[0];
    if (!stageKey) continue;

    const taskStatus = task.error ? 'block' : normalizeTaskStatus(task.status);
    grouped[stageKey].push({
      stepLabel: task.step,
      title: task.detail || task.step,
      summary:
        task.error ||
        (taskStatus === 'pass'
          ? '该步骤已经写入运行产物，可继续查看下游阶段。'
          : '当前步骤仍在执行中。'),
      status: taskStatus,
      agent: task.agent || 'director',
      startedAt: task.startedAt || null,
      finishedAt: task.finishedAt || null,
      primaryAction:
        stageKey === 'video'
          ? '查看路由与结果'
          : stageKey === 'delivery'
            ? '查看交付证据'
            : '查看阶段产物',
      secondaryAction: qaOverview?.releasable ? '查看 QA 摘要' : '查看运行包',
      meta: [
        {
          type: task.error ? 'block' : taskStatus === 'warn' ? 'warn' : 'success',
          label:
            task.error
              ? '执行异常'
              : taskStatus === 'pass'
                ? '已落盘'
                : taskStatus === 'warn'
                  ? '有提醒'
                  : '执行中',
        },
        {
          type: 'info',
          label: task.agent || 'director',
        },
      ],
    });
  }

  for (const stage of Object.values(grouped)) {
    stage.sort((a, b) => parseDate(b.finishedAt || b.startedAt) - parseDate(a.finishedAt || a.startedAt));
  }

  return grouped;
}

function buildStageProgress(stageKey, items) {
  const config = stageFlowConfig[stageKey] || [];
  const itemByStep = new Map(items.map((item) => [item.stepLabel, item]));
  const flow = config.map((entry) => {
    const item = itemByStep.get(entry.step);
    return {
      label: entry.label,
      status: item ? item.status : 'pending',
    };
  });

  const completedCount = flow.filter((item) => item.status === 'pass').length;
  return {
    flow,
    summary: flow.map((item) => item.label).join(' -> '),
    completedCount,
    totalCount: flow.length,
  };
}

function buildCurrentAction(runJob, qaOverview) {
  if (qaOverview?.blockCount > 0) {
    return {
      coachTitle: '先处理阻断项，再决定是否继续续跑',
      coachSummary: qaOverview.summary || '本轮 run 存在阻断问题，建议先看 QA 证据和失败步骤。',
      primaryAction: '查看阻断项',
      focusTitle: '当前有阻断项',
      focusSummary: '优先处理 block agent，再进入下一轮视频或音频阶段。',
      riskSummary: `当前风险：${qaOverview.blockCount} 个阻断项`,
    };
  }

  if (qaOverview?.warnCount > 0) {
    return {
      coachTitle: '先复核提醒项，再决定是否直接交付',
      coachSummary: qaOverview.summary || '本轮 run 基本完成，但还有提醒项值得看一眼。',
      primaryAction: '查看提醒项',
      focusTitle: '当前以提醒项为主',
      focusSummary: '建议优先看连续性、sequence 覆盖和人工复核清单。',
      riskSummary: `当前风险：${qaOverview.warnCount} 个提醒项`,
    };
  }

  if (String(runJob.status || '').toLowerCase() === 'completed') {
    return {
      coachTitle: '这轮运行已完成，可以复看产物或继续下一轮',
      coachSummary: qaOverview?.summary || '当前 run 没有明显阻断问题，适合继续比较不同 provider 或不同配置结果。',
      primaryAction: '查看交付产物',
      focusTitle: '当前 run 可继续复用',
      focusSummary: '可以直接查看 `qa-overview`、运行包和后续交付结果。',
      riskSummary: '当前风险：没有明显阻断',
    };
  }

  return {
    coachTitle: '当前运行还在进行中',
    coachSummary: '如果你需要观察进度或续跑入口，工作台会直接读取本地产物目录。',
    primaryAction: '刷新运行状态',
    focusTitle: '当前 run 仍在执行',
    focusSummary: '建议优先关注视频链和交付阶段是否开始写出证据。',
    riskSummary: '当前风险：运行未结束',
  };
}

function buildRecentRuns(runJobs, qaOverviewsByRunId) {
  return runJobs.slice(0, 6).map((runJob) => {
    const qaOverview = qaOverviewsByRunId[runJob.id] || {};
    const statusClass = normalizeRunStatus(runJob, qaOverview);
    return {
      id: runJob.id,
      displayTitle: `${runJob.scriptTitle || '未命名脚本'} / ${runJob.episodeTitle || runJob.episodeId || '未命名分集'}`,
      subtitle: `${runJob.projectId} · ${humanStatusLabel(statusClass)} · ${new Date(runJob.startedAt).toLocaleDateString('zh-CN')}`,
      headline: qaOverview.headline || runJob.error || '当前 run 没有额外摘要。',
      statusClass,
      statusLabel: humanStatusLabel(statusClass),
    };
  });
}

export function buildWorkbenchViewModel({
  runJobs = [],
  qaOverviewsByRunId = {},
  artifactSummariesByRunId = {},
}) {
  const projects = new Set(runJobs.map((item) => item.projectId));
  const episodes = new Set(runJobs.map((item) => `${item.projectId}/${item.scriptId}/${item.episodeId}`));
  const runJobsWithQa = runJobs.map((runJob) => ({
    runJob,
    qaOverview: qaOverviewsByRunId[runJob.id] || {
      status: 'running',
      releasable: false,
      passCount: 0,
      warnCount: 0,
      blockCount: 0,
      agentSummaries: [],
    },
  }));

  const currentRunCandidate = [...runJobsWithQa].sort(
    (a, b) => scoreRunJob(b.runJob, b.qaOverview) - scoreRunJob(a.runJob, a.qaOverview)
  )[0];
  const currentRun = currentRunCandidate?.runJob || null;

  if (!currentRun) {
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        projectCount: 0,
        episodeCount: 0,
        runCount: 0,
        passCount: 0,
        blockCount: 0,
      },
      currentRun: {
        displayTitle: '暂无运行数据',
        sidebarSummary: '还没有从 temp/projects 中发现 run-jobs。',
        progressPercent: 0,
        coachTitle: '还没有可联调的运行数据',
        coachSummary: '先跑一轮 CLI 流水线，工作台再来读真实产物。',
        primaryAction: '等待运行数据',
        focusTitle: '暂无当前运行',
        focusSummary: '目前没有 run-jobs 可供展示。',
        riskSummary: '暂无 QA 风险',
        durationSec: 0,
        qaOverview: {
          status: 'running',
          releasable: false,
          agentSummaries: [],
        },
        stages: {
          preproduction: { items: [] },
          video: { items: [] },
          delivery: { items: [] },
        },
        artifactSummary: {
          agentDirs: [],
          outputFiles: [],
        },
      },
      recentRuns: [],
    };
  }

  const qaOverview = currentRunCandidate.qaOverview;
  const currentAction = buildCurrentAction(currentRun, qaOverview);
  const stages = buildStageItems(currentRun, qaOverview);
  const stageProgress = {
    preproduction: buildStageProgress('preproduction', stages.preproduction),
    video: buildStageProgress('video', stages.video),
    delivery: buildStageProgress('delivery', stages.delivery),
  };
  const durationSec = Math.max(0, Math.round((parseDate(currentRun.finishedAt) - parseDate(currentRun.startedAt)) / 1000));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      projectCount: projects.size,
      episodeCount: episodes.size,
      runCount: runJobs.length,
      passCount: Number(qaOverview.passCount || 0),
      blockCount: Number(qaOverview.blockCount || 0),
    },
    currentRun: {
      id: currentRun.id,
      displayTitle: `${currentRun.scriptTitle || '未命名脚本'} / ${currentRun.episodeTitle || currentRun.episodeId || '未命名分集'}`,
      sidebarSummary: `${currentRun.projectId} · ${humanStatusLabel(normalizeRunStatus(currentRun, qaOverview))} · ${currentRun.artifactRunDir || ''}`,
      progressPercent: Math.min(100, Math.max(8, Math.round(((currentRun.agentTaskRuns || []).length / 27) * 100))),
      durationSec,
      qaOverview,
      stages: {
        preproduction: { items: stages.preproduction, progress: stageProgress.preproduction },
        video: { items: stages.video, progress: stageProgress.video },
        delivery: { items: stages.delivery, progress: stageProgress.delivery },
      },
      artifactSummary: artifactSummariesByRunId[currentRun.id] || {
        agentDirs: [],
        outputFiles: [],
      },
      ...currentAction,
    },
    recentRuns: buildRecentRuns(runJobs, qaOverviewsByRunId),
  };
}

export default {
  buildWorkbenchViewModel,
};
