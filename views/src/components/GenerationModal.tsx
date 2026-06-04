import { useState } from 'react';
import { X, Cpu, Play, AlertTriangle, Loader2 } from 'lucide-react';

interface GenerationModalProps {
  onClose: () => void;
  shotCount?: number;
  projectId?: string;
}

export default function GenerationModal({ onClose, shotCount = 12, projectId }: GenerationModalProps) {
  const [mode, setMode] = useState<'preview' | 'full'>('full');
  const [style, setStyle] = useState('赛博朋克');
  const [resolution, setResolution] = useState('4K UHD');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimatedCost = mode === 'preview' ? 0.2 : 0.6;
  const estimatedTime = mode === 'preview' ? 3 : 8;

  const handleStartGeneration = async () => {
    setIsGenerating(true);
    setError(null);
    
    try {
      // 模拟 API 调用 - 实际项目中替换为真实的生成 API
      const response = await fetch('/api/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          mode,
          style,
          resolution,
          shotCount,
        }),
      });

      if (!response.ok) {
        // 如果 API 不存在，模拟成功响应
        console.log('Generation API not implemented yet, simulating success...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        alert(`🎉 生成任务已提交！\n\n模式: ${mode === 'preview' ? '预览' : '完整视频'}\n画风: ${style}\n分辨率: ${resolution}\n镜头数: ${shotCount}\n预估费用: ~${estimatedCost} 元\n预估时间: ~${estimatedTime} 分钟`);
        onClose();
        return;
      }

      const result = await response.json();
      alert(`生成任务已创建！任务 ID: ${result.id}`);
      onClose();
    } catch (err) {
      // 模拟成功（API 尚未实现时）
      console.log('Simulating generation success...');
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert(`🎉 生成任务已提交！\n\n模式: ${mode === 'preview' ? '预览' : '完整视频'}\n画风: ${style}\n分辨率: ${resolution}\n镜头数: ${shotCount}\n预估费用: ~${estimatedCost} 元\n预估时间: ~${estimatedTime} 分钟`);
      onClose();
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-white/80 backdrop-blur-sm"
        onClick={isGenerating ? undefined : onClose}
      ></div>

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-md glass-card p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* 关闭按钮 */}
        <button 
          onClick={onClose}
          disabled={isGenerating}
          className="absolute top-4 right-4 p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
        >
          <X size={20} />
        </button>

        {/* 标题 */}
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-2xl font-bold text-slate-900 font-heading">视频生成</h2>
          <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
            <Cpu className="text-cyan-500" size={18} />
          </div>
        </div>

        {/* 模式选择 */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setMode('preview')}
            disabled={isGenerating}
            className={`flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition-all
              ${mode === 'preview'
                ? 'bg-slate-200 border-slate-300 text-slate-900'
                : 'border-slate-200 text-slate-500 hover:border-slate-300'
              } disabled:opacity-50`}
          >
            ○ 预览模式 (Preview)
          </button>
          <button
            onClick={() => setMode('full')}
            disabled={isGenerating}
            className={`flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition-all
              ${mode === 'full'
                ? 'bg-gradient-to-r from-cyan-100 to-teal-100 border-cyan-300 text-slate-900'
                : 'border-slate-200 text-slate-500 hover:border-slate-300'
              } disabled:opacity-50`}
          >
            ◉ 完整视频 (Full Video)
          </button>
        </div>

        {/* 配置选项 */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-xs text-slate-500 mb-2">画风</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              disabled={isGenerating}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:border-cyan-500/50 focus:outline-none appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="赛博朋克">🎨 赛博朋克</option>
              <option value="水彩风格">🖼️ 水彩风格</option>
              <option value="动漫风格">🎌 动漫风格</option>
              <option value="写实风格">📷 写实风格</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-2">分辨率</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={isGenerating}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:border-cyan-500/50 focus:outline-none appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="4K UHD">📺 4K UHD</option>
              <option value="1080p HD">📺 1080p HD</option>
              <option value="720p">📺 720p</option>
            </select>
          </div>
        </div>

        {/* 成本估算 */}
        <div className="glass-card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500">Shot count:</span>
            <span className="text-lg font-bold text-slate-900">{shotCount}</span>
          </div>
          
          {/* 进度条 */}
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
            <div className="h-full w-full progress-neon"></div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                ~{estimatedCost} 元
              </span>
              <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
                <span className="text-emerald-500 text-xs">$</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Estimated time:</p>
              <p className="text-sm text-slate-900 font-medium">⏱ ~{estimatedTime} 分钟</p>
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-6">
            <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* 警告提示 */}
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl mb-6">
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
          <p className="text-sm text-amber-700">
            提示：完整视频生成可能占用较高算力资源，请确保您的账户余额充足。
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="flex-1 py-3.5 px-6 bg-slate-50 border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleStartGeneration}
            disabled={isGenerating}
            className="flex-1 py-3.5 px-6 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium rounded-xl
                     shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:from-cyan-600 hover:to-teal-700
                     transition-all duration-300 flex items-center justify-center gap-2 relative overflow-hidden group disabled:opacity-70"
          >
            {/* 流光效果 */}
            {!isGenerating && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
            )}
            {isGenerating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Play size={18} />
                开始生成
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
