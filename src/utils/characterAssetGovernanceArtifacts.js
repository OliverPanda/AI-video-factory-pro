import fs from 'node:fs';
import path from 'node:path';

import {
  buildCharacterAssetGovernanceMarkdown,
  buildReferenceSummary,
} from '../domain/characterAssetGovernance.js';
import { ensureDir, saveJSON } from './fileHelper.js';
import { writeAgentQaSummary } from './qaSummary.js';

function writeTextFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function writeCharacterAssetGovernanceArtifacts(report, artifactContext) {
  if (!artifactContext || !report) {
    return null;
  }

  saveJSON(path.join(artifactContext.outputsDir, 'character-asset-governance.json'), report);
  saveJSON(path.join(artifactContext.outputsDir, 'asset-audit-log.json'), report.auditEntries || []);
  saveJSON(path.join(artifactContext.outputsDir, 'canonical-reference-summary.json'), buildReferenceSummary(report.records));
  writeTextFile(
    path.join(artifactContext.outputsDir, 'character-asset-governance.md'),
    buildCharacterAssetGovernanceMarkdown(report)
  );
  saveJSON(path.join(artifactContext.metricsDir, 'character-asset-governance-metrics.json'), report.summary || {});
  saveJSON(artifactContext.manifestPath, {
    status: report.status === 'block' ? 'completed_with_warnings' : 'completed',
    characterCount: report.summary?.characterCount || 0,
    reviewCount: report.summary?.reviewCount || 0,
    blockedCount: report.summary?.blockedCount || 0,
    outputFiles: [
      'character-asset-governance.json',
      'character-asset-governance.md',
      'asset-audit-log.json',
      'canonical-reference-summary.json',
      'character-asset-governance-metrics.json',
    ],
  });
  writeAgentQaSummary(
    {
      agentKey: 'characterAssetGovernance',
      agentName: 'Character Asset Governance',
      status: report.status,
      headline:
        report.status === 'pass'
          ? '角色资产治理已通过'
          : `角色资产治理发现 ${report.summary?.reviewCount || 0} 个待复核、${report.summary?.blockedCount || 0} 个阻断`,
      summary: '角色资产治理负责确认角色是否具备可跨集复用的身份 ID、版本化资产和 canonical refs。',
      passItems: [`可复用资产数：${report.summary?.reusableAssetCount || 0}`],
      warnItems:
        report.status === 'warn'
          ? [`待复核角色：${report.summary?.reviewCount || 0}`]
          : [],
      blockItems:
        report.status === 'block'
          ? [`阻断角色：${report.summary?.blockedCount || 0}`]
          : [],
      nextAction:
        report.status === 'pass'
          ? '可以继续进入生成与 QA。'
          : '先处理 character-asset-governance.json 中的待复核角色，再决定是否跨集复用。',
      evidenceFiles: [
        '1-outputs/character-asset-governance.json',
        '1-outputs/asset-audit-log.json',
      ],
      metrics: report.summary || {},
    },
    artifactContext
  );

  return report;
}

export default {
  writeCharacterAssetGovernanceArtifacts,
};
