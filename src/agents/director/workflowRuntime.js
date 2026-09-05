/**
 * P2d：Mastra workflow 编排壳（v1 + v2 multi-step）。
 *
 * 设计（ADR，见 docs/refactor/P2任务书-编排单轨收敛.md §P2d）：
 * - v1 采用【单 plan step】策略（createEpisodePipelineWorkflow）：step 内部调用 runEpisodePipelineImpl。
 * - v2 采用【多 step】策略（createMultiStepPipelineWorkflow）：每个 step 调用独立 stage 函数。
 *   D1 state-as-store：step 间通过 state.json 传递数据，Mastra 只做编排拓扑与 run 记录。
 *   D3 stopAt 短路：stage 设置 ctx.stopStatus，后续 step 检查后跳过。
 * - 规避 mastra-workflow-gotchas 五坑：
 *   坑1 无 HITL suspend，不涉及；坑2 不嵌套 run.start；
 *   坑3 step 返回对象必须携带 runId；
 *   坑4 run.start() 在 step throw 时 resolve 而非 reject → 调用方必须检查 run.status；
 *   坑5 本模块不 mock fetch；测试用 node --test 每文件独立进程。
 * - v1.64 实测（2026-09-04）：`workflow.createRun()` 返回 Promise<Run>，必须 await 后再调 run.start()。
 */

import path from 'node:path';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  createPipelineCtx,
  executeLoadAssetsStage,
  executeCharacterRegistryStage,
  executeGenerateRefSheetsStage,
} from './runtimeSupport.js';

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
 * P2d v2：创建多 step 编排 workflow（Batch 1：load_assets + character_registry + generate_ref_sheets）。
 *
 * 设计要点：
 * - D1 state-as-store：每个 step 从 state.json 读取输入，执行 stage 函数，将结果写回 state.json。
 * - D3 stopAt 短路：每个 step 开头检查 stopStatus，已停止则跳过后续。
 * - deps 通过 closure 注入（由 createDirector 提供），不经 Mastra inputData 序列化。
 *
 * @param {Object} options
 * @param {Object} options.deps - 依赖注入（saveJSON/loadJSON/logger 等），由 createDirector 提供
 * @param {string} [options.workflowId='director-episode-pipeline']
 * @returns Mastra Workflow 实例
 */
export function createMultiStepPipelineWorkflow({ deps, workflowId = 'director-episode-pipeline' } = {}) {
  if (!deps) {
    throw new Error('createMultiStepPipelineWorkflow requires deps');
  }

  /**
   * 从输入参数计算 stateFile 路径（每个 step 独立计算，保证一致性）。
   */
  function computeStateFile(options) {
    const jobId = options.jobId || deps.generateJobId(`${options.scriptId || ''}_${options.episodeId || ''}`);
    const dirs = deps.initDirs(jobId);
    return { stateFile: path.join(dirs.root, 'state.json'), jobId, dirs };
  }

  /**
   * 创建 step 的通用包装：加载 state → 创建 ctx → 检查 stop → 执行 stage → 保存 state。
   */
  function wrapStageStep(stepId, stageFn, extraParamsFn) {
    return createStep({
      id: stepId,
      description: `P2d v2 stage: ${stepId}`,
      inputSchema: null,
      outputSchema: null,
      execute: async ({ inputData }) => {
        const { projectId, scriptId, episodeId, options = {} } = inputData || {};
        const runStartedAt = options.startedAt || new Date().toISOString();

        // 从输入参数计算 stateFile（与 load_assets 阶段一致）
        const { stateFile, jobId, dirs } = computeStateFile({ ...options, scriptId, episodeId });

        // 加载 state 并创建 pipelineCtx
        const loadedState = deps.loadJSON(stateFile) || {};
        const ctx = createPipelineCtx({ loadedState, deps, stateFile });
        ctx.style = options.style || process.env.IMAGE_STYLE || 'realistic';
        ctx.jobId = jobId;
        ctx.pipelineOptions = options;

        // D3 stopAt 短路：如果 pipeline 已停止，跳过本 step
        if (ctx.stopStatus || loadedState.stopStatus) {
          return {
            runId: ctx.runJobRef?.id || null,
            stopped: true,
            stopStatus: ctx.stopStatus || loadedState.stopStatus,
          };
        }

        // 执行 stage 函数
        const extraParams = extraParamsFn({ projectId, scriptId, episodeId, options, runStartedAt, dirs });
        await stageFn(ctx, deps, extraParams);

        return {
          runId: ctx.runJobRef?.id || null,
          stopped: !!ctx.stopStatus,
          stopStatus: ctx.stopStatus || null,
        };
      },
    });
  }

  // Batch 1：3 个 stage step
  const loadAssetsStep = wrapStageStep(
    'load_assets',
    executeLoadAssetsStage,
    ({ projectId, scriptId, episodeId, options, runStartedAt }) => ({
      projectId, scriptId, episodeId, options, runStartedAt,
    })
  );

  const characterRegistryStep = wrapStageStep(
    'character_registry',
    executeCharacterRegistryStage,
    () => ({})
  );

  const generateRefSheetsStep = wrapStageStep(
    'generate_ref_sheets',
    executeGenerateRefSheetsStage,
    ({ options, scriptId, episodeId }) => {
      const { dirs } = computeStateFile({ ...options, scriptId, episodeId });
      return { dirs };
    }
  );

  return createWorkflow({
    id: workflowId,
    inputSchema: null,
    outputSchema: null,
    steps: [loadAssetsStep, characterRegistryStep, generateRefSheetsStep],
  })
    .then(loadAssetsStep)
    .then(characterRegistryStep)
    .then(generateRefSheetsStep)
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

  const stepResults = result?.steps || result?.results?.steps || {};

  // 检查是否有 step 返回了 stopStatus（D3 stopAt 短路）
  for (const stepResult of Object.values(stepResults)) {
    if (stepResult?.output?.stopStatus) {
      return { status: stepResult.output.stopStatus, stopped: true };
    }
  }

  // 优先查找 multi-step 结果（load_assets 是第一个 step）
  const loadAssetsOutput = stepResults['load_assets']?.output;
  if (loadAssetsOutput && !loadAssetsOutput.stopped) {
    // multi-step 成功完成，从最后一个有 output 的 step 获取结果
    const lastStepOutput = stepResults['generate_ref_sheets']?.output || loadAssetsOutput;
    return lastStepOutput?.outputPath ?? lastStepOutput ?? null;
  }

  // 回退到 legacy single-step 结果
  const planOutput = stepResults['run_episode_pipeline']?.output;
  return planOutput?.outputPath ?? null;
}
