import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle, BookOpen, Image, Loader2 } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';
import type { WorkbenchCharacter, WorkbenchScene, CharacterRegistryEntry, ConsistencyReportEntry } from '../lib/workbench';

const DRIFT_TAG_LABELS: Record<string, string> = {
  outfit_drift: '服装漂移',
  hair_drift: '发型漂移',
  palette_drift: '配色漂移',
  face_mismatch: '面部不一致',
  identity_swap: '身份替换',
  age_feel_drift: '年龄感漂移',
  lighting_drift: '光照漂移',
};

const DRIFT_TAG_EMOJIS: Record<string, string> = {
  outfit_drift: '👔',
  hair_drift: '💇',
  palette_drift: '🎨',
  face_mismatch: '👤',
  identity_swap: '🔄',
  age_feel_drift: '📅',
  lighting_drift: '💡',
};

const AVATAR_EMOJIS = ['👩', '👨', '👴', '👧', '🧑', '👦', '👱', '👳'];
const AVATAR_GRADIENTS = [
  'from-rose-200 to-rose-300',
  'from-blue-200 to-blue-300',
  'from-purple-200 to-purple-300',
  'from-amber-200 to-amber-300',
  'from-teal-200 to-teal-300',
  'from-sky-200 to-sky-300',
  'from-pink-200 to-pink-300',
  'from-lime-200 to-lime-300',
];
const SCENE_GRADIENTS = [
  'from-amber-100 via-amber-300 to-amber-900',
  'from-sky-100 via-sky-300 to-sky-800',
  'from-slate-200 via-slate-400 to-slate-800',
  'from-emerald-100 via-emerald-300 to-emerald-800',
  'from-rose-100 via-rose-300 to-rose-800',
  'from-violet-100 via-violet-300 to-violet-800',
];
function idx(n: number) { return n % 8; }

function buildEnrichedCharacters(
  base: WorkbenchCharacter[],
  registry: CharacterRegistryEntry[],
  consistency: ConsistencyReportEntry[]
) {
  const regMap = new Map<string, CharacterRegistryEntry>();
  for (const character of registry) {
    for (const key of [character.episodeCharacterId, character.id, character.name]) {
      if (key && !regMap.has(key)) regMap.set(key, character);
    }
  }
  const conMap = new Map(consistency.map(c => [c.character, c]));

  return base.map((c, i) => {
    const reg = regMap.get(c.id) || regMap.get(c.name);
    const con = conMap.get(c.name);
    const driftTags = con?.identityDriftTags || [];
    const anchor = reg?.identityAnchor || '';
    const rawDesc = c.visualDescription !== '未记录视觉描述' ? c.visualDescription : (reg?.visualDescription || '');
    const personalityTags = describePersonality(c.personality);
    const anchorTraits = describeTraitsFromAnchor(anchor);
    const anchorOutfits = describeOutfitsFromAnchor(anchor);
    return {
      id: c.id,
      name: c.name,
      role: reg?.priority === 'lead' ? '主角' : reg?.priority === 'support' ? '配角' : '客串',
      roleType: reg?.priority === 'lead' ? 'lead' as const : 'supporting' as const,
      /* 英文原始数据（供 LLM 使用，UI 不直接展示） */
      rawPromptTokens: reg?.basePromptTokens || c.promptTokens,
      rawIdentityAnchor: anchor,
      rawVisualDescription: rawDesc,
      /* 中文展示字段 */
      displayDescription: rawDesc ? `${rawDesc.slice(0, 60)}${rawDesc.length > 60 ? '…' : ''}` : '暂无角色描述',
      displayTags: [...personalityTags, ...anchorTraits].slice(0, 4),
      episodes: extractEpisodes(c),
      drift: con && con.overallScore < 8 ? {
        episode: '当前集',
        field: driftTags[0] || '外观',
        expected: '',
        actual: '',
        description: con.suggestion || `一致性评分 ${con.overallScore}/10，检测到 ${driftTags.map(t => DRIFT_TAG_LABELS[t] || t).join('、')}`,
        score: con.overallScore,
        tags: driftTags,
      } : undefined,
      /* 中文展示字段 */
      displayTraits: personalityTags.length ? personalityTags : (anchorTraits.length ? anchorTraits : ['暂无详细特征数据']),
      displayOutfits: anchorOutfits.length ? anchorOutfits : ['暂无服装锚点数据（运行 character-registry agent 后可获取）'],
      avatarEmoji: AVATAR_EMOJIS[idx(i)],
      avatarGradient: AVATAR_GRADIENTS[idx(i)],
      registry: reg,
      consistency: con,
    };
  });
}

