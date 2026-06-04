import { Search, X, Filter, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import ViewToggle from './ViewToggle';

interface DashboardToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  view: 'grid' | 'list';
  onViewChange: (view: 'grid' | 'list') => void;
  activeFilter: string;
  onFilterChange: (filter: string) => void;
}

const FILTER_OPTIONS = [
  { id: 'all', label: '全部项目' },
  { id: 'active', label: '进行中' },
  { id: 'completed', label: '已完成' },
  { id: 'archived', label: '已归档' },
];

export default function DashboardToolbar({
  searchQuery,
  onSearchChange,
  view,
  onViewChange,
  activeFilter,
  onFilterChange,
}: DashboardToolbarProps) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8 p-1">
      {/* 搜索栏 */}
      <div className="relative flex-1 max-w-md w-full group">
        <div className="absolute inset-0 bg-cyan-100 rounded-xl blur-md opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"></div>
        <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:border-cyan-500/50 focus-within:ring-1 focus-within:ring-cyan-500/20 transition-all">
          <Search className="ml-3 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="搜索项目名称、描述或风格..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-3 py-2.5 bg-transparent border-none text-slate-900 placeholder:text-slate-400 focus:outline-none text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="mr-3 text-slate-400 hover:text-slate-900 transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* 右侧工具组 */}
      <div className="flex items-center gap-3 w-full md:w-auto">
        {/* 筛选器 */}
        <div className="relative">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
              activeFilter !== 'all'
                ? 'bg-cyan-100 border-cyan-300 text-cyan-500'
                : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Filter size={18} />
            <span className="text-sm font-medium">
              {FILTER_OPTIONS.find(f => f.id === activeFilter)?.label || '筛选'}
            </span>
            <ChevronDown size={14} className={`transition-transform duration-200 ${showFilters ? 'rotate-180' : ''}`} />
          </button>

          {/* 筛选下拉菜单 */}
          {showFilters && (
            <>
              <div 
                className="fixed inset-0 z-10" 
                onClick={() => setShowFilters(false)}
              ></div>
              <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-2xl backdrop-blur-xl z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      onFilterChange(option.id);
                      setShowFilters(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                      activeFilter === option.id
                        ? 'bg-cyan-50 text-cyan-500'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                    {activeFilter === option.id && (
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 视图切换 */}
        <ViewToggle view={view} onChange={onViewChange} />
      </div>
    </div>
  );
}
