import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react';

import {
  useProviderSettings,
  useProviderSettingsActions,
} from '../hooks/useWorkbench';
import type { ProviderSettingSection, ProviderSettingField } from '../lib/workbench';

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: ProviderSettingField;
  value: string;
  onChange: (value: string) => void;
}) {
  const base = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 focus:outline-none';

  if (field.kind === 'select') {
    return (
      <select className={base} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">请选择</option>
        {field.options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.kind === 'secret' ? 'password' : 'text'}
      className={base}
      value={value}
      placeholder={field.kind === 'secret' && field.configured ? '留空表示保持原值' : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export default function SettingsPage() {
  const { settings, loading, error } = useProviderSettings();
  const { save, saving, saveError, runAllChecks, checkingAll, precheckResult, precheckError } =
    useProviderSettingsActions();
  const [draftSections, setDraftSections] = useState<ProviderSettingSection[] | null>(null);

  useEffect(() => {
    if (!settings) return undefined;
    const sections = Array.isArray(settings.sections) ? settings.sections : [];
    setDraftSections(sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => ({
        ...field,
        value: field.kind === 'secret' ? '' : field.value || '',
      })),
    })));
    return undefined;
  }, [settings]);

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (!settings || !draftSections) {
    return <div className="glass-card p-6 text-sm text-red-600">加载设置失败{error ? `：${error}` : ''}。</div>;
  }

  const updateField = (sectionId: string, fieldKey: string, value: string) => {
    setDraftSections((current) =>
      (current || []).map((section) => (
        section.id !== sectionId
          ? section
          : {
              ...section,
              fields: section.fields.map((field) => (field.key !== fieldKey ? field : { ...field, value })),
            }
      ))
    );
  };

  const handleSave = async () => {
    const saved = await save(draftSections);
    setDraftSections(Array.isArray(saved.sections) ? saved.sections : []);
  };

  const handlePrecheck = async () => {
    try {
      await handleSave();
    } catch {
      return;
    }
    await runAllChecks();
  };

  const resultsBySection = new Map(precheckResult?.results.map((item) => [item.sectionId, item]) || []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="rounded-2xl border border-cyan-100 bg-cyan-50 p-6">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white px-3 py-1 text-xs text-cyan-700">
          <ShieldCheck size={14} />
          {settings.mode}
        </div>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">配置页</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{settings.note}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            保存配置
          </button>
          <button
            onClick={handlePrecheck}
            disabled={checkingAll}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {checkingAll ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            一键预检全部
          </button>
        </div>
        <div className="mt-4 text-xs text-slate-500">
          工作台地址：{settings.workbenchApiBase}
        </div>
      </header>

      {saveError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{saveError}</div> : null}
      {precheckError ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{precheckError}</div> : null}

      {draftSections.map((section) => {
        const result = resultsBySection.get(section.id);
        return (
          <section key={section.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">{section.description}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {section.fields.map((field) => (
                <label key={field.key} className="space-y-2">
                  <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                    <span>{field.label}</span>
                    <span className="text-xs text-slate-400">
                      {field.required ? '必填' : field.kind === 'secret' ? (field.configured ? '已配置' : '未配置') : '可选'}
                    </span>
                  </div>
                  <FieldEditor
                    field={field}
                    value={field.value}
                    onChange={(value) => updateField(section.id, field.key, value)}
                  />
                  {field.kind === 'secret' && field.configured ? (
                    <div className="text-xs text-slate-400">当前已配置，留空保存会保持原值。</div>
                  ) : null}
                </label>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              {result ? (
                <div className="flex items-start gap-3">
                  {result.ok ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={18} /> : <AlertCircle className="mt-0.5 text-amber-600" size={18} />}
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-semibold text-slate-900">
                      {result.ok ? '预检通过' : '预检未通过'}
                    </div>
                    <div className="mt-1 text-slate-600">
                      {result.message}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {result.sectionTitle} / {result.provider || '-'} / {result.model || '-'} / {result.checkType}
                    </div>
                    {result.hint ? <div className="mt-1 text-xs text-amber-600">{result.hint}</div> : null}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">还没执行预检。</div>
              )}
            </div>
          </section>
        );
      })}

      {precheckResult ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          已完成全部预检：{precheckResult.results.filter((item) => item.ok).length}/{precheckResult.results.length}
        </div>
      ) : null}
    </div>
  );
}
