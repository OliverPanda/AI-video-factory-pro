import React, { createContext, useContext, useState, type ReactNode } from 'react';

interface ImagePreviewContextType {
  previewUrl: string | null;
  openPreview: (url: string) => void;
  closePreview: () => void;
}

const ImagePreviewContext = createContext<ImagePreviewContextType | undefined>(undefined);

export const ImagePreviewProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const openPreview = (url: string) => {
    setPreviewUrl(url);
  };

  const closePreview = () => {
    setPreviewUrl(null);
  };

  return (
    <ImagePreviewContext.Provider value={{ previewUrl, openPreview, closePreview }}>
      {children}
    </ImagePreviewContext.Provider>
  );
};

export const useImagePreview = () => {
  const context = useContext(ImagePreviewContext);
  if (context === undefined) {
    throw new Error('useImagePreview must be used within an ImagePreviewProvider');
  }
  return context;
};
