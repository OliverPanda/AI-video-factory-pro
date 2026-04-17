import fs from 'node:fs';
import path from 'node:path';

import { ensureDir, saveJSON } from '../utils/fileHelper.js';
import { writeAgentQaSummary } from '../utils/qaSummary.js';

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

const ISSUE_GUIDANCE = {
  missing_scene_pack: {
    label: '场景目标缺失',
    suggestion: '先把这个分镜要讲清楚的戏剧动作写明：谁压制谁、这一镜想让观众看懂什么。',
  },
  missing_reference_stack: {
    label: '参考栈缺失',
    suggestion: '补角色参考图、场景参考图或上一镜承接图，不要让模型盲猜人物和空间。',
  },
  entry_state_missing: {
    label: '入镜状态缺失',
    suggestion: '补这一镜开头时的人物站位、朝向、动作起点，让镜头从可读状态开始。',
  },
  exit_state_missing: {
    label: '出镜状态缺失',
    suggestion: '补这一镜结尾的动作落点和画面停留状态，保证能顺着接下一镜。',
  },
  coverage_role_missing: {
    label: '机位职责不清',
    suggestion: '说明这是交代空间、推进情绪还是盯动作结果的镜头，别让镜头功能含糊。',
  },
  blocking_missing: {
    label: '调度缺失',
    suggestion: '把前中后景站位、人物相对位置和移动路径写出来，先保空间可读再谈运动。',
  },
  continuity_locks_missing: {
    label: '连贯锁缺失',
    suggestion: '补朝向、轴线、空间方位和人物身份锁，避免下一镜接不上。',
  },
  missing_director_pack: {
    label: '导演意图缺失',
    suggestion: '补镜头情绪、摄影策略和写实约束，告诉模型这镜到底要克制、压迫还是观察。',
  },
};

const ISSUE_OWNER_MAP = {
  missing_scene_pack: ['sceneGrammarAgent'],
  missing_reference_stack: ['sceneGrammarAgent', 'seedancePromptAgent'],
  entry_state_missing: ['sceneGrammarAgent', 'directorPackAgent'],
  exit_state_missing: ['sceneGrammarAgent', 'directorPackAgent'],
  coverage_role_missing: ['directorPackAgent'],
  blocking_missing: ['directorPackAgent'],
  continuity_locks_missing: ['directorPackAgent', 'seedancePromptAgent'],
  missing_director_pack: ['directorPackAgent'],
};

const OWNER_LABELS = {
  sceneGrammarAgent: 'Scene Grammar Agent',
  directorPackAgent: 'Director Pack Agent',
  seedancePromptAgent: 'Seedance Prompt Agent',
};

function buildReasonDetails(reasons = []) {
  return normalizeStringArray(reasons).map((reason) => ({
    code: reason,
    label: ISSUE_GUIDANCE[reason]?.label || reason,
    suggestion: ISSUE_GUIDANCE[reason]?.suggestion || '补足这个镜头的关键叙事与镜头约束后再生成。',
  }));
}

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function buildFixBriefEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.decision === 'block' || entry?.decision === 'warn')
    .map((entry) => {
      const owners = [
        ...new Set(
          normalizeStringArray(entry?.reasons).flatMap((reason) => ISSUE_OWNER_MAP[reason] || [])
        ),
      ];
      const reasonDetails = Array.isArray(entry?.reasonDetails) ? entry.reasonDetails : [];

      return {
        shotId: entry?.shotId || 'unknown_shot',
        decision: entry?.decision || 'warn',
        priority: entry?.decision === 'block' ? 'P0' : 'P1',
        issueCodes: normalizeStringArray(entry?.reasons),
        labels: reasonDetails.map((item) => item.label),
        suggestions: reasonDetails.map((item) => item.suggestion),
        ownerAgents: owners,
        ownerAgentLabels: owners.map((owner) => OWNER_LABELS[owner] || owner),
        ownerSummary: owners.length > 0 ? owners.map((owner) => OWNER_LABELS[owner] || owner).join(', ') : 'unknown',
      };
    });
}