const EN_ZH_TAG: Record<string, string> = {
  'hair': '发型', 'eyes': '眼睛', 'face': '面部', 'skin': '皮肤',
  'wear': '穿着', 'coat': '外套', 'jacket': '夹克', 'shirt': '衬衫',
  'pants': '裤子', 'boots': '靴子', 'robe': '长袍', 'suit': '西装',
  'armor': '盔甲', 'dress': '连衣裙', 'scarf': '围巾', 'hat': '帽子',
  'young': '年轻', 'old': '年长', 'tall': '高大', 'short': '矮小',
  'slim': '苗条', 'muscular': '健壮', 'pale': '苍白', 'dark': '深色',
  'black': '黑色', 'white': '白色', 'gray': '灰色', 'brown': '棕色',
  'long': '长', 'messy': '凌乱', 'neat': '整洁',
  'sharp': '锐利', 'soft': '柔和', 'cold': '冷峻', 'warm': '温暖',
  'leather': '皮革', 'cotton': '棉质', 'silk': '丝绸', 'denim': '牛仔',
  'tactical': '战术', 'combat': '战斗', 'casual': '休闲', 'formal': '正式',
  'traditional': '传统', 'modern': '现代', 'simple': '简约',
};

function translateTag(en: string): string {
  const lower = en.toLowerCase();
  for (const [key, zh] of Object.entries(EN_ZH_TAG)) {
    if (lower.includes(key)) return zh;
  }
  return en;
}

function describeTraitsFromAnchor(anchor: string): string[] {
  const parts = anchor.split(',').map(s => s.trim()).filter(Boolean);
  const groups: string[] = [];
  const hair = parts.find(p => /hair/i.test(p));
  const eyes = parts.find(p => /eye/i.test(p));
  const outfit = parts.find(p => /wear|coat|jacket|shirt|pants|boots|robe|suit|armor/i.test(p));
  if (hair) groups.push(`发型：${hair}`);
  if (eyes) groups.push(`眼部：${eyes}`);
  if (outfit) groups.push(`着装：${outfit}`);
  return groups;
}

function describeOutfitsFromAnchor(anchor: string): string[] {
  const parts = anchor.split(',').map(s => s.trim());
  const outfitParts = parts.filter(p => /wear|coat|jacket|shirt|pants|boots|robe|suit|armor|dress|scarf|hat/i.test(p));
  if (!outfitParts.length) return [];
  return outfitParts.map(p => {
    const zh = translateTag(p);
    return zh !== p ? `${zh}（${p}）` : p;
  });
}

function describePersonality(personality: string): string[] {
  const p = personality || '';
  if (!p || p === '未记录') return [];
  return p.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
}

function extractEpisodes(c: WorkbenchCharacter): string[] {
  const eps = c.scenes.length > 0 ? ['当前集'] : [];
  return eps;
}

