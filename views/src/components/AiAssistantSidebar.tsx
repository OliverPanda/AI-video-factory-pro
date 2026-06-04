import { useState, useEffect } from 'react';
import { Sparkles, ChevronRight, UserPlus, Clapperboard, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Suggestion {
  id: string;
  type: 'urgent' | 'tip' | 'success';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: any;
}

interface AiAssistantSidebarProps {
  project: any;
  onAction: (actionType: string, payload?: any) => void;
  className?: string;
}

export default function AiAssistantSidebar({ project, onAction, className = '' }: AiAssistantSidebarProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  useEffect(() => {
    if (!project) return;
    scanProject(project);
  }, [project]);

  const scanProject = (proj: any) => {
    const newSuggestions: Suggestion[] = [];

    // 1. Check for Characters without avatars
    const charsWithoutAvatar = proj.characters?.filter((c: any) => !c.avatarUrl) || [];
    if (charsWithoutAvatar.length > 0) {
      newSuggestions.push({
        id: 'missing_avatars',
        type: 'urgent',
        title: '缺少角色立绘',
        description: `发现 ${charsWithoutAvatar.length} 个角色暂无形象。AI 可以根据原著描述自动生成人物立绘。`,
        actionLabel: '一键生成立绘',
        icon: UserPlus,
        onAction: () => onAction('generate_avatars', { characterIds: charsWithoutAvatar.map((c:any) => c.id) })
      });
    }

    // 2. Draft Check removed per requirements


    // 3. Check for Ready Storyboards
    const readyChapters = proj.chapters?.filter((c: any) => c.status === 'analysis_completed') || [];
    if (readyChapters.length > 0) {
        newSuggestions.push({
            id: 'ready_storyboards',
            type: 'success',
            title: '分镜准备就绪',
            description: `第 ${readyChapters[0].number} 章已完成拆解，现在可以开始绘制分镜画面了。`,
            actionLabel: '进入分镜工作台',
            icon: Clapperboard,
            onAction: () => onAction('goto_storyboard', { chapterId: readyChapters[0].id })
        });
    }

    setSuggestions(newSuggestions);
  };

  if (!isOpen) {
    return (
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed right-6 bottom-6 w-14 h-14 bg-cyan-600 hover:bg-cyan-500 rounded-full shadow-xl shadow-cyan-500/40 flex items-center justify-center text-white z-40 transition-all hover:scale-110 ${className}`}
      >
        <Sparkles size={24} />
        {suggestions.length > 0 && (
          <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 rounded-full border-2 border-white"></span>
        )}
      </button>
    );
  }

  return (
    <div className={`fixed right-6 bottom-6 w-96 bg-white/95 backdrop-blur-xl border border-slate-200 rounded-2xl shadow-2xl z-40 flex flex-col overflow-hidden animate-in slide-in-from-right-10 duration-300 ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center text-cyan-500">
                <Sparkles size={18} />
            </div>
            <div>
                <h3 className="text-slate-900 font-medium text-sm">AI 导演助理</h3>
                <p className="text-slate-500 text-xs">{suggestions.length} 条建议待处理</p>
            </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200 transition-colors"
        >
            <ChevronRight size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
        {suggestions.map((item) => (
            <div key={item.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 hover:border-cyan-300 transition-colors group">
                <div className="flex items-start gap-3 mb-3">
                    <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0
                        ${item.type === 'urgent' ? 'bg-amber-500/10 text-amber-500' : 
                          item.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-blue-500/10 text-blue-500'}`}
                    >
                        {item.icon ? <item.icon size={16} /> : <AlertCircle size={16} />}
                    </div>
                    <div>
                        <h4 className="text-slate-800 text-sm font-medium mb-1">{item.title}</h4>
                        <p className="text-slate-400 text-xs leading-relaxed">{item.description}</p>
                    </div>
                </div>
                {item.actionLabel && (
                    <button 
                        onClick={item.onAction}
                        className="w-full py-2 bg-slate-50 hover:bg-cyan-600 hover:text-white text-slate-600 text-xs font-medium rounded-lg transition-all flex items-center justify-center gap-2 group-hover:bg-cyan-100 group-hover:text-cyan-600"
                    >
                        {item.actionLabel}
                        <ChevronRight size={12} />
                    </button>
                )}
            </div>
        ))}

        {suggestions.length === 0 && (
            <div className="text-center py-8 text-slate-400">
                <CheckCircle2 size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-xs">当前项目状态良好<br/>无需额外操作</p>
            </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="p-3 bg-slate-50 text-[10px] text-slate-300 text-center border-t border-slate-200">
        AI 助手运行中 · {new Date().toLocaleTimeString()}
      </div>
    </div>
  );
}
