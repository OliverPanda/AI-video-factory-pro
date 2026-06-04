import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

// The initial version loaded with the app
let currentVersion = '';

export function VersionCheck() {
  const [hasNewVersion, setHasNewVersion] = useState(false);

  useEffect(() => {
    // Record the current version on first load
    const fetchCurrentVersion = async () => {
      try {
        // Add a random query string to prevent caching
        const res = await fetch(`/version.json?t=${new Date().getTime()}`);
        if (res.ok) {
          const data = await res.json();
          currentVersion = data.version;
        }
      } catch (err) {
        console.warn('Failed to fetch initial version', err);
      }
    };
    
    fetchCurrentVersion();

    // Check for new version every minute
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/version.json?t=${new Date().getTime()}`);
        if (res.ok) {
          const data = await res.json();
          if (currentVersion && data.version && currentVersion !== data.version) {
            setHasNewVersion(true);
          }
        }
      } catch (err) {
        console.warn('Failed to poll version', err);
      }
    }, 60000); // 1 minute interval

    return () => clearInterval(interval);
  }, []);

  if (!hasNewVersion) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-bounce">
      <div className="bg-gradient-to-r from-cyan-500 to-teal-600 text-white p-4 rounded-xl shadow-2xl flex items-center gap-4">
        <div>
          <h4 className="font-bold text-sm">系统更新啦 🎉</h4>
          <p className="text-xs opacity-90 mt-1">发现新版本，建议刷新页面体验最新功能</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="p-2 bg-slate-200 hover:bg-slate-300 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium backdrop-blur-sm"
        >
          <RefreshCw size={16} />
          立即刷新
        </button>
      </div>
    </div>
  );
}
