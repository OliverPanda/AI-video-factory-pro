import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info' | 'success';
}

export default function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = '确定',
  cancelText = '取消',
  type = 'warning'
}: ConfirmModalProps) {
  if (!isOpen) return null;

  const getConfig = () => {
    switch (type) {
      case 'danger':
        return {
          icon: <AlertCircle className="text-red-500" size={24} />,
          buttonClass: 'bg-red-600 hover:bg-red-500 shadow-red-500/20',
          bgClass: 'from-red-500/10 to-transparent'
        };
      case 'warning':
        return {
          icon: <AlertCircle className="text-amber-600" size={24} />,
          buttonClass: 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20',
          bgClass: 'from-amber-500/10 to-transparent'
        };
      case 'success':
        return {
          icon: <CheckCircle2 className="text-emerald-500" size={24} />,
          buttonClass: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20',
          bgClass: 'from-emerald-500/10 to-transparent'
        };
      default:
        return {
          icon: <Info className="text-cyan-500" size={24} />,
          buttonClass: 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-500/20',
          bgClass: 'from-indigo-500/10 to-transparent'
        };
    }
  };

  const config = getConfig();

  return (
    <div 
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-white/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={e => e.stopPropagation()}
    >
      <div 
        className="fixed inset-0" 
        onClick={onCancel}
      />
      <div className="w-full max-w-md glass-card overflow-hidden animate-in zoom-in-95 duration-200 relative z-10 border border-slate-200 shadow-2xl">
        <div className={`p-6 pb-2 bg-gradient-to-b ${config.bgClass}`}>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-slate-50 rounded-xl border border-slate-200">
              {config.icon}
            </div>
            <h3 className="text-xl font-bold text-slate-900">{title}</h3>
            <button
              onClick={onCancel}
              className="ml-auto p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-slate-600 leading-relaxed whitespace-pre-line px-1">
            {message}
          </p>
        </div>

        <div className="p-6 pt-4 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-6 py-2.5 text-slate-500 font-medium hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-8 py-2.5 text-white font-bold rounded-xl shadow-lg transition-all active:scale-95 ${config.buttonClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
