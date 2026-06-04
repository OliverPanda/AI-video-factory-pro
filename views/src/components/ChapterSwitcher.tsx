import { useRef, useState, useEffect } from 'react';
import { ChevronDown, Check, FileText } from 'lucide-react';

interface Chapter {
  id: string;
  number: number;
  title: string;
  status: string;
}

interface ChapterSwitcherProps {
  currentChapterId: string;
  chapters: Chapter[];
  onSwitch: (chapterId: string) => void;
}

export default function ChapterSwitcher({ currentChapterId, chapters, onSwitch }: ChapterSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Sort chapters by number
  const sortedChapters = [...chapters].sort((a, b) => a.number - b.number);
  const currentChapter = sortedChapters.find(c => c.id === currentChapterId);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors text-sm font-medium text-slate-800"
      >
        <FileText size={16} className="text-cyan-500" />
        <span>
          {currentChapter ? `第 ${currentChapter.number} 章：${currentChapter.title}` : '选择章节'}
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 max-h-[60vh] overflow-y-auto bg-white/95 backdrop-blur-xl border border-slate-200 rounded-xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200 custom-scrollbar">
          <div className="p-1">
            {sortedChapters.map((chapter) => (
              <button
                key={chapter.id}
                onClick={() => {
                  onSwitch(chapter.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left transition-colors
                  ${chapter.id === currentChapterId ? 'bg-cyan-100 text-cyan-600' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium">第 {chapter.number} 章</span>
                    <span className="text-xs opacity-70 truncate max-w-[180px]">{chapter.title}</span>
                </div>
                {chapter.id === currentChapterId && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
