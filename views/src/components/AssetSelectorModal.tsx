import { useState, useEffect } from 'react';
import { X, Image as ImageIcon, Check } from 'lucide-react';

interface Asset {
  filename: string;
  url: string;
  created_at: number;
}

interface AssetSelectorModalProps {
  onSelect: (url: string) => void;
  onClose: () => void;
}

export default function AssetSelectorModal({ onSelect, onClose }: AssetSelectorModalProps) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  useEffect(() => {
    fetchAssets();
  }, []);

  const fetchAssets = async () => {
    try {
      const response = await fetch('/api/upload/files');
      if (response.ok) {
        setAssets(await response.json());
      }
    } catch (error) {
      console.error('Failed to fetch assets:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-white/80 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-2xl glass-card flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ImageIcon className="text-cyan-500" />
            选择资产
          </h2>
          <button onClick={onClose} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[400px]">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full"></div>
            </div>
          ) : assets.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
              <p>暂无上传的资产</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-4">
              {assets.map((asset) => (
                <div 
                  key={asset.filename}
                  onClick={() => setSelectedUrl(asset.url)}
                  className={`aspect-square relative rounded-xl overflow-hidden cursor-pointer border-2 transition-all group ${
                    selectedUrl === asset.url ? 'border-cyan-500 ring-2 ring-cyan-500/30' : 'border-transparent hover:border-slate-300'
                  }`}
                >
                  <img src={asset.url} alt={asset.filename} className="w-full h-full object-cover" />
                  {selectedUrl === asset.url && (
                    <div className="absolute inset-0 bg-cyan-100 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center text-white shadow-lg">
                        <Check size={16} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => selectedUrl && onSelect(selectedUrl)}
            disabled={!selectedUrl}
            className="px-8 py-2.5 bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/25 transition-all"
          >
            确定选择
          </button>
        </div>
      </div>
    </div>
  );
}
