import { Activity, Cpu, Server, ShieldCheck } from 'lucide-react';

import { useProviderSettings } from '../hooks/useWorkbench';

export default function SettingsPage() {
  const { settings, loading, error } = useProviderSettings();

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (!settings) {
    return <div className="glass-card p-6 text-sm text-red-600">加载设置失败{error ? `：${error}` : ''}。</div>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs text-cyan-600">
          <ShieldCheck size={14} />
          当前后端模式：{settings.mode}
        </div>
        <h1 className="text-3xl font-bold text-slate-900 font-heading">系统设置</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
          这页现在按 `/api/settings/providers` 读取真实工作台配置。由于当前后端是只读 workbench，本页不再提供旧版保存、代理测试和模型切换入口，避免前端误导用户走不存在的写接口。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="glass-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <Server className="text-cyan-500" size={22} />
            <h2 className="text-lg font-semibold text-slate-900">工作台接口</h2>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Workbench API Base</div>
              <div className="break-all font-mono text-sm text-slate-900">{settings.workbenchApiBase}</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">Frontend Dev Server</div>
              <div className="break-all font-mono text-sm text-slate-900">{settings.frontendDevServer}</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-400">后端说明</div>
              <div className="text-sm leading-6 text-slate-600">{settings.note}</div>
            </div>
          </div>
        </section>

        <section className="glass-card p-6">
          <div className="mb-5 flex items-center gap-3">
            <Cpu className="text-emerald-500" size={22} />
            <h2 className="text-lg font-semibold text-slate-900">联调约束</h2>
          </div>

          <div className="space-y-4 text-sm leading-6 text-slate-600">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              1. 以前端展示为主，但所有状态、资源、阶段和可用能力都以后端真实产物为准。
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              2. 旧版项目、角色、场景、配音的编辑动作已下线；当前前端只展示可从 run 中读到的事实。
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              3. 后续如果后端补出写接口，前端再恢复对应按钮和表单，而不是在当前版本里先做假交互。
            </div>
          </div>
        </section>
      </div>

      <section className="glass-card mt-6 p-6">
        <div className="mb-4 flex items-center gap-3">
          <Activity className="text-amber-500" size={22} />
          <h2 className="text-lg font-semibold text-slate-900">当前接入说明</h2>
        </div>
        <p className="text-sm leading-7 text-slate-500">
          `views` 前端现阶段承担的是运行产物浏览器，不是项目编辑后台。项目首页、详情、角色、场景、配音和设置都已经切到真实
          workbench 数据源；与旧接口不一致的部分，统一按后端当前只读工作流收敛。
        </p>
      </section>
    </div>
  );
}