function buildEnrichedScenes(
  base: WorkbenchScene[],
  enrichedChars: ReturnType<typeof buildEnrichedCharacters>
) {
  const charDriftMap = new Map(enrichedChars.filter(c => c.drift).map(c => [c.name, c.drift!]));
  const charConMap = new Map(enrichedChars.filter(c => c.consistency).map(c => [c.name, c.consistency!]));

  return base.map((s, i) => {
    const castScores = s.cast.map(name => charConMap.get(name)?.overallScore).filter((s): s is number => s !== undefined);
    const avgScore = castScores.length > 0 ? Math.round(castScores.reduce((a, b) => a + b, 0) / castScores.length * 10) / 10 : null;
    const driftTags = [...new Set(s.cast.flatMap(name => charDriftMap.get(name)?.tags || []))];
    const passThreshold = avgScore !== null && avgScore >= 7;
    const hasIssues = (s.validationIssues || []).length > 0;

    return {
      id: s.id,
      title: s.title,
      description: `${s.goal !== '未记录场景目标' ? s.goal : ''}${s.location !== '未记录空间锚点' ? ` · ${s.location}` : ''}`,
      sourceEpisode: '当前运行',
      reusedEpisodes: [] as string[],
      status: s.validationStatus === 'pass' ? 'locked' as const : 'pending' as const,
      gradient: SCENE_GRADIENTS[i % SCENE_GRADIENTS.length],
      cast: s.cast,
      shotCount: s.shotCount,
      imageUrl: s.imageUrl,
      visualMotif: s.visualMotif,
      validationIssues: s.validationIssues,
      continuityScore: avgScore,
      continuityTags: driftTags,
      continuityOk: passThreshold && !hasIssues,
    };
  });
}

function isEmptyProject(project: { characters: unknown[]; scenes: unknown[]; shots: unknown[] }) {
  return project.characters.length === 0 && project.scenes.length === 0 && project.shots.length === 0;
}

function CharAvatar({ emoji, gradient }: { emoji: string; gradient: string }) {
  return (
    <div className={`flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} border-2 border-white text-[28px] shadow-md`}>
      <span>{emoji}</span>
    </div>
  );
}

