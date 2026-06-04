import React from 'react';
import { Maximize2, Image as ImageIcon } from 'lucide-react';
import { useImagePreview } from './ImagePreviewContext';

interface ImageWithPreviewProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onClick'> {
  containerClassName?: string;
  showIcon?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const ImageWithPreview: React.FC<ImageWithPreviewProps> = ({ 
  src, 
  alt, 
  className, 
  containerClassName = "", 
  showIcon = true,
  onClick,
  ...props 
}) => {
  const { openPreview } = useImagePreview();

  if (!src) {
    return (
      <div className={`w-full h-full flex flex-col items-center justify-center bg-slate-50 text-slate-300 rounded-xl ${containerClassName}`}>
        <ImageIcon size={24} />
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 如果传入了 onClick，则执行它（通常用于 e.stopPropagation()）
    if (onClick) {
      onClick(e);
    }
    openPreview(src);
  };

  return (
    <div 
      className={`relative overflow-hidden cursor-pointer group ${containerClassName}`}
      onClick={handleClick}
    >
      <img 
        src={src} 
        alt={alt} 
        className={`w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 ${className}`}
        {...props}
      />
      
      {/* Overlay */}
      <div className="absolute inset-0 bg-transparent group-hover:bg-slate-900/10 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
        {showIcon && (
          <div className="bg-slate-900/30 backdrop-blur-md p-2 rounded-full text-white transform scale-90 group-hover:scale-100 transition-all duration-300 shadow-xl border border-slate-200">
            <Maximize2 size={20} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageWithPreview;