function buildRepairPromptBlocks(reasonDetails = []) {
  const labels = (Array.isArray(reasonDetails) ? reasonDetails : [])
    .map((item) => String(item?.label || '').trim())
    .filter(Boolean);
  const suggestions = (Array.isArray(reasonDetails) ? reasonDetails : [])
    .map((item) => String(item?.suggestion || '').trim())
    .filter(Boolean);

  if (labels.length === 0 && suggestions.length === 0) {
    return [];
  }

  return [
    {
      key: 'repair_brief',
      text: `fix before motion escalation: ${labels.join(', ') || 'readability anchors'}`,
    },
    {
      key: 'repair_directives',
      text: suggestions.join(' ; '),
    },
    {
      key: 'story_coherence_guard',
      text: 'keep one readable dramatic action, one stable geography, and one clear exit handoff; prefer clarity over spectacle',
    },
  ].filter((block) => block.text);
}

function buildScores(shotPackage = {}) {
  const promptBlocks = Array.isArray(shotPackage.seedancePromptBlocks) ? shotPackage.seedancePromptBlocks : [];
  const qualityIssues = normalizeStringArray(shotPackage.qualityIssues);
  const hasEntryExit = promptBlocks.some((block) => block?.key === 'entry_exit');
  const hasContinuityLocks = promptBlocks.some((block) => block?.key === 'continuity_locks');
  const hasBlocking = promptBlocks.some((block) => block?.key === 'blocking' && String(block?.text || '').trim());
  const hasIntent = promptBlocks.some((block) => block?.key === 'cinematic_intent' && String(block?.text || '').trim());
  const hasReference = Array.isArray(shotPackage?.generationPack?.reference_stack) && shotPackage.generationPack.reference_stack.length > 0;

  return {
    narrative_clarity_score: hasEntryExit ? 90 : 45,
    spatial_readability_score: hasBlocking && hasContinuityLocks ? 90 : 50,
    continuity_control_score: hasContinuityLocks && hasReference ? 92 : 40,
    cinematic_specificity_score: hasIntent && promptBlocks.length >= 5 ? 88 : 48,
    issue_penalty: qualityIssues.length * 8,
  };
}

function inferDecision(scores, shotPackage = {}) {
  const qualityIssues = normalizeStringArray(shotPackage.qualityIssues);
  const hardBlock = qualityIssues.some((issue) =>
    ['missing_scene_pack', 'missing_reference_stack', 'entry_state_missing', 'exit_state_missing'].includes(issue)
  );
  if (hardBlock) {
    return 'block';
  }

  const weakCoverage = qualityIssues.some((issue) =>
    ['coverage_role_missing', 'blocking_missing', 'continuity_locks_missing', 'missing_director_pack'].includes(issue)
  );
  if (weakCoverage) {
    return 'warn';
  }

  const minScore = Math.min(
    scores.narrative_clarity_score,
    scores.spatial_readability_score,
    scores.continuity_control_score,
    scores.cinematic_specificity_score
  );
  if (minScore < 55) {
    return 'block';
  }
  if (minScore < 80) {
    return 'warn';
  }
  return 'pass';
}