export default function AssetLibrary() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { project, loading, error } = useWorkbenchProject(projectId);
  const [expandedChars, setExpandedChars] = useState<Set<string>>(new Set());

  const enriched = useMemo(() => {
    if (!project) return null;
    const assetEnrich = project.assetEnrichment || { characterRegistry: [], consistencyReports: [] };
    const chars = buildEnrichedCharacters(
      project.characters,
      assetEnrich.characterRegistry,
      assetEnrich.consistencyReports
    );
    return {
      characters: chars,
      scenes: buildEnrichedScenes(project.scenes, chars),
      hasEnrichment: assetEnrich.characterRegistry.length > 0,
    };
  }, [project]);

  const toggleChar = (id: string) => {
    setExpandedChars(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Loading / Error states
  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 size={32} className="animate-spin text-cyan-500" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="glass-card mx-auto mt-12 max-w-lg p-10 text-center">
        <AlertTriangle size={40} className="mx-auto mb-3 text-amber-400" />
        <p className="text-sm font-bold text-slate-700">加载失败</p>
        <p className="mt-1 text-xs text-slate-400">{error || '项目不存在'}</p>
        <button
          onClick={() => navigate('/projects')}
          className="mt-4 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          返回项目列表
        </button>
      </div>
    );
  }

  if (isEmptyProject(project)) {
    return (
      <div className="mx-auto max-w-6xl pt-8">
        <header className="mb-6">
          <button onClick={() => navigate(`/project/${projectId}`)} className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900">
            <ArrowLeft size={18} />返回项目详情
          </button>
          <h1 className="font-heading text-2xl font-extrabold text-slate-900">资产库</h1>
        </header>
        <div className="glass-card p-16 text-center">
          <BookOpen size={56} className="mx-auto mb-4 text-slate-300" />
          <p className="text-lg font-bold text-slate-600">暂无资产数据</p>
          <p className="mt-2 text-sm text-slate-400">先运行 Director 流水线生成角色和场景数据后，资产库会自动展示。</p>
        </div>
      </div>
    );
  }

  const chars = enriched!.characters;
  const scenes = enriched!.scenes;
  const hasEnrichment = enriched!.hasEnrichment;


  return (
    <div className="mx-auto max-w-6xl pt-2">
      {/* Breadcrumb */}
      <nav className="mb-5 flex items-center gap-2 text-xs font-semibold text-slate-400">
        <span className="cursor-pointer transition hover:text-cyan-600" onClick={() => navigate('/projects')}>项目列表</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
        <span className="cursor-pointer transition hover:text-cyan-600" onClick={() => navigate(`/project/${projectId}`)}>{project.title}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
        <span className="text-cyan-600">资产库</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-6">
        <div>
          <button onClick={() => navigate(`/project/${projectId}`)} className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900">
            <ArrowLeft size={18} />返回项目详情
          </button>
          <h1 className="font-heading text-2xl font-extrabold text-slate-900">资产库</h1>
          <p className="mt-1 text-sm font-medium text-slate-400">
            {hasEnrichment ? '基于当前 run 的角色注册表与一致性报告' : '基于当前 run 的 snapshot 数据（运行更多 agent 可获取丰富资产信息）'}
          </p>
        </div>
      </div>

      <div className="animate-in">
          {/* Stats */}
          <div className="mb-7 grid grid-cols-3 gap-3">
            {[
              { label: '角色圣经', value: chars.length.toString(), warn: false },
              { label: '可复用场景', value: scenes.length.toString(), warn: false },
              { label: '一致性覆盖', value: hasEnrichment ? `${Math.round(chars.filter(c => !c.drift).length / Math.max(chars.length, 1) * 100)}%` : '待运行', warn: !hasEnrichment },
            ].map(stat => (
              <div key={stat.label} className="glass-card-static rounded-2xl p-4">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{stat.label}</div>
                <div className={`stat-number font-heading text-3xl font-extrabold ${stat.warn ? '!text-amber-500' : ''}`}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          {/* Character Bibles */}
          <section className="mb-9">
            <div className="section-header mb-4 flex items-center gap-2">
              <BookOpen size={16} className="text-cyan-600" />
              <h2 className="text-sm font-extrabold text-slate-900">角色圣经</h2>
              <span className="count-badge">{chars.length} 个角色</span>
              <div className="flex-1" />
              {!hasEnrichment && (
                <span className="text-[10px] font-semibold text-amber-500">基础模式（运行 Director 后可获取完整资产信息）</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              {chars.map((char) => {
                const isOpen = expandedChars.has(char.id);
                return (
                  <div key={char.id} className="glass-card cursor-pointer p-5" onClick={() => toggleChar(char.id)}>
                    <div className="flex gap-4">
                      <CharAvatar emoji={char.avatarEmoji} gradient={char.avatarGradient} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-extrabold text-slate-900">{char.name}</span>
                          <span className={`badge-sm ${char.roleType === 'lead' ? 'badge-rose' : 'badge-violet'}`}>{char.role}</span>
                        </div>
                        <p className="mb-2 text-xs leading-relaxed text-slate-400">{char.displayDescription}</p>
                        <div className="mb-2 flex flex-wrap gap-1">
                          {char.displayTags.map(tag => (
                            <span key={tag} className="badge-sm badge-cyan">{tag}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400">关联集数</span>
                          {char.episodes.map(ep => (
                            <span key={ep} className="badge-sm badge-blue">{ep}</span>
                          ))}
                          {char.drift ? (
                            <span className="badge-sm badge-amber cursor-pointer">⚠ 漂移 ({(char.drift.score).toFixed(1)})</span>
                          ) : hasEnrichment ? (
                            <span className="badge-sm badge-emerald">✓ 继承正常</span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Expandable detail */}
                    <div className={`expand-section ${isOpen ? 'open' : ''}`}>
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <div className="mb-3 grid grid-cols-2 gap-3">
                          <div>
                            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">核心特征</div>
                            <div className="space-y-1 text-xs text-slate-600">
                              {char.displayTraits.map(t => <div key={t}>{t}</div>)}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">服装锚点</div>
                            <div className="space-y-1 text-xs text-slate-600">
                              {char.displayOutfits.map(o => <div key={o}>{o}</div>)}
                            </div>
                          </div>
                        </div>

                        {char.drift ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                            <div className="flex items-start gap-2.5">
                              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold text-amber-800">一致性检测 (评分 {char.drift.score.toFixed(1)}/10)</div>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                  {char.drift.tags.map(tag => (
                                    <span key={tag} className="badge-sm badge-amber text-[9px]">
                                      {DRIFT_TAG_EMOJIS[tag] || ''} {DRIFT_TAG_LABELS[tag] || tag}
                                    </span>
                                  ))}
                                </div>
                                <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">{char.drift.description}</p>
                              </div>
                            </div>
                          </div>
                        ) : hasEnrichment ? (
                          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
                            <CheckCircle size={16} className="text-emerald-500" />
                            <div className="text-xs font-bold text-emerald-800">一致性正常，未检测到漂移</div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                            <BookOpen size={16} className="text-slate-400" />
                            <div className="text-xs text-slate-500">运行 pipeline 后获取详细一致性数据</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Scene Assets */}
          <section>
            <div className="section-header mb-4 flex items-center gap-2">
              <Image size={16} className="text-teal-600" />
              <h2 className="text-sm font-extrabold text-slate-900">场景资产</h2>
              <span className="count-badge">{scenes.length} 个场景</span>
              <div className="flex-1" />
              <span className="text-xs font-semibold text-slate-400">当前 run 场景包</span>
            </div>
            <div className="grid grid-cols-3 gap-3.5">
              {scenes.map(scene => (
                <div key={scene.id} className="glass-card overflow-hidden p-0">
                  {/* 场景图片 */}
                  <div className={`relative aspect-video w-full ${scene.imageUrl ? '' : `bg-gradient-to-br ${scene.gradient}`}`}>
                    {scene.imageUrl ? (
                      <img src={scene.imageUrl} alt={scene.title} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <span className="text-3xl font-black text-white/30">{scene.shotCount}镜</span>
                      </div>
                    )}
                    {/* 连续性徽章 */}
                    {scene.continuityOk !== null && (
                      <div className="absolute right-2 top-2">
                        {scene.continuityOk ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/90 px-2 py-0.5 text-[9px] font-bold text-emerald-700">✓ 场景连续</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/90 px-2 py-0.5 text-[9px] font-bold text-amber-700">⚠ 注意复核</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-3.5">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-extrabold text-slate-900">{scene.title}</span>
                      <span className={`badge-sm ${scene.status === 'locked' ? 'badge-emerald' : 'badge-amber'}`}>
                        {scene.status === 'locked' ? '已锁定' : '待确认'}
                      </span>
                    </div>
                    <p className="mb-2 text-xs leading-relaxed text-slate-400">{scene.description}</p>
                    {/* visualMotif */}
                    {scene.visualMotif && scene.visualMotif !== '未记录视觉母题' && (
                      <div className="mb-2 text-[10px] text-slate-400 font-medium">🎨 {scene.visualMotif}</div>
                    )}
                    {/* validationIssues */}
                    {scene.validationIssues.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {scene.validationIssues.map((issue, ii) => (
                          <span key={ii} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[8px] font-semibold text-amber-600">{issue}</span>
                        ))}
                      </div>
                    )}
                    {/* 一致性评分 */}
                    {scene.continuityScore !== null && (
                      <div className="mb-2 text-[10px] text-slate-400">
                        角色一致性：<span className={`font-bold ${scene.continuityScore >= 7 ? 'text-emerald-600' : 'text-amber-600'}`}>{scene.continuityScore.toFixed(1)}/10</span>
                        {scene.continuityTags.length > 0 && (
                          <span className="ml-1 text-amber-500">{scene.continuityTags.map(t => DRIFT_TAG_LABELS[t] || t).join('、')}</span>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {scene.cast.length > 0 && scene.cast.map(name => (
                        <span key={name} className="badge-sm badge-slate">{name}</span>
                      ))}
                      <span className="badge-sm badge-blue">{scene.sourceEpisode}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
    </div>
  );
}
