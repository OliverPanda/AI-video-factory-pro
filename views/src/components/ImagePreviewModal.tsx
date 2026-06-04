import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useImagePreview } from './ImagePreviewContext';

const ImagePreviewModal: React.FC = () => {
  const { previewUrl, closePreview } = useImagePreview();

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [closePreview]);

  if (!previewUrl) return null;

  return (
    <div 
      className="fixed inset-0 z-[999] bg-white/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-10 animate-in fade-in zoom-in duration-200"
      onClick={closePreview}
    >
      <button 
        className="absolute top-6 right-6 p-3 bg-slate-200 hover:bg-slate-300 rounded-full text-slate-900 transition-all z-10"
        onClick={(e) => { e.stopPropagation(); closePreview(); }}
      >
        <X size={24} />
      </button>
      
      <div className="relative max-w-full max-h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <img 
          src={previewUrl} 
          alt="Preview Full" 
          className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-slate-200"
        />
        
        <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 px-4 py-2 bg-white/80 backdrop-blur-md rounded-full border border-slate-200 text-slate-500 text-xs font-medium whitespace-nowrap opacity-0 md:group-hover:opacity-100 transition-opacity">
          点击阴影处或按钮关闭预览
        </div>
      </div>
    </div>
  );
};

export default ImagePreviewModal;
