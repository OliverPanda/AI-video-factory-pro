import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Box,
  Boxes,
  ChevronRight,
  Clapperboard,
  Clock3,
  Cpu,
  FileStack,
  Film,
  FolderKanban,
  FolderOpen,
  Image,
  LayoutDashboard,
  LayoutGrid,
  ListFilter,
  MicVocal,
  PackageCheck,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
  WandSparkles,
} from 'lucide-react';

import {
  fetchCharacterAssets,
  fetchEpisode,
  fetchProject,
  fetchProjects,
  fetchProviderSettings,
  fetchRun,
  fetchRunArtifacts,
  fetchRunQa,
  fetchRuns,
  fetchVideoAssets,
  fetchWorkbench,
} from './api.js';
import { formatDateTime, formatDuration, statusClass, statusLabel } from './format.js';

const navPrimary = [
  { key: 'overview', icon: LayoutDashboard, label: '运行总览' },
  { key: 'projects', icon: FolderKanban, label: '项目' },
  { key: 'video-library', icon: Film, label: '成片' },
  { key: 'character-assets', icon: UsersRound, label: '角色资产' },
  { key: 'settings', icon: Settings2, label: '配置' },
];

const navSecondary = [
  { key: 'run-logs', icon: RotateCcw, label: '运行日志' },
  { key: 'qa-evidence', icon: ShieldCheck, label: 'QA 证据' },
  { key: 'run-artifacts', icon: Box, label: '运行包' },
];

const stageCards = {
  preproduction: {
    icon: BookOpen,
    title: '预生产',
    description: '剧本、角色、Prompt、分镜图、一致性与连续性',
    columnTitle: '预生产阶段',
  },
  video: {
    icon: Clapperboard,
    title: '视频链',
    description: '运镜、路由、动态镜头、桥接、动作段与镜头 QA',
    columnTitle: '视频阶段',
    tone: 'video',
  },
  delivery: {
    icon: MicVocal,
    title: '音频与交付',
    description: '对白标准化、配音、口型、合成与最终放行',
    columnTitle: '交付阶段',
    tone: 'audio',
  },
};

const pageMeta = {
  overview: { label: '运行总览' },
  projects: { label: '项目列表' },
  'project-detail': { label: '项目详情' },
  'run-logs': { label: '运行日志' },
  'qa-evidence': { label: 'QA 证据' },
  'run-artifacts': { label: '运行包' },
  'character-assets': { label: '角色资产' },
  'video-library': { label: '成片库' },
  settings: { label: '配置中心' },
};

const compactFlowLabelMap = {
  '角色档案': '档案',
  '三视图': '三视图',
  Prompt: 'Prompt',
  '出图': '出图',
  '一致性': '一致',
  '连续性': '连贯',
  '运镜': '运镜',
  '表演': '表演',
  '路由': '路由',
  '视频生成': '生成',
  '镜头QA': '镜头QA',
  '动作段QA': '动作QA',
  '对白': '对白',
  '配音': '配音',
  '音频QA': '音频QA',
  '口型': '口型',
  '合成': '合成',
};

const compactStageDescriptionMap = {
  preproduction: '剧本 / 角色 / Prompt / 分镜 / 质检',
  video: '运镜 / 表演 / 路由 / 生成 / QA',
  delivery: '对白 / 配音 / 口型 / 合成 / 放行',
};

function getStageSnapshot(stage) {
  const items = stage?.items || [];
  if (!items.length) {
    return {
      current: '暂无任务',
      next: '等待新运行',
      risk: '无提醒',
    };
  }

  const activeItem =
    items.find((item) => item.status === 'block') ||
    items.find((item) => item.status === 'warn') ||
    items.find((item) => item.status === 'running') ||
    items[0];
  const activeIndex = items.indexOf(activeItem);
  const nextItem = items[activeIndex + 1] || null;

  return {
    current: activeItem?.title || activeItem?.stepLabel || '当前步骤',
    next: nextItem?.title || nextItem?.stepLabel || '查看当前阶段详情',
    risk:
      activeItem?.status === 'block'
        ? '存在阻断'
        : activeItem?.status === 'warn'
          ? '存在提醒'
          : '进度正常',
  };
}

function toRunItemsFromWorkbench(workbench) {
  if (!workbench?.currentRun?.stages) return [];

  return Object.entries(workbench.currentRun.stages).flatMap(([stageKey, stage]) =>
    (stage.items || []).map((item, index) => ({
      id: item.id || `${workbench.currentRun.id}-${stageKey}-${item.stepLabel || index}`,
      runId: workbench.currentRun.id,
      projectId: workbench.currentRun.projectId || 'local-project',
      scriptId: workbench.currentRun.scriptId || 'script-001',
      scriptTitle: workbench.currentRun.scriptTitle || workbench.currentRun.displayTitle?.split(' / ')[0] || '当前脚本',
      episodeId: workbench.currentRun.episodeId || 'episode-001',
      episodeTitle: workbench.currentRun.episodeTitle || workbench.currentRun.displayTitle?.split(' / ')[1] || '当前分集',
      stageKey,
      stepLabel: item.stepLabel || item.title || `step-${index + 1}`,
      title: item.title || item.stepLabel || '未命名步骤',
      headline: item.summary || item.description || '当前步骤已写入运行产物，可继续查看上下游信息。',
      summary: item.summary || item.description || '当前步骤已写入运行产物，可继续查看上下游信息。',
      agent: item.agent || item.owner || 'director',
      status: item.status || 'pass',
      startedAt: item.startedAt || workbench.generatedAt,
      finishedAt: item.finishedAt || workbench.generatedAt,
      meta: item.meta || [],
      primaryAction: item.primaryAction,
      secondaryAction: item.secondaryAction,
    }))
  );
}

function buildFallbackRun(workbench) {
  if (!workbench?.currentRun) return null;

  return {
    id: workbench.currentRun.id || 'current-run',
    runId: workbench.currentRun.id || 'current-run',
    projectId: workbench.currentRun.projectId || 'local-project',
    scriptId: workbench.currentRun.scriptId || 'script-001',
    scriptTitle: workbench.currentRun.scriptTitle || workbench.currentRun.displayTitle?.split(' / ')[0] || '当前脚本',
    episodeId: workbench.currentRun.episodeId || 'episode-001',
    episodeTitle: workbench.currentRun.episodeTitle || workbench.currentRun.displayTitle?.split(' / ')[1] || '当前分集',
    stageKey: 'overview',
    stepLabel: 'current_run',
    title: workbench.currentRun.displayTitle || '当前运行',
    headline: workbench.currentRun.coachSummary || '当前运行已接入工作台。',
    summary: workbench.currentRun.coachSummary || '当前运行已接入工作台。',
    agent: 'director',
    status: workbench.currentRun.riskSummary?.includes('阻断')
      ? 'block'
      : workbench.currentRun.riskSummary?.includes('提醒') || workbench.currentRun.riskSummary?.includes('风险')
        ? 'warn'
        : 'pass',
    startedAt: workbench.generatedAt,
    finishedAt: workbench.generatedAt,
    meta: [{ type: 'info', label: 'fallback-run' }],
  };
}

function buildFallbackRuns(workbench) {
  const fallbackRun = buildFallbackRun(workbench);
  return fallbackRun ? [fallbackRun] : [];
}

function buildFallbackProject(workbench) {
  const runs = buildFallbackRuns(workbench);
  const scriptTitle = runs[0]?.scriptTitle || '当前脚本';
  const episodeTitle = runs[0]?.episodeTitle || '当前分集';
  const projectTitle = workbench?.currentRun?.projectTitle || scriptTitle;

  return {
    id: workbench?.currentRun?.projectId || 'local-project',
    title: projectTitle,
    runCount: runs.length,
    scriptCount: 1,
    episodeCount: 1,
    latestRunId: runs[0]?.id || null,
    currentOnly: true,
    scripts: [
      {
        id: runs[0]?.scriptId || 'script-001',
        title: scriptTitle,
        episodes: [
          {
            id: runs[0]?.episodeId || 'episode-001',
            title: episodeTitle,
            runs,
          },
        ],
      },
    ],
  };
}

function buildFallbackQaDetail(workbench, run) {
  const sourceItems = toRunItemsFromWorkbench(workbench).filter((item) => !run || item.runId === run.id);
  const passCount = sourceItems.filter((item) => item.status === 'pass').length;
  const warnCount = sourceItems.filter((item) => item.status === 'warn').length;
  const blockCount = sourceItems.filter((item) => item.status === 'block').length;

  return {
    headline: run?.headline || workbench?.currentRun?.coachTitle || '当前 QA 已聚合',
    summary: workbench?.currentRun?.focusSummary || '当前以已落盘产物为主，适合继续人工复核。',
    releasable: blockCount === 0,
    passCount,
    warnCount,
    blockCount,
    topIssues: blockCount
      ? ['存在阻断项，建议先回到运行日志排查。']
      : warnCount
        ? ['存在提醒项，建议优先复核连续性和交付质量。']
        : ['暂无阻断项，可继续查看交付产物。'],
    agentSummaries: sourceItems.slice(0, 12).map((item) => ({
      agentName: item.agent || item.stepLabel,
      status: item.status,
      headline: item.title,
      summary: item.summary,
    })),
  };
}

function buildFallbackArtifactDetail(workbench, run) {
  const sourceItems = toRunItemsFromWorkbench(workbench).filter((item) => !run || item.runId === run.id);
  return {
    runDir: `temp/runs/${run?.id || workbench?.currentRun?.id || 'current-run'}`,
    agentDirs: [...new Set(sourceItems.map((item) => item.agent || 'director'))],
    outputFiles: [],
    currentOnly: true,
  };
}

