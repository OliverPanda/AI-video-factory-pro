import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { ToastProvider } from './ToastContext';
import { ImagePreviewProvider } from './ImagePreviewContext';
import ImagePreviewModal from './ImagePreviewModal';
import { useState } from 'react';

export default function Layout() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <ToastProvider>
      <ImagePreviewProvider>
        <div className="min-h-screen flex">
          <Sidebar 
            isCollapsed={isSidebarCollapsed} 
            onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
          />
          <main
            className={`flex-1 p-8 overflow-auto bg-slate-50 transition-all duration-300 ease-in-out ${
              isSidebarCollapsed ? 'ml-[72px]' : 'ml-[240px]'
            }`}
          >
            <Outlet />
          </main>
        </div>
        <ImagePreviewModal />
      </ImagePreviewProvider>
    </ToastProvider>
  );
}