function rewriteWarnPackage(shotPackage = {}) {
  const promptBlocks = Array.isArray(shotPackage.seedancePromptBlocks) ? [...shotPackage.seedancePromptBlocks] : [];
  const reasonDetails = buildReasonDetails(shotPackage.qualityIssues);
  const fixBriefEntries = buildFixBriefEntries([
    {
      shotId: shotPackage?.shotId || 'unknown_shot',
      decision: 'warn',
      reasons: shotPackage?.qualityIssues || [],
      reasonDetails,
    },
  ]);
  const repairPromptBlocks = buildRepairPromptBlocks(reasonDetails);
  const hasContinuity = promptBlocks.some((block) => block?.key === 'continuity_locks');
  const hasNegativeRules = promptBlocks.some((block) => block?.key === 'negative_rules');
  const hasRepairBrief = promptBlocks.some((block) => block?.key === 'repair_brief');

  if (!hasContinuity) {
    promptBlocks.push({
      key: 'continuity_locks',
      text: 'preserve geography, preserve facing direction, keep entry and exit readable',
    });
  }
  if (!hasNegativeRules) {
    promptBlocks.push({
      key: 'negative_rules',
      text: 'avoid axis break, avoid identity drift, avoid overactive camera',
    });
  }

  promptBlocks.push({
    key: 'preflight_rewrite',
    text: 'favor restrained camera, simplify motion, and prioritize spatial readability over spectacle',
  });
  if (!hasRepairBrief) {
    promptBlocks.push(...repairPromptBlocks);
  }

  const generationPack = shotPackage?.generationPack && typeof shotPackage.generationPack === 'object'
    ? {
        ...shotPackage.generationPack,
        camera_plan: {
          ...(shotPackage.generationPack.camera_plan || {}),
          coverage_role: shotPackage?.generationPack?.camera_plan?.coverage_role || 'anchor_readable_coverage',
        },
        actor_blocking: Array.isArray(shotPackage?.generationPack?.actor_blocking) && shotPackage.generationPack.actor_blocking.length > 0
          ? shotPackage.generationPack.actor_blocking
          : ['lead subject readable in foreground', 'counter subject readable in midground', 'clear screen path'],
        negative_rules: Array.from(
          new Set([
            ...normalizeStringArray(shotPackage?.generationPack?.negative_rules),
            'axis break',
            'identity drift',
            'overactive camera',
            'unclear staging',
          ])
        ),
        quality_target: shotPackage?.generationPack?.quality_target || 'narrative_clarity',
      }
    : shotPackage?.generationPack;

  return {
    ...shotPackage,
    generationPack,
    seedancePromptBlocks: promptBlocks,
    providerRequestHints: {
      ...shotPackage.providerRequestHints,
      preflightRewriteApplied: true,
      preflightOwnerAgents: fixBriefEntries[0]?.ownerAgents || [],
      preflightFixLabels: fixBriefEntries[0]?.labels || [],
      preflightRepairDirectives: fixBriefEntries[0]?.suggestions || [],
      preflightFixBrief: fixBriefEntries[0] || null,
    },
  };
}

export function evaluateShotPackage(shotPackage = {}) {
  const scores = buildScores(shotPackage);
  const decision = inferDecision(scores, shotPackage);
  const reasons = normalizeStringArray(shotPackage.qualityIssues);
  const reasonDetails = buildReasonDetails(reasons);

  let reviewedPackage = { ...shotPackage };
  if (decision === 'warn') {
    reviewedPackage = rewriteWarnPackage(reviewedPackage);
  }
  if (decision === 'block') {
    reviewedPackage = {
      ...reviewedPackage,
      preferredProvider: 'static_image',
      fallbackProviders: [],
      providerRequestHints: {
        ...reviewedPackage.providerRequestHints,
        preflightBlocked: true,
      },
    };
  }

  return {
    shotId: shotPackage.shotId,
    decision,
    scores,
    reasons,
    reasonDetails,
    reviewedPackage: {
      ...reviewedPackage,
      preflightDecision: decision,
      preflightReasons: reasons,
      preflightReasonDetails: reasonDetails,
      preflightScores: scores,
    },
  };
}

function buildReport(entries = []) {
  return {
    status: entries.some((entry) => entry.decision === 'block')
      ? 'warn'
      : (entries.some((entry) => entry.decision === 'warn') ? 'warn' : 'pass'),
    passCount: entries.filter((entry) => entry.decision === 'pass').length,
    warnCount: entries.filter((entry) => entry.decision === 'warn').length,
    blockCount: entries.filter((entry) => entry.decision === 'block').length,
    entries,
  };
}

