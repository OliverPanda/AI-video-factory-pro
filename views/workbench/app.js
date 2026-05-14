import { fetchWorkbench } from './api.js';
import { renderWorkbench, renderWorkbenchError } from './render.js';
import { workbenchState } from './state.js';

const stageTargets = {
  preproduction: document.getElementById('preproduction-list'),
  video: document.getElementById('video-list'),
  delivery: document.getElementById('delivery-list'),
};

async function loadWorkbench() {
  try {
    const data = await fetchWorkbench();
    workbenchState.setData(data);
    renderWorkbench(data, stageTargets);
  } catch (error) {
    renderWorkbenchError(stageTargets, error.message || '未知错误');
  } finally {
    window.lucide?.createIcons();
  }
}

document.getElementById('refresh-button').addEventListener('click', () => {
  loadWorkbench();
});

window.lucide?.createIcons();
loadWorkbench();
