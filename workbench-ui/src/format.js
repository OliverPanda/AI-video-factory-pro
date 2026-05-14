export function formatDateTime(value) {
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

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '暂无耗时信息';
  if (seconds < 60) return `耗时 ${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return `耗时约 ${minutes} 分钟`;
}

export function statusClass(status) {
  if (status === 'pass' || status === 'completed') return 'pass';
  if (status === 'warn') return 'warn';
  if (status === 'block' || status === 'failed') return 'block';
  return 'running';
}

export function statusLabel(status) {
  if (status === 'pass' || status === 'completed') return '通过';
  if (status === 'warn') return '提醒';
  if (status === 'block' || status === 'failed') return '阻断';
  if (status === 'running') return '运行中';
  return '待处理';
}
