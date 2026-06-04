import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2, Brain, FileText, Users, Clapperboard } from 'lucide-react';

interface Step {
  id: string;
  label: string;
  icon: any;
  duration: number; // Simulated duration in ms
}

const PROCESS_STEPS: Step[] = [
  { id: 'parse', label: '正在解析剧本结构...', icon: FileText, duration: 2000 },
  { id: 'context', label: 'AI 理解剧情上下文...', icon: Brain, duration: 3000 },
  { id: 'extract', label: '提取人物与核心关系...', icon: Users, duration: 2500 },
  { id: 'structure', label: '规划分镜逻辑结构...', icon: Clapperboard, duration: 2500 },
  { id: 'generating', label: '核心剧本生成中 (耗时较长请耐心等待)...', icon: Loader2, duration: 15000 }, // Long duration for final step
];

export default function ImportProcessVisualizer({ onComplete }: { onComplete?: () => void }) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const processNext = (index: number) => {
      if (index >= PROCESS_STEPS.length) {
        onComplete?.();
        return;
      }

      timeout = setTimeout(() => {
        // 如果不是最后一个步骤，则自动切换到下一个
        if (index < PROCESS_STEPS.length - 1) {
          setCurrentStepIndex(prev => prev + 1);
          processNext(index + 1);
        } else {
          // 最后一个步骤（通常是 API 耗时操作）不自动完成
          // 它将保持在 "进行中" 状态并播放动画，直到父组件因 API 返回而将其卸载
        }
      }, PROCESS_STEPS[index].duration);
    };

    processNext(0);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="w-full max-w-md mx-auto p-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Brain className="text-emerald-500" size={32} />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">正在进行 AI 识别</h3>
        <p className="text-slate-500 text-sm">正在构建您的项目骨架...</p>
      </div>

      <div className="space-y-4 relative">
        {/* Connecting Line */}
        <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-slate-200 -z-10" />

        {PROCESS_STEPS.map((step, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;

          return (
            <div key={step.id} className="flex items-center gap-4 transition-all duration-500">
              <div className={`relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300
                ${isCompleted ? 'bg-emerald-500 border-emerald-500 text-white' :
                  isCurrent ? 'bg-emerald-50 border-emerald-500 text-emerald-500' : 'bg-white border-slate-200 text-slate-300'}`}
              >
                {isCompleted ? (
                   <CheckCircle2 size={18} />
                ) : isCurrent ? (
                   <Loader2 size={18} className="animate-spin" />
                ) : (
                   <step.icon size={16} />
                )}
              </div>
              <div className={`${isCurrent ? 'text-slate-900 font-medium scale-105' : isCompleted ? 'text-slate-500' : 'text-slate-300'} transition-all duration-300`}>
                {step.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
