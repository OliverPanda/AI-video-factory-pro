import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Mic, PlayCircle, UserRound } from 'lucide-react';

import { useWorkbenchProject } from '../hooks/useWorkbench';

export default function VoiceManager() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { project, loading, error } = useWorkbenchProject(projectId);

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return <div className="glass-card p-6 text-sm text-red-600">配音数据加载失败{error ? `：${error}` : ''}。</div>;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <button
            onClick={() => navigate(`/drama/${project.id}`)}
            className="mb-4 inline-flex items-center gap-2 text-sm text-slate-500 transition hover:text-slate-900"
          >
            <ArrowLeft size={18} />
            返回项目详情
          </button>
          <h1 className="text-2xl font-bold text-slate-900 font-heading">配音管理</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            这里按当前 run 的 `audioVoiceResolution` 聚合真实配音入口。试听按钮直接播放实际产物，不走 mock，也不假设存在旧版配音管理接口。
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <div className="font-medium">真实音频产物</div>
          <div className="mt-1 text-xs text-amber-600/80">{project.voices.length} 个说话人/音轨入口</div>
        </div>
      </header>

      {project.voices.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <Mic className="mx-auto mb-4 text-slate-300" size={56} />
          <p className="text-lg text-slate-600">当前 run 没有可展示的配音结果</p>
          <p className="mt-2 text-sm text-slate-400">先确认 TTS 阶段是否已产出 `audioVoiceResolution` 和音频文件。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {project.voices.map((voice) => (
            <article key={voice.id} className="glass-card p-5">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100">
                    <Mic className="text-amber-600" size={26} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{voice.name}</h2>
                    <div className="mt-1 text-xs text-slate-400">
                      {voice.provider} · {voice.gender} · {voice.segmentCount} 段对白 · {voice.shotCount} 个镜头
                    </div>
                  </div>
                </div>

                <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">音源类型</div>
                    <div className="text-sm text-slate-600">{voice.voiceSource}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">角色绑定</div>
                    <div className="flex flex-wrap gap-2">
                      {voice.characterNames.length ? (
                        voice.characterNames.map((name) => (
                          <span
                            key={name}
                            className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs text-indigo-700"
                          >
                            <UserRound size={12} />
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-slate-400">非角色口播或系统音</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Fallback</div>
                    <div className="text-sm text-slate-600">{voice.fallbackUsed ? '使用默认兜底音色' : '未使用兜底'}</div>
                  </div>
                </div>

                <div className="min-w-[260px]">
                  {voice.sampleAudioUrl ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-400">
                        <PlayCircle size={14} />
                        试听样本
                      </div>
                      <audio className="w-full" controls src={voice.sampleAudioUrl} preload="none" />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-400">
                      当前没有可直接试听的音频样本
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
