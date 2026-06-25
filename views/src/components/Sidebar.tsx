import { NavLink, useLocation, useParams } from 'react-router-dom';
import { Home, Bell, HelpCircle, Package, Users, MapPin, BookOpen, ChevronDown, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { useState, useEffect } from 'react';

const mainNavItems = [
  { icon: Home, label: '首页', path: '/' },
  { icon: Settings, label: '配置页', path: '/settings' },
];

const assetSubItems = [
  { icon: BookOpen, label: '资产库', pathSuffix: 'assets', basePath: 'project' },
  { icon: Users, label: '人物 / 配音', pathSuffix: 'characters', basePath: 'drama' },
  { icon: MapPin, label: '场景管理', pathSuffix: 'scenes', basePath: 'drama' },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const { id: projectId } = useParams();
  const [showNotifications, setShowNotifications] = useState(false);
  const [assetsExpanded, setAssetsExpanded] = useState(false);

  // 自动展开资产菜单（如果当前在资产相关页面）
  useEffect(() => {
    const isAssetPage = assetSubItems.some(item => location.pathname.includes(item.pathSuffix));
    if (isAssetPage && !isCollapsed) {
      setAssetsExpanded(true);
    }
  }, [location.pathname, isCollapsed]);

  // Collapse sidebar forces asset menu to close
  useEffect(() => {
    if (isCollapsed) {
      setAssetsExpanded(false);
    }
  }, [isCollapsed]);

  // 获取当前项目ID（从URL中提取）
  const getCurrentProjectId = () => {
    const match = location.pathname.match(/\/drama\/([^/]+)/);
    return match ? match[1] : projectId || null;
  };

  const currentProjectId = getCurrentProjectId();

  const handleNotificationClick = () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications) {
      alert('🔔 通知中心\n\n暂无新通知');
    }
  };

  const handleHelpClick = () => {
    alert('❓ 帮助中心\n\n• 如何创建项目：点击首页"新建项目"按钮\n• 如何生成视频：进入项目后点击"生成画面"按钮\n• 如何导出脚本：在分镜编辑器中点击"导出脚本"\n\n更多帮助请访问文档中心');
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-white border-r border-slate-200 flex flex-col z-50 transition-all duration-300 ease-in-out shadow-sm ${
        isCollapsed ? 'w-[72px]' : 'w-[240px]'
      }`}
    >
      {/* Logo */}
      <div className={`p-6 border-b border-slate-200 flex items-center ${isCollapsed ? 'justify-center p-4' : 'justify-between'}`}>
        <div className="flex items-center gap-3 select-none">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-teal-500 to-emerald-400 p-[1px] flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/15">
            <div className="w-full h-full rounded-[11px] bg-white flex items-center justify-center">
              <span className="text-cyan-700 font-extrabold text-sm tracking-wider">AI</span>
            </div>
          </div>
          {!isCollapsed && (
            <div className="animate-in fade-in duration-300">
              <h1 className="text-[15px] font-black tracking-wide bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-500 bg-clip-text text-transparent whitespace-nowrap">
                AI 视频工厂
              </h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-widest -mt-0.5 whitespace-nowrap">PRO WORKBENCH</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        {mainNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => {
                // Normal navigation for all items
            }}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-300 group relative
              ${isActive
                ? 'bg-cyan-50 text-cyan-700 border border-cyan-200 shadow-[0_4px_12px_-2px_rgba(8,145,178,0.12)]'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 hover:translate-x-0.5'
              } ${isCollapsed ? 'justify-center' : ''}`
            }
            title={isCollapsed ? item.label : ''}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-gradient-to-b from-cyan-500 to-teal-500 shadow-[0_0_8px_rgba(8,145,178,0.3)]" />
                )}
                <item.icon size={20} className={`shrink-0 ${isActive ? 'text-cyan-600' : ''}`} />
                {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap animate-in fade-in duration-200">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}

        {/* 资产管理 - 可展开菜单 */}
        <div className={`pt-4 mt-4 border-t border-slate-200 ${isCollapsed ? 'hidden' : 'block'}`}>
          <button
            onClick={() => setAssetsExpanded(!assetsExpanded)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300
              ${assetsExpanded
                ? 'bg-slate-50 text-slate-900 border border-slate-200'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
          >
            <div className="flex items-center gap-3">
              <Package size={20} />
              <span className="text-sm font-medium">资产管理</span>
            </div>
            <ChevronDown
              size={16}
              className={`transition-transform duration-300 ${assetsExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {/* 子菜单 */}
          {assetsExpanded && (
            <div className="mt-1 ml-4 pl-3 border-l-2 border-slate-200 space-y-1 relative animate-in fade-in duration-300">
              {assetSubItems.map((item) => {
                const baseRoute = item.basePath || 'drama';
                const targetPath = currentProjectId
                  ? `/${baseRoute}/${currentProjectId}/${item.pathSuffix}`
                  : '#';
                const isActive = location.pathname.includes(item.pathSuffix);

                return (
                  <NavLink
                    key={item.pathSuffix}
                    to={targetPath}
                    onClick={(e) => {
                      if (!currentProjectId) {
                        e.preventDefault();
                        alert('请先选择一个项目');
                      }
                    }}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-300 text-sm relative
                      ${isActive
                        ? 'bg-teal-50 text-teal-700 font-medium shadow-[inset_0_1px_0_rgba(13,148,136,0.1)]'
                        : currentProjectId
                          ? 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 hover:translate-x-0.5'
                          : 'text-slate-400 cursor-not-allowed'
                      }`}
                  >
                    {isActive && (
                      <span className="absolute left-0 w-1.5 h-1.5 rounded-full bg-teal-500 -translate-x-[18px] top-1/2 -translate-y-1/2 shadow-[0_0_6px_rgba(13,148,136,0.6)]" />
                    )}
                    <item.icon size={15} className={`${isActive ? 'text-teal-500' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* Footer / Toggle */}
      <div className="border-t border-slate-200">
        <button
           onClick={onToggle}
           className="w-full p-4 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
           {isCollapsed ? <ChevronRight size={20} /> : (
               <div className="flex items-center gap-2 text-sm w-full px-2">
                   <ChevronLeft size={16} />
                   <span>收起边栏</span>
               </div>
           )}
        </button>

        {!isCollapsed && (
          <div className="p-4 flex items-center justify-between text-slate-400">
            <button
              onClick={handleNotificationClick}
              className="p-2 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors relative"
            >
              <Bell size={18} />
              <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full notification-dot"></span>
            </button>
            <button
              onClick={handleHelpClick}
              className="p-2 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <HelpCircle size={18} />
            </button>
          </div>
        )}
      </div>



    </aside>
  );
}
