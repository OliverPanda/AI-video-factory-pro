function createIcon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function formatDateTime(value) {
  if (!value) return '暂无时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '暂无耗时信息';
  if (seconds < 60) return `耗时 ${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return `耗时约 ${minutes} 分钟`;
}

function statusClass(status) {
  if (status === 'pass' || status === 'completed') return 'pass';
  if (status === 'warn') return 'warn';
  if (status === 'block' || status === 'failed') return 'block';
  return 'running';
}

function statusLabel(status) {
  if (status === 'pass' || status === 'completed') return '通过';
  if (status === 'warn') return '提醒';
  if (status === 'block' || status === 'failed') return '阻断';
  if (status === 'running') return '运行中';
  return '待处理';
}

function progressClass(status) {
  if (status === 'pass') return 'done';
  if (status === 'warn') return 'warn';
  if (status === 'block') return 'block';
  if (status === 'running') return 'running';
  return 'pending';
}

function renderStageItems(targets, stageKey, stage) {
  const container = targets[stageKey];
  if (!container) return;

  const caption = document.getElementById(`${stageKey}-caption`);
  if (caption) {
    caption.textContent = `${stage.items.length} 个任务`;
  }

  if (!stage.items.length) {
    container.innerHTML = `
      <div class="empty-state">
        ${createIcon('inbox')}
        <div>
          <strong>这个阶段目前没有任务</strong>
          <div>后端产物里暂时没有对应步骤，等下一轮 run 生成后会自动出现。</div>
        </div>
      </div>
    `;
    return;
  }

  const progressLabel = document.getElementById(`${stageKey}-progress`);
  if (progressLabel && stage.progress) {
    progressLabel.textContent = `${stage.progress.completedCount}/${stage.progress.totalCount} 已完成`;
  }

  const flowContainer = document.getElementById(`${stageKey}-flow`);
  if (flowContainer && stage.progress) {
    flowContainer.innerHTML = stage.progress.flow
      .map((item) => `<span class="flow-node ${progressClass(item.status)}">${item.label}</span>`)
      .join('<span class="flow-arrow">-></span>');
  }

  container.innerHTML = stage.items
    .map((item, index) => {
      const chipType = statusClass(item.status);
      const cardClass = index === 0 ? 'run-card highlight' : 'run-card';
      return `
        <button class="${cardClass}">
          <div class="run-top">
            <span>${item.stepLabel}</span>
            <span class="status-pill ${chipType}">${statusLabel(item.status)}</span>
          </div>
          <h3>${item.title}</h3>
          <p>${item.summary}</p>
          <div class="run-meta">
            ${item.meta.map((meta) => `<span class="chip ${meta.type}">${meta.label}</span>`).join('')}
          </div>
          <div class="run-footer">
            <span>${item.agent}</span>
            <span>${formatDateTime(item.finishedAt || item.startedAt)}</span>
          </div>
          <div class="run-actions">
            <span class="mini-button primary">${createIcon('play')} ${item.primaryAction || '查看详情'}</span>
            <span class="mini-button secondary">${createIcon('folder-open')} ${item.secondaryAction || '查看产物'}</span>
          </div>
        </button>
      `;
    })
    .join('');
}

export function renderWorkbench(data, targets) {
  document.getElementById('tab-runs-count').textContent = String(data.summary.runCount);
  document.getElementById('tab-project-count').textContent = String(data.summary.projectCount);
  document.getElementById('tab-episode-count').textContent = String(data.summary.episodeCount);

  document.getElementById('side-project-title').textContent = data.currentRun.displayTitle;
  document.getElementById('side-project-summary').textContent = data.currentRun.sidebarSummary;
  document.getElementById('side-progress-bar').style.setProperty('--progress-width', `${data.currentRun.progressPercent}%`);

  document.getElementById('coach-title').textContent = data.currentRun.coachTitle;
  document.getElementById('coach-summary').textContent = data.currentRun.coachSummary;
  document.getElementById('primary-action').innerHTML = `${createIcon('play')} ${data.currentRun.primaryAction}`;
  document.getElementById('focus-title').textContent = data.currentRun.focusTitle;
  document.getElementById('focus-summary').textContent = data.currentRun.focusSummary;

  document.getElementById('stat-projects').textContent = String(data.summary.projectCount);
  document.getElementById('stat-runs').textContent = String(data.summary.runCount);
  document.getElementById('stat-pass').textContent = String(data.summary.passCount);
  document.getElementById('stat-block').textContent = String(data.summary.blockCount);

  document.getElementById('stats-run-count').textContent = `共 ${data.summary.runCount} 个 run`;
  document.getElementById('stats-duration').textContent = formatDuration(data.currentRun.durationSec);
  document.getElementById('stats-risk').textContent = data.currentRun.riskSummary;

  renderStageItems(targets, 'preproduction', data.currentRun.stages.preproduction);
  renderStageItems(targets, 'video', data.currentRun.stages.video);
  renderStageItems(targets, 'delivery', data.currentRun.stages.delivery);
}

export function renderWorkbenchError(targets, message) {
  const errorHtml = `
    <div class="empty-state">
      ${createIcon('triangle-alert')}
      <div>
        <strong>工作台数据读取失败</strong>
        <div>${message}</div>
      </div>
    </div>
  `;

  Object.values(targets).forEach((element) => {
    element.innerHTML = errorHtml;
  });
}