function writeArtifacts(report, reviewedPackages, artifactContext) {
  if (!artifactContext) {
    return;
  }

  const fixBrief = {
    generatedAt: new Date().toISOString(),
    blockCount: report.blockCount,
    warnCount: report.warnCount,
    entries: buildFixBriefEntries(report.entries),
  };

  saveJSON(path.join(artifactContext.outputsDir, 'preflight-reviewed-packages.json'), reviewedPackages);
  saveJSON(path.join(artifactContext.outputsDir, 'preflight-fix-brief.json'), fixBrief);
  saveJSON(path.join(artifactContext.metricsDir, 'preflight-report.json'), report);
  writeTextFile(
    path.join(artifactContext.outputsDir, 'preflight-fix-brief.md'),
    [
      '# Preflight Fix Brief',
      '',
      `- Block Count: ${fixBrief.blockCount}`,
      `- Warn Count: ${fixBrief.warnCount}`,
      '',
      '## Shot Actions',
      ...(fixBrief.entries.length > 0
        ? fixBrief.entries.flatMap((entry) => [
            `### ${entry.shotId} [${entry.priority}] ${entry.decision}`,
            `- Owners: ${entry.ownerAgentLabels.length > 0 ? entry.ownerAgentLabels.join(', ') : 'unknown'}`,
            `- Labels: ${entry.labels.length > 0 ? entry.labels.join('；') : '无'}`,
            `- Suggestions: ${entry.suggestions.length > 0 ? entry.suggestions.join('；') : '无'}`,
            '',
          ])
        : ['- 无', '']),
    ].join('\n')
  );
  saveJSON(artifactContext.manifestPath, {
    status: report.blockCount > 0 ? 'completed_with_warnings' : 'completed',
    passCount: report.passCount,
    warnCount: report.warnCount,
    blockCount: report.blockCount,
    outputFiles: [
      'preflight-reviewed-packages.json',
      'preflight-fix-brief.json',
      'preflight-fix-brief.md',
      'preflight-report.json',
    ],
  });
  writeAgentQaSummary(
    {
      agentKey: 'preflightQaAgent',
      agentName: 'Preflight QA Agent',
      status: report.blockCount > 0 ? 'warn' : (report.warnCount > 0 ? 'warn' : 'pass'),
      headline:
        report.blockCount > 0
          ? `生成前拦下 ${report.blockCount} 个动态镜头，另有 ${report.warnCount} 个已自动收紧`
          : report.warnCount > 0
            ? `生成前收紧 ${report.warnCount} 个镜头输入`
            : '所有镜头都通过生成前质检',
      summary: '在调用视频 provider 前检查叙事清晰度、空间可读性、连贯性控制和电影化具体度。',
      passItems: [`通过镜头数：${report.passCount}`],
      warnItems: [
        report.warnCount > 0 ? `自动收紧镜头数：${report.warnCount}` : '',
        report.blockCount > 0 ? `阻止生成镜头数：${report.blockCount}` : '',
      ].filter(Boolean),
      blockItems: report.entries
        .filter((entry) => entry.decision === 'block')
        .slice(0, 3)
        .map((entry) => {
          const firstSuggestion = buildReasonDetails(entry.reasons)[0]?.suggestion || '先补镜头基础约束再生成。';
          return `${entry.shotId}: ${firstSuggestion}`;
        }),
      nextAction: '仅将 pass/warn 后的镜头送入动态生成。',
      evidenceFiles: [
        '1-outputs/preflight-reviewed-packages.json',
        '1-outputs/preflight-fix-brief.json',
        '1-outputs/preflight-fix-brief.md',
        '2-metrics/preflight-report.json',
      ],
      metrics: {
        passCount: report.passCount,
        warnCount: report.warnCount,
        blockCount: report.blockCount,
        fixBriefCount: fixBrief.entries.length,
      },
    },
    artifactContext
  );
}

export async function runPreflightQa(shotPackages = [], options = {}) {
  const entries = (Array.isArray(shotPackages) ? shotPackages : []).map((shotPackage) => evaluateShotPackage(shotPackage));
  const reviewedPackages = entries.map((entry) => entry.reviewedPackage);
  const report = buildReport(entries.map((entry) => ({
    shotId: entry.shotId,
    decision: entry.decision,
    reasons: entry.reasons,
    reasonDetails: entry.reasonDetails,
    scores: entry.scores,
  })));

  writeArtifacts(report, reviewedPackages, options.artifactContext);
  return {
    reviewedPackages,
    report,
  };
}

export const __testables = {
  buildReport,
  buildScores,
  evaluateShotPackage,
  buildReasonDetails,
  buildFixBriefEntries,
  inferDecision,
  rewriteWarnPackage,
};