function buildFallbackCharacterAssets(workbench) {
  const sourceItems = toRunItemsFromWorkbench(workbench).filter((item) =>
    ['build_character_registry', 'generate_character_ref_sheets', 'generate_prompts', 'generate_images'].includes(item.stepLabel)
  );
  const items = sourceItems.length ? sourceItems : toRunItemsFromWorkbench(workbench).slice(0, 4);

  return items.map((item, index) => ({
    id: `character-asset-${index + 1}`,
    title: item.title,
    summary: item.summary,
    sourceLabel: item.agent || 'director',
  }));
}

function buildFallbackVideoAssets(workbench) {
  const sourceItems = toRunItemsFromWorkbench(workbench).filter((item) =>
    ['generate_video_clips', 'enhance_video_clips', 'compose_video', 'lipsync'].includes(item.stepLabel)
  );
  const items = sourceItems.length ? sourceItems : toRunItemsFromWorkbench(workbench).slice(-4);

  return items.map((item, index) => ({
    id: item.id || `video-asset-${index + 1}`,
    title: item.title,
    artifactRunDir: `temp/runs/${item.runId || workbench?.currentRun?.id || 'current-run'}`,
    status: item.status || 'pass',
  }));
}

function buildFallbackSettings() {
  return {
    mode: 'workbench-readonly',
    workbenchApiBase: '/api/workbench',
    frontendDevServer: 'http://127.0.0.1:5174',
    note: '当前以前端降级聚合模式承接多页面联调。',
  };
}

function getInitialPage() {
  return window.location.hash.replace('#', '') || 'overview';
}

function createPageStore() {
  return {
    projects: [],
    selectedProject: null,
    selectedEpisode: null,
    runs: [],
    selectedRun: null,
    selectedRunQa: null,
    selectedRunArtifacts: null,
    characterAssets: [],
    selectedCharacterAsset: null,
    videoAssets: [],
    selectedVideoAsset: null,
    settings: null,
    selectedSettingItem: null,
  };
}

function EmptyState({ title, message }) {
  return (
    <div className="empty-state">
      <Box size={40} />
      <div>
        <strong>{title}</strong>
        <div>{message}</div>
      </div>
    </div>
  );
}

function Breadcrumbs({ label }) {
  return (
    <div className="breadcrumbs">
      <span>工作台</span>
      <ChevronRight size={14} />
      <span>{label}</span>
    </div>
  );
}

function ContextBar({ currentRun, generatedAt }) {
  return (
    <div className="context-bar">
      <span className="context-chip">
        <Boxes size={14} />
        {currentRun.displayTitle}
      </span>
      <span className="context-chip">
        <Clock3 size={14} />
        {formatDateTime(generatedAt)}
      </span>
      <span className="context-chip">
        <Cpu size={14} />
        {currentRun.riskSummary}
      </span>
    </div>
  );
}

