/**
 * P2d：Mastra workflow 编排壳。
 *
 * 设计（ADR，见 docs/refactor/P2任务书-编排单轨收敛.md §P2d）：
 * - 采用【单 plan step】策略（createEpisodePipelineWorkflow）：step 内部调用 runEpisodePipelineImpl。
 * - 规避 mastra-workflow-gotchas 五坑：
 *   坑1 无 HITL suspend，不涉及；坑2 不嵌套 run.start；
 *   坑3 step 返回对象必须携带 runId；
 *   坑4 run.start() 在 step throw 时 resolve 而非 reject → 调用方必须检查 run.status；
 *   坑5 本模块不 mock fetch；测试用 node --test 每文件独立进程。
 * - v1.64 实测（2026-09-04）：`workflow.createRun()` 返回 Promise<Run>，必须 await 后再调 run.start()。
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';

/**
 * 创建编排 workflow。
 * @param {Object} options
 * @param {(payload: {projectId: string, scriptId: string, episodeId: string, options: object}) => Promise<string>} options.executePipeline
 *        实际执行器（createDirector 闭包内的原始实现），由调用方注入，便于测试与解耦。
 * @param {string} [options.workflowId='director-episode-pipeline']
 * @returns Mastra Workflow 实例
 */
export function createEpisodePipelineWorkflow({ executePipeline, workflowId = 'director-episode-pipeline' } = {}) {
  if (typeof executePipeline !== 'function') {
    throw new Error('createEpisodePipelineWorkflow requires an executePipeline function');
  }

  const planStep = createStep({
    id: 'run_episode_pipeline',
    description: '按顺序执行全部 25+ 剧集阶段（P2d v1：单 step 承载 legacy 编排）',
    inputSchema: null,
    outputSchema: null,
    execute: async ({ inputData }) => {
      const { projectId, scriptId, episodeId, options = {} } = inputData || {};
      const outputPath = await executePipeline({ projectId, scriptId, episodeId, options });
      // 坑3：返回对象显式携带标识，避免下游依赖引擎内部 id
      return { outputPath: outputPath || null, runId: options.runAttemptId || null };
    },
  });

  return createWorkflow({
    id: workflowId,
    inputSchema: null,
    outputSchema: null,
    steps: [planStep],
  })
    .then(planStep)
    .commit();
}

/**
 * 以 workflow 方式执行一集流水线，并把结果翻译回 legacy 调用面契约：
 * - 成功：返回 outputPath（字符串，与 runEpisodePipeline 原契约一致）
 * - 失败：抛出原始错误（保持 caller 侧 catch 行为）
 *
 * 坑4 防御：run.start() 在 step 抛错时 resolve 而非 reject，因此必须检查
 * run.status === 'failed' 并从 step 结果中还原错误再抛出。
 */
export async function runEpisodeViaWorkflow(workflow, payload) {
  const run = await workflow.createRun();
  const result = await run.start({ inputData: payload });

  if (result?.status === 'failed') {
    // 从 step 结果还原错误：Mastra 把 step throw 记录在 step 结果里
    const stepResults = result?.steps || result?.results?.steps || {};
    let firstError = null;
    for (const stepResult of Object.values(stepResults)) {
      if (stepResult?.status === 'failed' && stepResult?.error) {
        firstError = stepResult.error;
        break;
      }
    }
    const message =
      (firstError && (firstError.message || String(firstError))) ||
      `Mastra workflow failed: ${workflow.id}`;
    throw new Error(message);
  }

  // 返回 outputPath（legacy single-step 契约）
  const stepResults = result?.steps || result?.results?.steps || {};
  const planOutput = stepResults['run_episode_pipeline']?.output;
  return planOutput?.outputPath ?? null;
}
