import { useState } from 'react';
import { X, ArrowRight, RefreshCw, Wand2, Check, AlertTriangle } from 'lucide-react';

interface ConsistencyWorkbenchProps {
  shotImageUrl: string | null;
  referenceImageUrl: string | null;
  characterName: string;
  onClose: () => void;
  onRegenerate: () => void;
  onFaceFix: () => void;
}

export default function ConsistencyWorkbench({
  shotImageUrl,
  referenceImageUrl,
  characterName,
  onClose,
  onRegenerate,
  onFaceFix
}: ConsistencyWorkbenchProps) {
  const [fixing, setFixing] = useState(false);

  const handleFix = async () => {
    setFixing(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 2000));
    setFixing(false);
    onFaceFix();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-white/90 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-5xl glass-card flex flex-col h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Wand2 className="text-cyan-500" />
              一致性检查工作台
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              正在校准角色: <span className="text-cyan-600 font-medium">{characterName}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content - Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Reference (Truth) */}
          <div className="flex-1 p-6 border-r border-slate-200 bg-slate-50 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-emerald-500 flex items-center gap-2">
                <Check size={14} /> 标准参考 (Reference)
              </span>
            </div>
            <div className="flex-1 relative rounded-xl overflow-hidden border-2 border-emerald-200 bg-slate-50">
              {referenceImageUrl ? (
                <img src={referenceImageUrl} alt="Reference" className="w-full h-full object-contain" />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400 flex-col gap-2">
                  <AlertTriangle size={32} />
                  <p>未设置参考图</p>
                </div>
              )}
            </div>
            <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <p className="text-xs text-emerald-700">
                AI 将严格锁定此面部特征。如需修改，请前往“人物列表”更新头像。
              </p>
            </div>
          </div>

          {/* Center: Direction Arrow */}
          <div className="w-12 flex items-center justify-center relative">
            <div className="absolute inset-y-0 w-px bg-slate-200"></div>
            <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center shadow-lg z-10">
              <ArrowRight size={16} text-white />
            </div>
          </div>

          {/* Right: Current Shot (Target) */}
          <div className="flex-1 p-6 bg-slate-50 flex flex-col">
             <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-slate-900">
                当前生成 (Current Shot)
              </span>
              {!shotImageUrl && <span className="text-xs text-amber-600">尚未生成</span>}
            </div>
            <div className="flex-1 relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-50">
               {shotImageUrl ? (
                <img src={shotImageUrl} alt="Shot" className="w-full h-full object-contain" />
              ) : (
                <div className="flex items-center justify-center h-full text-slate-300">
                  等待生成...
                </div>
              )}
            </div>

            {/* Action Toolbar */}
            <div className="mt-6 flex gap-3">
               <button
                onClick={onRegenerate}
                className="flex-1 py-3 px-4 bg-slate-50 hover:bg-slate-200 text-slate-900 rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-2 text-sm"
              >
                <RefreshCw size={16} />
                高保真重绘
              </button>
               <button 
                onClick={handleFix}
                disabled={!shotImageUrl || fixing}
                className="flex-1 py-3 px-4 bg-gradient-to-r from-cyan-500 to-teal-600 text-white rounded-xl shadow-lg hover:shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {fixing ? <RefreshCw size={16} className="animate-spin" /> : <Wand2 size={16} />}
                {fixing ? '修复中...' : '一键修脸 (Face Fix)'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