function SummaryPills({ items }) {
  if (!items?.length) return null;
  return (
    <div className="summary-pills">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="summary-pill">
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function MetricGrid({ items }) {
  if (!items?.length) return null;
  return (
    <div className="metric-grid">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="metric-card">
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function OperationalBanner({ title, subtitle, tone = 'neutral', actions = [] }) {
  return (
    <div className={`operational-banner ${tone}`}>
      <div className="operational-copy">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {actions.length ? (
        <div className="operational-actions">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                className={action.primary ? 'primary-button compact-button' : 'secondary-button compact-button'}
                onClick={action.onClick}
              >
                <Icon size={16} />
                {action.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ActionStrip({ actions }) {
  if (!actions?.length) return null;
  return (
    <div className="action-strip">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            className={action.primary ? 'primary-button compact-button' : 'secondary-button compact-button'}
            onClick={action.onClick}
          >
            <Icon size={16} />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

function QuickActionGrid({ actions }) {
  if (!actions?.length) return null;
  return (
    <div className="quick-action-grid">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            className={action.primary ? 'quick-action primary' : 'quick-action'}
            onClick={action.onClick}
          >
            <div className="quick-action-icon">
              <Icon size={18} />
            </div>
            <div className="quick-action-copy">
              <strong>{action.label}</strong>
              <span>{action.description}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

function FilterBar({ value, onChange, placeholder }) {
  return (
    <label className="filter-bar">
      <Search size={16} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function StatusFilter({ value, onChange, options }) {
  return (
    <div className="status-filter">
      {options.map((option) => (
        <button
          key={option.value}
          className={`status-filter-chip${value === option.value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function FlowRow({ progress }) {
  if (!progress?.flow?.length) return null;
  return (
    <div className="stage-progress">
      {progress.flow.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flow-group">
          <span className={`flow-node ${statusClass(item.status)}`}>{compactFlowLabelMap[item.label] || item.label}</span>
          {index < progress.flow.length - 1 ? <span className="flow-arrow">-&gt;</span> : null}
        </span>
      ))}
    </div>
  );
}

function DetailList({ items, selectedId, onSelect, emptyTitle, emptyMessage }) {
  if (!items?.length) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div className="detail-list">
      {items.map((item, index) => {
        const id = item.id || `${item.title || 'item'}-${index}`;
        const selected = selectedId === id;
        return (
          <button key={id} className={`detail-card${selected ? ' selected' : ''}`} onClick={() => onSelect?.(item)}>
            <div className="detail-top">
              <strong>{item.title || item.displayTitle || '未命名项'}</strong>
              {item.status ? (
                <span className={`status-pill ${statusClass(item.statusClass || item.status)}`}>
                  {statusLabel(item.statusClass || item.status)}
                </span>
              ) : null}
            </div>
            {item.subtitle ? <p>{item.subtitle}</p> : null}
            {item.summary ? <p>{item.summary}</p> : null}
            {item.headline ? <p>{item.headline}</p> : null}
            {item.meta?.length ? (
              <div className="run-meta">
                {item.meta.map((meta, index) => (
                  <span key={`${meta.type}-${meta.label}-${index}`} className={`chip ${meta.type}`}>
                    {meta.label}
                  </span>
                ))}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function DetailInspector({ title, subtitle, description, sections = [] }) {
  return (
    <div className="inspector">
      <div className="inspector-hero">
        <strong>{title}</strong>
        {subtitle ? <p>{subtitle}</p> : null}
        {description ? <p>{description}</p> : null}
      </div>
      {sections.map((section) => (
        <section key={section.title} className="inspector-section">
          <h3>{section.title}</h3>
          {section.items?.length ? (
            <div className="inspector-items">
              {section.items.map((item, index) => (
                <div key={`${section.title}-${index}`} className="inspector-item">
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="inspector-empty">暂无数据</p>
          )}
        </section>
      ))}
    </div>
  );
}

function DataTable({ columns, rows, emptyText = '暂无数据' }) {
  if (!rows?.length) {
    return <p className="inspector-empty">{emptyText}</p>;
  }

  return (
    <div className="data-table">
      <div className="data-table-head">
        {columns.map((column) => (
          <span key={column.key}>{column.label}</span>
        ))}
      </div>
      {rows.map((row, index) => (
        <div key={`row-${index}`} className="data-table-row">
          {columns.map((column) => (
            <span key={`${column.key}-${index}`}>{row[column.key]}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function MasterDetail({ left, right }) {
  return (
    <div className="master-detail">
      <div className="master-panel panel">{left}</div>
      <div className="detail-panel panel">{right}</div>
    </div>
  );
}

function RunCard({ item, highlight, onPrimary, onSecondary }) {
  return (
    <button className={`run-card${highlight ? ' highlight' : ''}`} onClick={onPrimary}>
      <div className="run-top">
        <span>{item.stepLabel}</span>
        <span className={`status-pill ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
      </div>
      <h3>{item.title}</h3>
      <p>{item.summary}</p>
      <div className="run-meta">
        {item.meta.map((meta, index) => (
          <span key={`${meta.type}-${meta.label}-${index}`} className={`chip ${meta.type}`}>
            {meta.label}
          </span>
        ))}
      </div>
      <div className="run-footer">
        <span>{item.agent}</span>
        <span>{formatDateTime(item.finishedAt || item.startedAt)}</span>
      </div>
      <div className="run-actions">
        <span className="mini-button primary">
          <Play size={16} />
          {item.primaryAction || '查看详情'}
        </span>
        <span
          className="mini-button secondary"
          onClick={(event) => {
            event.stopPropagation();
            onSecondary?.();
          }}
        >
          <FolderOpen size={16} />
          {item.secondaryAction || '查看产物'}
        </span>
      </div>
    </button>
  );
}

function StageColumn({ stageKey, stage, onPrimary, onSecondary }) {
  const config = stageCards[stageKey];
  const Icon = config.icon;
  const snapshot = getStageSnapshot(stage);

  return (
    <div className="workflow-column">
      <div className={`stage-card${config.tone ? ` ${config.tone}` : ''}`}>
        <div className="stage-icon">
          <Icon size={22} />
        </div>
        <div className="stage-copy">
          <strong>{config.title}</strong>
          <span>{compactStageDescriptionMap[stageKey] || config.description}</span>
          <FlowRow progress={stage.progress} />
          <div className="stage-meta">
            <span>当前: {snapshot.current}</span>
            <span>下一步: {snapshot.next}</span>
            <span>{snapshot.risk}</span>
          </div>
        </div>
        <div className="stage-count">
          {stage.progress ? `${stage.progress.completedCount}/${stage.progress.totalCount} 已完成` : '0/0 已完成'}
        </div>
      </div>
      <div className="column">
        <div className="column-head">
          <strong>
            {stageKey === 'preproduction' ? <FileStack size={20} /> : stageKey === 'video' ? <Film size={20} /> : <PackageCheck size={20} />}
            {config.columnTitle}
          </strong>
          <span>{stage.items.length} 个任务</span>
        </div>
        <div className="run-list">
          {stage.items.length ? (
            stage.items.map((item, index) => (
              <RunCard
                key={`${stageKey}-${item.stepLabel}-${index}`}
                item={item}
                highlight={index === 0}
                onPrimary={() => onPrimary?.(item)}
                onSecondary={() => onSecondary?.(item)}
              />
            ))
          ) : (
            <EmptyState title="这个阶段目前没有任务" message="后端产物里暂时没有对应步骤，等下一轮 run 生成后会自动出现。" />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewPage({ data, onOpenRunLogs, onOpenQa, onOpenArtifacts, viewMode, onChangeViewMode }) {
  const currentRun = data.currentRun;
  const primaryLabel = currentRun.riskSummary?.includes('提醒') || currentRun.riskSummary?.includes('风险') ? '查看提醒项' : '进入当前运行';

  return (
    <>
      <ContextBar currentRun={currentRun} generatedAt={data.generatedAt} />
      <section className="headline">
        <article className="panel coach">
          <div className="coach-top">
            <Sparkles size={16} />
            当前推荐动作
          </div>
          <h1>{currentRun.coachTitle}</h1>
          <p>{currentRun.coachSummary}</p>
          <div className="coach-actions">
            <button className="primary-button" onClick={() => onOpenRunLogs(currentRun.id)}>
              <Play size={18} />
              {primaryLabel}
            </button>
            <button className="secondary-button" onClick={() => onOpenQa(currentRun.id)}>
              <FolderOpen size={18} />
              查看 QA 证据
            </button>
          </div>
        </article>

        <aside className="panel summary">
          <div className="summary-focus">
            <strong>当前状态</strong>
            <span>{currentRun.focusTitle}</span>
            <small>{currentRun.focusSummary}</small>
          </div>
          <div className="summary-grid">
            <div className="summary-item">
              <strong>{data.summary.projectCount}</strong>
              <span>项目数</span>
            </div>
            <div className="summary-item">
              <strong>{data.summary.runCount}</strong>
              <span>运行数</span>
            </div>
            <div className="summary-item">
              <strong>{currentRun.riskSummary}</strong>
              <span>风险状态</span>
            </div>
            <div className="summary-item">
              <strong>{formatDuration(currentRun.durationSec)}</strong>
              <span>当前耗时</span>
            </div>
          </div>
        </aside>
      </section>

      <div className="stats-bar">
        <div className="view-switch" aria-label="视图切换">
          <button
            className={viewMode === 'list' ? 'active' : ''}
            aria-label="列表视图"
            onClick={() => onChangeViewMode('list')}
          >
            <ListFilter size={16} />
          </button>
          <button
            className={viewMode === 'board' ? 'active' : ''}
            aria-label="看板视图"
            onClick={() => onChangeViewMode('board')}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
        <span>当前运行: {currentRun.displayTitle}</span>
        <span>共 {data.summary.runCount} 个 run</span>
        <span>{currentRun.riskSummary}</span>
      </div>

      <section className="workflow">
        <StageColumn
          stageKey="preproduction"
          stage={currentRun.stages.preproduction}
          onPrimary={() => onOpenArtifacts(currentRun.id)}
          onSecondary={() => onOpenArtifacts(currentRun.id)}
        />
        <StageColumn
          stageKey="video"
          stage={currentRun.stages.video}
          onPrimary={() => onOpenRunLogs(currentRun.id)}
          onSecondary={() => onOpenQa(currentRun.id)}
        />
        <StageColumn
          stageKey="delivery"
          stage={currentRun.stages.delivery}
          onPrimary={() => onOpenArtifacts(currentRun.id)}
          onSecondary={() => onOpenQa(currentRun.id)}
        />
      </section>
    </>
  );
}

function ProjectsPage({ projects, selectedProject, onSelectProject, onOpenProjectDetail, searchText, onSearchText }) {
  const filtered = projects.filter((project) =>
    `${project.title} ${project.id}`.toLowerCase().includes(searchText.toLowerCase())
  );
  const matchedProjectSummary = filtered.find((project) => project.id === selectedProject?.id) || null;
  const effectiveProjectSource = matchedProjectSummary || selectedProject || filtered[0] || null;
  const effectiveProject =
    effectiveProjectSource
      ? {
          ...effectiveProjectSource,
          ...(selectedProject?.id === effectiveProjectSource.id ? selectedProject : {}),
          scripts: Array.isArray(
            selectedProject?.id === effectiveProjectSource.id ? selectedProject?.scripts : effectiveProjectSource?.scripts
          )
            ? (selectedProject?.id === effectiveProjectSource.id ? selectedProject?.scripts : effectiveProjectSource?.scripts)
            : [],
        }
      : null;
  const currentOnlyMode = Boolean(effectiveProject?.currentOnly);
  const effectiveScripts = effectiveProject?.scripts || [];

  return (
    <section className="content-page">
      <PageHeader
        title="项目列表"
        description={
          currentOnlyMode
            ? '当前只承接本轮运行对应项目，适合先继续推进和排查。'
            : '快速找到项目、看清最近运行，并继续进入对应分集。'
        }
        actions={<FilterBar value={searchText} onChange={onSearchText} placeholder="搜索项目或 ID" />}
      />
      <MasterDetail
        left={
          <DetailList
            items={filtered.map((project) => ({
              id: project.id,
              title: project.title,
              subtitle: `${project.id} · ${project.scriptCount} 个脚本 · ${project.episodeCount} 个分集`,
              summary: `最近运行：${project.latestRunId || '暂无'}`,
              meta: [{ type: 'info', label: `${project.runCount} 个运行` }],
            }))}
            emptyTitle="暂无项目数据"
            emptyMessage="当前还没有整理出项目列表。"
            onSelect={(item) => onSelectProject(item.id)}
            selectedId={effectiveProject?.id || null}
          />
        }
        right={
          effectiveProject ? (
            <>
              {currentOnlyMode ? (
                <OperationalBanner
                  title="当前仅展示本轮运行对应项目"
                  subtitle="项目列表接口暂未返回完整项目集，这里先聚焦当前项目继续推进。"
                  tone="neutral"
                  actions={[
                    {
                      label: '进入项目详情',
                      icon: ChevronRight,
                      primary: true,
                      onClick: () => onOpenProjectDetail(effectiveProject.id),
                    },
                  ]}
                />
              ) : null}
              <SummaryPills
                items={[
                  { label: '运行数', value: String(effectiveProject.runCount) },
                  {
                    label: '脚本数',
                    value: String(effectiveProject.scriptCount ?? effectiveScripts.length),
                  },
                  {
                    label: '分集数',
                    value: String(
                      effectiveProject.episodeCount ??
                        effectiveScripts.reduce((total, script) => total + (script.episodes?.length || 0), 0)
                    ),
                  },
                ]}
              />
              <DetailInspector
                title={effectiveProject.title}
                subtitle={`${effectiveProject.id} · ${effectiveProject.runCount} 个运行`}
                description={
                  currentOnlyMode ? '当前先展示本轮运行关联的项目结构。' : '从这里继续进入分集，或直接跳到运行排查。'
                }
                sections={[
                  {
                    title: '脚本与分集',
                    items: effectiveScripts.flatMap((script) =>
                      (script.episodes || []).map((episode) => ({
                        label: `${script.title} / ${episode.title}`,
                        value: `${episode.runs?.length || 0} 个运行`,
                      }))
                    ),
                  },
                ]}
              />
              <ActionStrip
                actions={[
                  {
                    label: '进入项目详情',
                    icon: ChevronRight,
                    primary: true,
                    onClick: () => onOpenProjectDetail(effectiveProject.id),
                  },
                  {
                    label: '查看运行日志',
                    icon: ScrollText,
                    onClick: () => {
                      window.location.hash = 'run-logs';
                    },
                  },
                ]}
              />
            </>
          ) : (
            <EmptyState title="选择一个项目" message="点击左侧项目，查看它的 script、episode 和近期运行。" />
          )
        }
      />
    </section>
  );
}

function ProjectDetailPage({ project, selectedEpisode, onSelectEpisode, onOpenQaEvidence, onOpenRunArtifacts, onOpenRunLogs }) {
  if (!project) {
    return (
      <section className="content-page">
        <PageHeader title="项目详情" description="聚合当前项目、分集与运行，是项目级总入口。" />
        <EmptyState title="暂无项目详情" message="请先从项目列表选择一个项目。" />
      </section>
    );
  }

  const episodes = project.scripts.flatMap((script) =>
    script.episodes.map((episode) => ({
      id: `${script.id}:${episode.id}`,
      title: `${script.title} / ${episode.title}`,
      subtitle: `${episode.runs.length} 个运行`,
      summary: episode.runs[0]?.headline || '暂无运行摘要',
      meta: episode.runs.slice(0, 3).map((run) => ({
        type: statusClass(run.status),
        label: statusLabel(run.status),
      })),
      raw: {
        ...episode,
        _key: `${script.id}:${episode.id}`,
        scriptTitle: script.title,
      },
    }))
  );
  const effectiveEpisode = episodes.find((episode) => episode.raw._key === selectedEpisode?._key)?.raw || selectedEpisode || episodes[0]?.raw || null;

  return (
    <section className="content-page">
      <PageHeader
        title="项目详情"
        description={
          project.currentOnly ? '当前先承接本轮运行对应的项目结构与最近运行。' : '展示项目下的 script / episode 树与最近运行表现。'
        }
      />
      <MasterDetail
        left={
          <DetailList
            items={episodes}
            emptyTitle="暂无分集"
            emptyMessage="当前项目还没有 episode 结构。"
            onSelect={(item) => onSelectEpisode(item.raw)}
            selectedId={effectiveEpisode?._key || null}
          />
        }
        right={
          effectiveEpisode ? (
            <>
              {project.currentOnly ? (
                <OperationalBanner
                  title="当前为项目降级视图"
                  subtitle="这里只展示当前运行能确认的 script、episode 与最近运行，用于继续联调和排查。"
                  tone="neutral"
                />
              ) : null}
              <OperationalBanner
                title="当前建议先从最近一轮运行继续排查"
                subtitle="优先看 QA、运行包和日志，避免在项目层反复跳转。"
                actions={[
                  {
                    label: '查看 QA',
                    icon: ShieldCheck,
                    primary: true,
                    onClick: () => onOpenQaEvidence(effectiveEpisode.runs?.[0]?.id),
                  },
                  {
                    label: '查看运行包',
                    icon: FolderOpen,
                    onClick: () => onOpenRunArtifacts(effectiveEpisode.runs?.[0]?.id),
                  },
                ]}
              />
              <SummaryPills
                items={[
                  { label: '运行轮次', value: String(effectiveEpisode.runs.length) },
                  {
                    label: '最新状态',
                    value: effectiveEpisode.runs[0] ? statusLabel(effectiveEpisode.runs[0].status) : '暂无',
                  },
                ]}
              />
              <DetailInspector
                title={`${effectiveEpisode.scriptTitle || '未命名脚本'} / ${effectiveEpisode.title || effectiveEpisode.id}`}
                subtitle="当前分集"
                description="最近运行已按时间排好，直接选择下一步排查入口即可。"
                sections={[
                  {
                    title: '最近运行',
                    items: effectiveEpisode.runs.map((run) => ({
                      label: run.id,
                      value: `${statusLabel(run.status)} · ${formatDateTime(run.finishedAt || run.startedAt)}`,
                    })),
                  },
                ]}
              />
              <ActionStrip
                actions={[
                  {
                    label: '查看 QA 证据',
                    icon: ShieldCheck,
                    primary: true,
                    onClick: () => onOpenQaEvidence(effectiveEpisode.runs?.[0]?.id),
                  },
                  {
                    label: '查看运行包',
                    icon: FolderOpen,
                    onClick: () => onOpenRunArtifacts(effectiveEpisode.runs?.[0]?.id),
                  },
                  {
                    label: '查看运行日志',
                    icon: ScrollText,
                    onClick: () => onOpenRunLogs(effectiveEpisode.runs?.[0]?.id),
                  },
                ]}
              />
            </>
          ) : (
            <EmptyState title="选择一个分集" message="点击左侧分集，查看它的运行记录。" />
          )
        }
      />
    </section>
  );
}

function RunLogsPage({
  runs,
  selectedRun,
  onSelectRun,
  searchText,
  onSearchText,
  statusFilter,
  onStatusFilter,
  onOpenQaEvidence,
  onOpenRunArtifacts,
}) {
  const currentOnlyMode = Boolean(
    runs?.length === 1 && runs[0]?.meta?.some((meta) => meta.label === 'fallback-run')
  );
  const filtered = runs.filter((run) => {
    const matchesText = `${run.scriptTitle || ''} ${run.episodeTitle || ''} ${run.id}`
      .toLowerCase()
      .includes(searchText.toLowerCase());
    const matchesStatus = statusFilter === 'all' ? true : run.status === statusFilter;
    return matchesText && matchesStatus;
  });
  const effectiveRun = filtered.find((run) => run.id === selectedRun?.id) || selectedRun || filtered[0] || null;

  return (
    <section className="content-page">
      <PageHeader
        title="运行日志"
        description={
          currentOnlyMode
            ? '当前只承接本轮运行记录，适合先继续 QA 与产物排查。'
            : '按状态筛选运行，快速定位问题来源并继续进入 QA 或产物。'
        }
        actions={
          <div className="page-actions page-actions-stack">
            <FilterBar value={searchText} onChange={onSearchText} placeholder="搜索运行、脚本或分集" />
            <StatusFilter
              value={statusFilter}
              onChange={onStatusFilter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'pass', label: '通过' },
                { value: 'warn', label: '提醒' },
                { value: 'block', label: '阻断' },
                { value: 'running', label: '运行中' },
              ]}
            />
          </div>
        }
      />
      <MasterDetail
        left={
          <DetailList
            items={filtered.map((run) => ({
              id: run.id,
              title: `${run.scriptTitle || run.scriptId} / ${run.episodeTitle || run.episodeId}`,
              subtitle: `${run.projectId} · ${formatDateTime(run.finishedAt || run.startedAt)}`,
              summary: run.headline || '暂无运行摘要',
              status: run.status,
              statusClass: run.status,
            }))}
            emptyTitle="暂无运行记录"
            emptyMessage="当前没有可展示的运行日志。"
            onSelect={(item) => onSelectRun(item.id)}
            selectedId={effectiveRun?.id}
          />
        }
        right={
          effectiveRun ? (
            <>
              {currentOnlyMode ? (
                <OperationalBanner
                  title="当前仅展示一条真实运行记录"
                  subtitle="降级模式下不会把阶段步骤伪装成多条运行，列表只保留当前真实 run。"
                  tone="neutral"
                />
              ) : null}
              <OperationalBanner
                title={`当前建议: ${effectiveRun.status === 'warn' || effectiveRun.status === 'block' ? '先看 QA 证据' : '先核对运行包'}`}
                subtitle="日志页负责定位，详情页负责继续处理。"
                tone={effectiveRun.status === 'warn' || effectiveRun.status === 'block' ? 'warn' : 'neutral'}
                actions={[
                  {
                    label: '查看 QA 证据',
                    icon: ShieldCheck,
                    primary: true,
                    onClick: () => onOpenQaEvidence(effectiveRun.id),
                  },
                  {
                    label: '查看运行包',
                    icon: FolderOpen,
                    onClick: () => onOpenRunArtifacts(effectiveRun.id),
                  },
                ]}
              />
              <SummaryPills
                items={[
                  { label: '状态', value: statusLabel(effectiveRun.status) },
                  {
                    label: '耗时',
                    value: effectiveRun.finishedAt
                      ? formatDuration(
                          Math.max(
                            0,
                            Math.round((new Date(effectiveRun.finishedAt) - new Date(effectiveRun.startedAt)) / 1000)
                          )
                        )
                      : '进行中',
                  },
                ]}
              />
              <DetailInspector
                title={`${effectiveRun.scriptTitle || effectiveRun.scriptId} / ${effectiveRun.episodeTitle || effectiveRun.episodeId}`}
                subtitle={`${effectiveRun.projectId} · ${statusLabel(effectiveRun.status)}`}
                description={effectiveRun.headline || '当前运行没有额外摘要。'}
                sections={[
                  {
                    title: '运行信息',
                    items: [
                      { label: 'Run ID', value: effectiveRun.id },
                      { label: '开始时间', value: formatDateTime(effectiveRun.startedAt) },
                      { label: '结束时间', value: formatDateTime(effectiveRun.finishedAt) },
                      { label: '脚本', value: effectiveRun.scriptTitle || effectiveRun.scriptId || '未命名脚本' },
                      { label: '分集', value: effectiveRun.episodeTitle || effectiveRun.episodeId || '未命名分集' },
                    ],
                  },
                ]}
              />
              <ActionStrip
                actions={[
                  {
                    label: '查看 QA 证据',
                    icon: ShieldCheck,
                    primary: true,
                    onClick: () => onOpenQaEvidence(effectiveRun.id),
                  },
                  {
                    label: '查看运行包',
                    icon: FolderOpen,
                    onClick: () => onOpenRunArtifacts(effectiveRun.id),
                  },
                ]}
              />
            </>
          ) : (
            <EmptyState title="选择一条运行" message="点击左侧运行，查看它的摘要和时间信息。" />
          )
        }
      />
    </section>
  );
}

function QaEvidenceDetail({ qaDetail }) {
  const items = (qaDetail?.agentSummaries || []).map((item, index) => ({
    id: `${item.agentName}-${index}`,
    title: item.agentName,
    summary: item.headline || item.summary,
    status: item.status,
    statusClass: item.status,
  }));

  return qaDetail ? (
    <div className="content-page compact-page">
      <OperationalBanner
        title={qaDetail.releasable ? '当前可继续交付' : '当前不建议直接交付'}
        subtitle={qaDetail.blockCount ? '先处理阻断项，再回到运行包核对结果。' : qaDetail.warnCount ? '先处理提醒项，再决定是否继续交付。' : '当前没有阻断项，可继续核对交付产物。'}
        tone={qaDetail.blockCount ? 'danger' : qaDetail.warnCount ? 'warn' : 'success'}
      />
      <SummaryPills
        items={[
          { label: 'Pass', value: String(qaDetail.passCount || 0) },
          { label: 'Warn', value: String(qaDetail.warnCount || 0) },
          { label: 'Block', value: String(qaDetail.blockCount || 0) },
        ]}
      />
      <MetricGrid
        items={[
          { label: 'Agent 数', value: String(items.length) },
          { label: '可交付', value: qaDetail.releasable ? '是' : '否' },
          { label: '风险级别', value: qaDetail.blockCount ? '高' : qaDetail.warnCount ? '中' : '低' },
        ]}
      />
      <QuickActionGrid
        actions={[
          {
            label: '回到运行日志',
            description: '切回 run 维度继续排查',
            icon: ScrollText,
            primary: true,
            onClick: () => {
              window.location.hash = 'run-logs';
            },
          },
          {
            label: '查看运行包',
            description: '直接打开对应产物目录摘要',
            icon: FolderOpen,
            onClick: () => {
              window.location.hash = 'run-artifacts';
            },
          },
        ]}
      />
      <DetailInspector
        title={qaDetail.headline || 'QA 总览'}
        subtitle="当前风险"
        description={qaDetail.summary || '暂无 QA 描述。'}
        sections={[
          {
            title: '重点问题',
            items: (qaDetail.topIssues || []).map((issue) => ({
              label: 'Issue',
              value: issue,
            })),
          },
          {
            title: 'Agent 摘要',
            items: items.slice(0, 8).map((item) => ({
              label: item.title,
              value: item.summary || '暂无摘要',
            })),
          },
        ]}
      />
      <div className="panel slim-panel">
        <div className="panel-inline-head">
          <strong>Agent 证据矩阵</strong>
          <span>按当前 run 聚合</span>
        </div>
        <DataTable
          columns={[
            { key: 'agent', label: 'Agent' },
            { key: 'status', label: '状态' },
            { key: 'headline', label: '摘要' },
          ]}
          rows={(qaDetail.agentSummaries || []).slice(0, 12).map((item) => ({
            agent: item.agentName || '未命名',
            status: statusLabel(item.status),
            headline: item.headline || item.summary || '暂无摘要',
          }))}
        />
      </div>
    </div>
  ) : (
    <EmptyState title="暂无 QA 详情" message="当前没有加载到 QA 数据。" />
  );
}

function QaEvidenceRunPage({ runs, selectedRun, qaDetail, onSelectRun, searchText, onSearchText }) {
  const currentOnlyMode = Boolean(
    runs?.length === 1 && runs[0]?.meta?.some((meta) => meta.label === 'fallback-run')
  );
  const filteredRuns = (runs || []).filter((run) =>
    `${run.scriptTitle || run.scriptId} ${run.episodeTitle || run.episodeId} ${run.id}`
      .toLowerCase()
      .includes(searchText.toLowerCase())
  );
  const effectiveSelectedRun =
    filteredRuns.find((run) => run.id === selectedRun?.id) || selectedRun || filteredRuns[0] || null;

  return (
    <section className="content-page">
      <PageHeader
        title="QA 证据"
        description={
          currentOnlyMode
            ? '当前基于本轮运行聚合 QA 证据，方便继续人工复核。'
            : '按 run 查看 agent 级 pass / warn / block 证据，方便运营排查和复核。'
        }
        actions={<FilterBar value={searchText} onChange={onSearchText} placeholder="搜索运行、脚本或分集" />}
      />
      <MasterDetail
        left={
          <DetailList
            items={filteredRuns.map((run) => ({
              id: run.id,
              title: `${run.scriptTitle || run.scriptId} / ${run.episodeTitle || run.episodeId}`,
              subtitle: `${run.projectId} · ${formatDateTime(run.finishedAt || run.startedAt)}`,
              summary: run.headline || '暂无运行摘要',
              status: run.status,
              statusClass: run.status,
            }))}
            emptyTitle="暂无 QA 运行"
            emptyMessage="当前没有可切换的运行记录。"
            onSelect={(item) => onSelectRun(item.id)}
            selectedId={effectiveSelectedRun?.id}
          />
        }
        right={
          qaDetail ? (
            <div className="content-page compact-page">
              {currentOnlyMode ? (
                <OperationalBanner
                  title="当前仅聚合本轮运行证据"
                  subtitle="这里的 agent 证据来自同一条运行内部步骤，不代表多轮独立运行。"
                  tone="neutral"
                />
              ) : null}
              <ContextBar
                currentRun={{
                  displayTitle: effectiveSelectedRun
                    ? `${effectiveSelectedRun.scriptTitle || effectiveSelectedRun.scriptId} / ${effectiveSelectedRun.episodeTitle || effectiveSelectedRun.episodeId}`
                    : '未选择运行',
                  riskSummary: effectiveSelectedRun ? statusLabel(effectiveSelectedRun.status) : '暂无状态',
                }}
                generatedAt={effectiveSelectedRun?.finishedAt || effectiveSelectedRun?.startedAt || new Date().toISOString()}
              />
              <QaEvidenceDetail qaDetail={qaDetail} />
            </div>
          ) : (
            <EmptyState title="暂无 QA 详情" message="请选择一条运行。" />
          )
        }
      />
    </section>
  );
}

function RunArtifactsDetail({ artifactDetail }) {
  const items = (artifactDetail?.outputFiles || []).map((file, index) => ({
    id: `${file.agentDir}-${file.name}-${index}`,
    title: file.name,
    subtitle: file.agentDir,
    summary: '来自运行包 1-outputs 目录的关键输出文件。',
  }));
  const noConfirmedOutputs = Boolean(artifactDetail?.currentOnly && !(artifactDetail?.outputFiles || []).length);

  return artifactDetail ? (
    <div className="content-page compact-page">
      <OperationalBanner
        title={noConfirmedOutputs ? '当前未发现可确认的关键输出文件' : '当前可直接核对关键输出与交付目录'}
        subtitle={
          noConfirmedOutputs
            ? '当前只确认了运行目录与 agent 目录，建议回到日志或 QA 继续排查。'
            : '建议先看关键文件，再回到日志或 QA 做交叉确认。'
        }
      />
      <SummaryPills
        items={[
          { label: 'Agent目录', value: String((artifactDetail.agentDirs || []).length) },
          { label: '关键文件', value: String((artifactDetail.outputFiles || []).length) },
        ]}
      />
      <MetricGrid
        items={[
          { label: '运行包状态', value: artifactDetail.runDir ? '已发现' : '缺失' },
          { label: '目录层级', value: 'run / agent / outputs' },
          { label: '读取模式', value: artifactDetail.currentOnly ? '降级只读' : '只读' },
        ]}
      />
      <QuickActionGrid
        actions={[
          {
            label: '查看运行日志',
            description: '回到对应运行记录',
            icon: ScrollText,
            primary: true,
            onClick: () => {
              window.location.hash = 'run-logs';
            },
          },
          {
            label: '查看 QA 证据',
            description: '核对当前产物是否可交付',
            icon: ShieldCheck,
            onClick: () => {
              window.location.hash = 'qa-evidence';
            },
          },
        ]}
      />
      <DetailInspector
        title="运行包目录"
        subtitle={artifactDetail.runDir || '暂无目录'}
        description={
          noConfirmedOutputs
            ? '当前只展示已确认的目录信息；关键输出文件仍需以后端真实发现结果为准。'
            : '这里展示当前 run 可以直接核对的目录与关键输出。'
        }
        sections={[
          {
            title: 'Agent 目录',
            items: (artifactDetail.agentDirs || []).map((dir) => ({
              label: dir,
              value: '已写出',
            })),
          },
          {
            title: noConfirmedOutputs ? '已确认输出文件' : '关键输出文件',
            items: (artifactDetail.outputFiles || []).map((file) => ({
              label: file.agentDir,
              value: file.name,
            })),
          },
        ]}
      />
      <div className="panel slim-panel">
        <div className="panel-inline-head">
          <strong>{noConfirmedOutputs ? '已确认输出文件' : '关键输出文件表'}</strong>
          <span>{noConfirmedOutputs ? '当前未从磁盘确认到具体文件' : '优先看 1-outputs 与 2-metrics'}</span>
        </div>
        <DataTable
          columns={[
            { key: 'agent', label: 'Agent 目录' },
            { key: 'file', label: '文件名' },
          ]}
          rows={(artifactDetail.outputFiles || []).map((file) => ({
            agent: file.agentDir,
            file: file.name,
          }))}
          emptyText={noConfirmedOutputs ? '当前未发现可确认的关键输出文件，请先回到运行日志或 QA 继续排查。' : '暂无关键输出文件'}
        />
      </div>
    </div>
  ) : (
    <EmptyState title="暂无运行包详情" message="当前没有加载到运行包目录。" />
  );
}

function RunArtifactsRunPage({ runs, selectedRun, artifactDetail, onSelectRun, searchText, onSearchText }) {
  const currentOnlyMode = Boolean(
    runs?.length === 1 && runs[0]?.meta?.some((meta) => meta.label === 'fallback-run')
  );
  const filteredRuns = (runs || []).filter((run) =>
    `${run.scriptTitle || run.scriptId} ${run.episodeTitle || run.episodeId} ${run.id}`
      .toLowerCase()
      .includes(searchText.toLowerCase())
  );
  const effectiveSelectedRun =
    filteredRuns.find((run) => run.id === selectedRun?.id) || selectedRun || filteredRuns[0] || null;

  return (
    <section className="content-page">
      <PageHeader
        title="运行包"
        description={
          currentOnlyMode
            ? '当前只承接本轮运行的 artifact 目录与已确认产物。'
            : '按 run 查看 artifact 目录、agent 产物和关键输出文件。'
        }
        actions={<FilterBar value={searchText} onChange={onSearchText} placeholder="搜索运行、脚本或分集" />}
      />
      <MasterDetail
        left={
          <DetailList
            items={filteredRuns.map((run) => ({
              id: run.id,
              title: `${run.scriptTitle || run.scriptId} / ${run.episodeTitle || run.episodeId}`,
              subtitle: `${run.projectId} · ${formatDateTime(run.finishedAt || run.startedAt)}`,
              summary: run.headline || '暂无运行摘要',
              status: run.status,
              statusClass: run.status,
            }))}
            emptyTitle="暂无运行包数据"
            emptyMessage="当前没有可切换的运行记录。"
            onSelect={(item) => onSelectRun(item.id)}
            selectedId={effectiveSelectedRun?.id}
          />
        }
        right={
          artifactDetail ? (
            <div className="content-page compact-page">
              {currentOnlyMode ? (
                <OperationalBanner
                  title="当前仅展示本轮运行包"
                  subtitle="降级模式下只展示当前真实运行能确认的目录与文件，不补造额外产物。"
                  tone="neutral"
                />
              ) : null}
              <ContextBar
                currentRun={{
                  displayTitle: effectiveSelectedRun
                    ? `${effectiveSelectedRun.scriptTitle || effectiveSelectedRun.scriptId} / ${effectiveSelectedRun.episodeTitle || effectiveSelectedRun.episodeId}`
                    : '未选择运行',
                  riskSummary: effectiveSelectedRun ? statusLabel(effectiveSelectedRun.status) : '暂无状态',
                }}
                generatedAt={effectiveSelectedRun?.finishedAt || effectiveSelectedRun?.startedAt || new Date().toISOString()}
              />
              <RunArtifactsDetail artifactDetail={artifactDetail} />
            </div>
          ) : (
            <EmptyState title="暂无运行包详情" message="请选择一条运行。" />
          )
        }
      />
    </section>
  );
}

function CharacterAssetsPage({ characterAssets, selectedItem, searchText, onSearchText, onSelect }) {
  const items = characterAssets || [];
  const filtered = items.filter((item) =>
    `${item.title} ${item.summary || ''} ${item.sourceLabel || ''}`.toLowerCase().includes(searchText.toLowerCase())
  );
  const selected = filtered.find((item) => item.id === selectedItem?.id) || selectedItem || filtered[0] || null;

  return (
    <section className="content-page">
      <PageHeader
        title="角色资产"
        description="查看角色资产状态，并直接回到项目或运行继续推进。"
        actions={<FilterBar value={searchText} onChange={onSearchText} placeholder="搜索角色资产或来源" />}
      />
      <MasterDetail
        left={
          <DetailList
            items={filtered.map((item) => ({
              id: item.id,
              title: item.title,
              summary: item.summary,
              subtitle: item.sourceLabel || '本地运行产物',
            }))}
            emptyTitle="暂无角色资产"
            emptyMessage="当前没有可展示的角色资产摘要。"
            selectedId={selected?.id || null}
            onSelect={onSelect}
          />
        }
        right={
          <>
            <SummaryPills
              items={[
                { label: '资产来源', value: selected?.sourceLabel || '本地产物' },
                { label: '绑定策略', value: 'ID-first' },
              ]}
            />
            <MetricGrid
              items={[
                { label: '角色条目', value: String(filtered.length) },
                { label: '三视图', value: filtered.length ? '待补文件' : '暂无' },
                { label: '引用状态', value: '可排查' },
              ]}
            />
            <div className="section-block">
              <div className="section-block-head">
                <strong>快捷处理</strong>
                <span>直接回到推进入口</span>
              </div>
              <QuickActionGrid
                actions={[
                  {
                    label: '查看项目列表',
                    description: '回到项目维度继续推进',
                    icon: FolderKanban,
                    primary: true,
                    onClick: () => {
                      window.location.hash = 'projects';
                    },
                  },
                  {
                    label: '查看运行日志',
                    description: '从运行角度排查角色问题',
                    icon: ScrollText,
                    onClick: () => {
                      window.location.hash = 'run-logs';
                    },
                  },
                ]}
              />
            </div>
            <DetailInspector
              title={selected?.title || '角色资产'}
              subtitle={selected?.sourceLabel || 'filesystem-artifacts'}
              description={selected?.summary || '当前资产可直接作为项目推进与运行排查入口。'}
              sections={[
                {
                  title: '当前资产',
                  items: [
                    { label: '数据源', value: '本地运行产物' },
                    { label: '绑定策略', value: 'ID-first' },
                    { label: '适用场景', value: '档案 / 三视图 / 绑定关系' },
                  ],
                },
              ]}
            />
            <div className="panel slim-panel">
              <div className="panel-inline-head">
                <strong>资产推进清单</strong>
                <span>当前可继续处理的项</span>
              </div>
              <DataTable
                columns={[
                  { key: 'module', label: '模块' },
                  { key: 'state', label: '状态' },
                  { key: 'action', label: '下一步' },
                ]}
                rows={[
                  { module: '角色档案', state: '已接入', action: '回项目页继续推进' },
                  { module: '三视图缩略图', state: '待补文件', action: '去运行包核对产物' },
                  { module: '引用镜头关系', state: '待细化', action: '去运行日志排查来源' },
                ]}
              />
            </div>
          </>
        }
      />
    </section>
  );
}

function VideoLibraryPage({ videoAssets, selectedItem, searchText, onSearchText, onSelect }) {
  const items = videoAssets || [];
  const filtered = items.filter((item) =>
    `${item.title} ${item.artifactRunDir || ''} ${item.id}`.toLowerCase().includes(searchText.toLowerCase())
  );
  const selected = filtered.find((item) => item.id === selectedItem?.id) || selectedItem || filtered[0] || null;

  return (
    <section className="content-page">
      <PageHeader
        title="成片库"
        description="核对成片状态、来源 run 与当前交付动作。"
        actions={<FilterBar value={searchText} onChange={onSearchText} placeholder="搜索成片、运行或路径" />}
      />
      <MasterDetail
        left={
          <DetailList
            items={filtered.map((item) => ({
              id: item.id,
              title: item.title,
              subtitle: item.artifactRunDir,
              summary: `来源运行：${item.id}`,
              status: item.status,
              statusClass: item.status,
            }))}
            emptyTitle="暂无成片库数据"
            emptyMessage="当前没有可展示的成片摘要。"
            selectedId={selected?.id || null}
            onSelect={onSelect}
          />
        }
        right={
          <>
            <OperationalBanner
              title={selected ? `当前建议: 先核对 ${statusLabel(selected.status)}` : '当前建议: 先选择一条成片'}
              subtitle={selected ? `来源运行 ${selected.id}，建议继续回查日志或运行包。` : '选择成片后再继续交付核对。'}
              actions={[
                {
                  label: '查看运行日志',
                  icon: ScrollText,
                  primary: true,
                  onClick: () => {
                    window.location.hash = 'run-logs';
                  },
                },
                {
                  label: '查看运行包',
                  icon: FolderOpen,
                  onClick: () => {
                    window.location.hash = 'run-artifacts';
                  },
                },
              ]}
            />
            <SummaryPills
              items={[
                { label: '成片条目', value: String(filtered.length) },
                { label: '通过条目', value: String(filtered.filter((item) => item.status === 'pass').length) },
              ]}
            />
            <MetricGrid
              items={[
                { label: '当前选中', value: selected ? statusLabel(selected.status) : '暂无' },
                { label: '交付来源', value: 'output / runs' },
                { label: '当前动作', value: selected ? '回查来源' : '等待选择' },
              ]}
            />
            <DetailInspector
              title={selected?.title || '成片库'}
              subtitle={selected?.artifactRunDir || 'filesystem-artifacts'}
              description={selected ? `来源运行：${selected.id}` : '当前成片库已经接到只读接口。'}
              sections={[
                {
                  title: '交付信息',
                  items: [
                    { label: '来源', value: '运行产物聚合' },
                    { label: '当前模式', value: '只读' },
                    { label: '适合用途', value: '交付前复核 / 成片归档' },
                  ],
                },
              ]}
            />
            <div className="panel slim-panel">
              <div className="panel-inline-head">
                <strong>成片条目表</strong>
                <span>按来源 run 聚合</span>
              </div>
              <DataTable
                columns={[
                  { key: 'title', label: '成片' },
                  { key: 'status', label: '状态' },
                ]}
                rows={filtered.map((item) => ({
                  title: item.title,
                  status: statusLabel(item.status),
                }))}
              />
            </div>
          </>
        }
      />
    </section>
  );
}

function SettingsPage({ settings, selectedItem, onSelect }) {
  const items = [
    { id: 'api', title: '工作台后端', summary: settings?.workbenchApiBase || '未加载' },
    { id: 'frontend', title: 'React 前端', summary: settings?.frontendDevServer || '未加载' },
    { id: 'mode', title: '运行模式', summary: settings?.mode || '未加载' },
  ];
  const selected = items.find((item) => item.id === selectedItem?.id) || selectedItem || items[0];

  return (
    <section className="content-page">
      <PageHeader title="配置中心" description="查看当前模式、入口和交付口径，不在这里做复杂配置编辑。" />
      <MasterDetail
        left={
          <DetailList
            items={items}
            emptyTitle="暂无配置"
            emptyMessage="当前没有配置项。"
            selectedId={selected?.id || null}
            onSelect={onSelect}
          />
        }
        right={
          <>
            <OperationalBanner
              title="当前是只读联调模式"
              subtitle="这里主要用于确认前后端入口和当前交付策略。"
            />
            <SummaryPills
              items={[
                { label: '模式', value: settings?.mode || '未加载' },
                { label: '前端', value: 'Vite' },
                { label: '后端', value: 'Node HTTP' },
              ]}
            />
            <MetricGrid
              items={[
                { label: '运行形态', value: '只读联调' },
                { label: '前端入口', value: '5174' },
                { label: '后端入口', value: '4178' },
              ]}
            />
            <QuickActionGrid
              actions={[
                {
                    label: '回到总览',
                    description: '回到当前运行总控页',
                    icon: WandSparkles,
                    primary: true,
                    onClick: () => {
                    window.location.hash = 'overview';
                  },
                },
                {
                  label: '查看运行包',
                  description: '检查当前只读聚合结果',
                  icon: FolderOpen,
                  onClick: () => {
                    window.location.hash = 'run-artifacts';
                  },
                },
              ]}
            />
            <DetailInspector
              title={selected?.title || '配置中心'}
              subtitle="工作台联调模式"
              description={selected?.summary || settings?.note || '当前没有配置说明。'}
              sections={[
                {
                  title: '当前配置',
                  items: [
                    { label: '后端接口', value: settings?.workbenchApiBase || '未加载' },
                    { label: '前端地址', value: settings?.frontendDevServer || '未加载' },
                    { label: '模式', value: settings?.mode || '未加载' },
                  ],
                },
              ]}
            />
            <div className="panel slim-panel">
              <div className="panel-inline-head">
                <strong>当前交付策略</strong>
                <span>商用上线前需要确认</span>
              </div>
              <DataTable
                columns={[
                  { key: 'item', label: '配置项' },
                  { key: 'value', label: '当前口径' },
                ]}
                rows={[
                  { item: '核心生成链路', value: '不改' },
                  { item: '工作台接口', value: '只读聚合' },
                  { item: '页面交互', value: '真跳转 / 真详情' },
                ]}
              />
            </div>
          </>
        }
      />
    </section>
  );
}

function App() {
  const [pageKey, setPageKey] = useState(getInitialPage());
  const [viewMode, setViewMode] = useState('board');
  const [error, setError] = useState('');
  const [workbench, setWorkbench] = useState(null);
  const [pageStore, setPageStore] = useState(createPageStore());
  const [projectSearch, setProjectSearch] = useState('');
  const [runSearch, setRunSearch] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState('all');
  const [characterSearch, setCharacterSearch] = useState('');
  const [videoSearch, setVideoSearch] = useState('');
  const [qaSearch, setQaSearch] = useState('');
  const [artifactSearch, setArtifactSearch] = useState('');

  function setPageHash(nextPageKey) {
    if (window.location.hash.replace('#', '') === nextPageKey) {
      setPageKey(nextPageKey);
      return;
    }
    window.location.hash = nextPageKey;
  }

  async function refreshWorkbench() {
    try {
      setError('');
      const data = await fetchWorkbench();
      setWorkbench(data);
      return data;
    } catch (err) {
      setError(err.message || '未知错误');
      return null;
    }
  }

  async function loadProjects(projectId = null) {
    try {
      const list = await fetchProjects();
      const targetId = projectId || list[0]?.id || null;
      const selectedProject = targetId ? await fetchProject(targetId) : null;
      const firstScript = selectedProject?.scripts?.[0] || null;
      const firstEpisode = firstScript?.episodes?.[0]
        ? {
            ...firstScript.episodes[0],
            _key: `${firstScript.id}:${firstScript.episodes[0].id}`,
            scriptTitle: firstScript.title,
          }
        : null;

      setPageStore((prev) => ({
        ...prev,
        projects: list,
        selectedProject,
        selectedEpisode: firstEpisode,
      }));
    } catch (err) {
      const fallbackProject = buildFallbackProject(workbench);
      const firstScript = fallbackProject.scripts[0] || null;
      const firstEpisode = firstScript?.episodes?.[0]
        ? {
            ...firstScript.episodes[0],
            _key: `${firstScript.id}:${firstScript.episodes[0].id}`,
            scriptTitle: firstScript.title,
          }
        : null;

      setPageStore((prev) => ({
        ...prev,
        projects: [fallbackProject],
        selectedProject: fallbackProject,
        selectedEpisode: firstEpisode,
      }));
    }
  }

  async function openProjectDetail(projectId) {
    try {
      const selectedProject = await fetchProject(projectId);
      const firstScript = selectedProject?.scripts?.[0] || null;
      const firstEpisode = firstScript?.episodes?.[0]
        ? {
            ...firstScript.episodes[0],
            _key: `${firstScript.id}:${firstScript.episodes[0].id}`,
            scriptTitle: firstScript.title,
          }
        : null;

      setPageStore((prev) => ({
        ...prev,
        selectedProject,
        selectedEpisode: firstEpisode,
      }));
      setPageHash('project-detail');
    } catch (err) {
      const fallbackProject = buildFallbackProject(workbench);
      const firstScript = fallbackProject.scripts[0] || null;
      const firstEpisode = firstScript?.episodes?.[0]
        ? {
            ...firstScript.episodes[0],
            _key: `${firstScript.id}:${firstScript.episodes[0].id}`,
            scriptTitle: firstScript.title,
          }
        : null;
      setPageStore((prev) => ({
        ...prev,
        selectedProject: fallbackProject,
        selectedEpisode: firstEpisode,
      }));
      setPageHash('project-detail');
    }
  }

  async function openEpisodeDetail(projectId, scriptId, episodeId, fallbackEpisode) {
    try {
      const episode = await fetchEpisode(projectId, scriptId, episodeId);
      setPageStore((prev) => ({
        ...prev,
        selectedEpisode: {
          ...fallbackEpisode,
          ...episode,
          _key: `${scriptId}:${episodeId}`,
          scriptTitle: fallbackEpisode.scriptTitle,
        },
      }));
    } catch (err) {
      setPageStore((prev) => ({
        ...prev,
        selectedEpisode: fallbackEpisode,
      }));
    }
  }

  async function loadRuns(targetRunId = null, navigateAfter = false) {
    try {
      const runs = await fetchRuns();
      const selectedRun = targetRunId
        ? await fetchRun(targetRunId)
        : runs[0]
          ? await fetchRun(runs[0].id)
          : null;

      setPageStore((prev) => ({
        ...prev,
        runs,
        selectedRun,
      }));

      if (navigateAfter) {
        setPageHash('run-logs');
      }
    } catch (err) {
      const fallbackRuns = buildFallbackRuns(workbench);
      const fallbackSelectedRun =
        fallbackRuns.find((run) => run.id === targetRunId) || fallbackRuns[0] || null;

      setPageStore((prev) => ({
        ...prev,
        runs: fallbackRuns,
        selectedRun: fallbackSelectedRun,
      }));

      if (navigateAfter) {
        setPageHash('run-logs');
      }
    }
  }

  async function openQaEvidence(runId = null) {
    try {
      const targetRunId = runId || workbench?.currentRun?.id || null;
      const runs = pageStore.runs.length ? pageStore.runs : await fetchRuns();
      const selectedRun =
        pageStore.selectedRun?.id === targetRunId
          ? pageStore.selectedRun
          : targetRunId
            ? await fetchRun(targetRunId)
            : runs[0]
              ? await fetchRun(runs[0].id)
              : null;
      const selectedRunQa = targetRunId ? await fetchRunQa(targetRunId) : null;

      setPageStore((prev) => ({
        ...prev,
        runs,
        selectedRun,
        selectedRunQa,
      }));
      setPageHash('qa-evidence');
    } catch (err) {
      const fallbackRuns = pageStore.runs.length ? pageStore.runs : buildFallbackRuns(workbench);
      const fallbackSelectedRun =
        fallbackRuns.find((run) => run.id === runId) || pageStore.selectedRun || fallbackRuns[0] || null;
      const selectedRunQa = buildFallbackQaDetail(workbench, fallbackSelectedRun);

      setPageStore((prev) => ({
        ...prev,
        runs: fallbackRuns,
        selectedRun: fallbackSelectedRun,
        selectedRunQa,
      }));
      setPageHash('qa-evidence');
    }
  }

  async function openRunArtifacts(runId = null) {
    try {
      const targetRunId = runId || workbench?.currentRun?.id || null;
      const runs = pageStore.runs.length ? pageStore.runs : await fetchRuns();
      const selectedRun =
        pageStore.selectedRun?.id === targetRunId
          ? pageStore.selectedRun
          : targetRunId
            ? await fetchRun(targetRunId)
            : runs[0]
              ? await fetchRun(runs[0].id)
              : null;
      const selectedRunArtifacts = targetRunId ? await fetchRunArtifacts(targetRunId) : null;

      setPageStore((prev) => ({
        ...prev,
        runs,
        selectedRun,
        selectedRunArtifacts,
      }));
      setPageHash('run-artifacts');
    } catch (err) {
      const fallbackRuns = pageStore.runs.length ? pageStore.runs : buildFallbackRuns(workbench);
      const fallbackSelectedRun =
        fallbackRuns.find((run) => run.id === runId) || pageStore.selectedRun || fallbackRuns[0] || null;
      const selectedRunArtifacts = buildFallbackArtifactDetail(workbench, fallbackSelectedRun);

      setPageStore((prev) => ({
        ...prev,
        runs: fallbackRuns,
        selectedRun: fallbackSelectedRun,
        selectedRunArtifacts,
      }));
      setPageHash('run-artifacts');
    }
  }

  async function loadCharacterAssets() {
    try {
      const result = await fetchCharacterAssets();
      const items = (result?.items || []).map((item, index) => ({
        ...item,
        id: item.id || `${item.title}-${index}`,
        sourceLabel: item.source || '本地运行产物',
      }));
      setPageStore((prev) => ({
        ...prev,
        characterAssets: items,
        selectedCharacterAsset: items[0] || null,
      }));
    } catch (err) {
      const items = buildFallbackCharacterAssets(workbench);
      setPageStore((prev) => ({
        ...prev,
        characterAssets: items,
        selectedCharacterAsset: items[0] || null,
      }));
    }
  }

  async function loadVideoLibrary() {
    try {
      const result = await fetchVideoAssets();
      const items = result?.items || [];
      setPageStore((prev) => ({
        ...prev,
        videoAssets: items,
        selectedVideoAsset: items[0] || null,
      }));
    } catch (err) {
      const items = buildFallbackVideoAssets(workbench);
      setPageStore((prev) => ({
        ...prev,
        videoAssets: items,
        selectedVideoAsset: items[0] || null,
      }));
    }
  }

  async function loadSettings() {
    try {
      const settings = await fetchProviderSettings();
      setPageStore((prev) => ({
        ...prev,
        settings,
        selectedSettingItem: { id: 'api', title: '工作台后端', summary: settings?.workbenchApiBase || '未加载' },
      }));
    } catch (err) {
      const settings = buildFallbackSettings();
      setPageStore((prev) => ({
        ...prev,
        settings,
        selectedSettingItem: { id: 'api', title: '工作台后端', summary: settings.workbenchApiBase },
      }));
    }
  }

  useEffect(() => {
    refreshWorkbench();
  }, []);

  useEffect(() => {
    const onHashChange = () => setPageKey(getInitialPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!workbench) return;
    if (pageKey === 'projects') loadProjects(pageStore.selectedProject?.id || null);
    if (pageKey === 'project-detail' && pageStore.selectedProject?.id) openProjectDetail(pageStore.selectedProject.id);
    if (pageKey === 'run-logs') loadRuns(pageStore.selectedRun?.id || workbench?.currentRun?.id || null);
    if (pageKey === 'qa-evidence') openQaEvidence(pageStore.selectedRun?.id || workbench?.currentRun?.id || null);
    if (pageKey === 'run-artifacts') openRunArtifacts(pageStore.selectedRun?.id || workbench?.currentRun?.id || null);
    if (pageKey === 'character-assets') loadCharacterAssets();
    if (pageKey === 'video-library') loadVideoLibrary();
    if (pageKey === 'settings') loadSettings();
  }, [pageKey, workbench]);

  const currentPage = pageMeta[pageKey] || pageMeta.overview;

  const pageContent = useMemo(() => {
    if (!workbench) return null;

    switch (pageKey) {
      case 'projects':
        return (
          <ProjectsPage
            projects={pageStore.projects}
            selectedProject={pageStore.selectedProject}
            onSelectProject={loadProjects}
            onOpenProjectDetail={openProjectDetail}
            searchText={projectSearch}
            onSearchText={setProjectSearch}
          />
        );
      case 'project-detail':
        return (
          <ProjectDetailPage
            project={pageStore.selectedProject}
            selectedEpisode={pageStore.selectedEpisode}
            onSelectEpisode={(episode) =>
              openEpisodeDetail(pageStore.selectedProject.id, episode._key.split(':')[0], episode.id, episode)
            }
            onOpenQaEvidence={openQaEvidence}
            onOpenRunArtifacts={openRunArtifacts}
            onOpenRunLogs={(runId) => loadRuns(runId, true)}
          />
        );
      case 'run-logs':
        return (
          <RunLogsPage
            runs={pageStore.runs}
            selectedRun={pageStore.selectedRun}
            onSelectRun={loadRuns}
            searchText={runSearch}
            onSearchText={setRunSearch}
            statusFilter={runStatusFilter}
            onStatusFilter={setRunStatusFilter}
            onOpenQaEvidence={openQaEvidence}
            onOpenRunArtifacts={openRunArtifacts}
          />
        );
      case 'qa-evidence':
        return (
          <QaEvidenceRunPage
            runs={pageStore.runs}
            selectedRun={pageStore.selectedRun}
            qaDetail={pageStore.selectedRunQa}
            onSelectRun={openQaEvidence}
            searchText={qaSearch}
            onSearchText={setQaSearch}
          />
        );
      case 'run-artifacts':
        return (
          <RunArtifactsRunPage
            runs={pageStore.runs}
            selectedRun={pageStore.selectedRun}
            artifactDetail={pageStore.selectedRunArtifacts}
            onSelectRun={openRunArtifacts}
            searchText={artifactSearch}
            onSearchText={setArtifactSearch}
          />
        );
      case 'character-assets':
        return (
          <CharacterAssetsPage
            characterAssets={pageStore.characterAssets}
            selectedItem={pageStore.selectedCharacterAsset}
            searchText={characterSearch}
            onSearchText={setCharacterSearch}
            onSelect={(item) =>
              setPageStore((prev) => ({
                ...prev,
                selectedCharacterAsset: item,
              }))
            }
          />
        );
      case 'video-library':
        return (
          <VideoLibraryPage
            videoAssets={pageStore.videoAssets}
            selectedItem={pageStore.selectedVideoAsset}
            searchText={videoSearch}
            onSearchText={setVideoSearch}
            onSelect={(item) =>
              setPageStore((prev) => ({
                ...prev,
                selectedVideoAsset: item,
              }))
            }
          />
        );
      case 'settings':
        return (
          <SettingsPage
            settings={pageStore.settings}
            selectedItem={pageStore.selectedSettingItem}
            onSelect={(item) =>
              setPageStore((prev) => ({
                ...prev,
                selectedSettingItem: item,
              }))
            }
          />
        );
      case 'overview':
      default:
        return (
          <OverviewPage
            data={workbench}
            onOpenRunLogs={(runId) => loadRuns(runId, true)}
            onOpenQa={openQaEvidence}
            onOpenArtifacts={openRunArtifacts}
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
          />
        );
    }
  }, [
    artifactSearch,
    characterSearch,
    pageKey,
    pageStore,
    projectSearch,
    qaSearch,
    runSearch,
    runStatusFilter,
    videoSearch,
    viewMode,
    workbench,
  ]);

  if (error) {
    return (
      <div className="app">
        <main className="main app-error">
          <EmptyState title="工作台数据读取失败" message={error} />
        </main>
      </div>
    );
  }

  if (!workbench) {
    return (
      <div className="app">
        <main className="main app-loading">
          <EmptyState title="正在加载工作台" message="正在从本地运行产物整理当前状态。" />
        </main>
      </div>
    );
  }

  const currentRun = workbench.currentRun;

  return (
    <div className="app">
      <aside className="sidebar" aria-label="主导航">
        <div className="brand">
          <div className="brand-mark">
            <Clapperboard size={24} />
          </div>
          <div>
            <p className="brand-title">AI 视频工厂</p>
            <div className="brand-subtitle">Director Workbench</div>
          </div>
        </div>

        <ul className="nav-group">
          {navPrimary.map((item) => {
            const Icon = item.icon;
            const active = pageKey === item.key;
            return (
              <li key={item.key}>
                <button className={`nav-item${active ? ' active' : ''}`} onClick={() => (window.location.hash = item.key)}>
                  <Icon size={20} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="divider" />

        <ul className="nav-group">
          {navSecondary.map((item) => {
            const Icon = item.icon;
            const active = pageKey === item.key;
            return (
              <li key={item.key}>
                <button className={`nav-item${active ? ' active' : ''}`} onClick={() => (window.location.hash = item.key)}>
                  <Icon size={20} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <section className="side-card" aria-label="当前项目">
          <div className="side-card-label">当前运行</div>
          <strong>{currentRun.displayTitle}</strong>
          <p>{currentRun.sidebarSummary}</p>
          <div className="side-card-meta">
            <span className="side-meta-chip">进行中工作台</span>
            <span className="side-meta-chip">{currentRun.riskSummary}</span>
          </div>
          <div className="meter" aria-label="当前进度">
            <span style={{ '--progress-width': `${currentRun.progressPercent}%` }} />
          </div>
          <div className="side-card-foot">
            <span>完成度</span>
            <strong>{currentRun.progressPercent}%</strong>
          </div>
        </section>
      </aside>

      <main className={`main view-${viewMode}`}>
        <header className="topbar">
          <div>
            <div className="tabs" aria-label="工作区快捷入口">
              <button className="tab shortcut" onClick={() => (window.location.hash = 'overview')}>
                <BookOpen size={20} />
                当前运行
                <span className="badge">{workbench.summary.runCount}</span>
              </button>
              <button
                className="tab shortcut"
                onClick={() => (window.location.hash = 'projects')}
              >
                <FolderKanban size={20} />
                项目推进
                <span className="badge">{workbench.summary.projectCount}</span>
              </button>
              <button
                className="tab shortcut"
                onClick={() => (window.location.hash = 'run-logs')}
              >
                <ScrollText size={20} />
                运行排查
                <span className="badge">{workbench.summary.episodeCount}</span>
              </button>
            </div>
            <Breadcrumbs label={currentPage.label} />
          </div>

          <div className="toolbar">
            <button className="icon-button" aria-label="刷新数据" onClick={refreshWorkbench}>
              <RefreshCw size={20} />
            </button>
            <button className="secondary-button" onClick={() => openRunArtifacts(currentRun.id)}>
              <FolderOpen size={18} />
              查看运行包
            </button>
            <button className="primary-button" onClick={() => loadRuns(currentRun.id, true)}>
              <Play size={18} />
              继续当前运行
            </button>
          </div>
        </header>

        {pageContent}
      </main>
    </div>
  );
}

export default App;
