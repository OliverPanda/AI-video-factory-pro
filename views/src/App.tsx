import { useState, useEffect } from 'react';
import { Plus, Film, Clock, Sparkles } from 'lucide-react';
import { VersionCheck } from './components/VersionCheck';

interface Project {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  createdAt: string;
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      setProjects(data);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `新项目 ${projects.length + 1}`,
          description: '这是一个新的 AI 视频项目',
        }),
      });
      const newProject = await response.json();
      setProjects([newProject, ...projects]);
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  return (
    <div className="min-h-screen p-8">
      {/* 头部 */}
      <header className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400 bg-clip-text text-transparent">
            AI Video Factory
          </h1>
          <p className="text-gray-400 mt-2">AI 短剧工场 · 智能创作平台</p>
        </div>
        <button
          onClick={createProject}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 
                     text-white font-medium rounded-xl shadow-lg shadow-indigo-500/25 
                     hover:shadow-indigo-500/40 hover:from-indigo-600 hover:to-violet-700 
                     transition-all duration-300"
        >
          <Plus size={20} />
          新建项目
        </button>
      </header>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="glass-card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-500/20">
              <Film className="text-indigo-400" size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm">项目总数</p>
              <p className="text-3xl font-bold text-white">{projects.length}</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-violet-500/20">
              <Sparkles className="text-violet-400" size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm">AI 生成量</p>
              <p className="text-3xl font-bold text-white">0</p>
            </div>
          </div>
        </div>
        <div className="glass-card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/20">
              <Clock className="text-emerald-400" size={24} />
            </div>
            <div>
              <p className="text-gray-400 text-sm">节省时间</p>
              <p className="text-3xl font-bold text-white">0 小时</p>
            </div>
          </div>
        </div>
      </div>

      <section>
        <h2 className="text-xl font-semibold text-white mb-6">最近项目</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-card p-6 animate-pulse">
                <div className="h-40 bg-white/5 rounded-lg mb-4"></div>
                <div className="h-4 bg-white/5 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-white/5 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <Film className="mx-auto text-gray-500 mb-4" size={48} />
            <p className="text-gray-400">暂无项目，点击"新建项目"开始创作</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div key={project.id} className="glass-card glow-border p-6 cursor-pointer">
                <div className="h-40 bg-gradient-to-br from-indigo-500/10 to-violet-500/10 rounded-lg mb-4 flex items-center justify-center">
                  <Film className="text-gray-600" size={48} />
                </div>
                <h3 className="font-semibold text-white mb-1">{project.name}</h3>
                <p className="text-gray-500 text-sm">{project.description || '暂无描述'}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 版本更新热感知弹窗 */}
      <VersionCheck />
    </div>
  );
}

export default App;
