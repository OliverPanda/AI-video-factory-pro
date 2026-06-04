import { LayoutGrid, List } from 'lucide-react';

interface ViewToggleProps {
  view: 'grid' | 'list';
  onChange: (view: 'grid' | 'list') => void;
}

export default function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="flex bg-slate-50 p-1 rounded-lg border border-slate-200">
      <button
        onClick={() => onChange('grid')}
        className={`p-2 rounded-md transition-all duration-200 ${
          view === 'grid'
            ? 'bg-cyan-100 text-cyan-500 shadow-sm'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
        }`}
        title="网格视图"
      >
        <LayoutGrid size={18} />
      </button>
      <button
        onClick={() => onChange('list')}
        className={`p-2 rounded-md transition-all duration-200 ${
          view === 'list'
            ? 'bg-cyan-100 text-cyan-500 shadow-sm'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
        }`}
        title="列表视图"
      >
        <List size={18} />
      </button>
    </div>
  );
}
