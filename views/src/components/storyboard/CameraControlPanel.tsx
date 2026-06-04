
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ZoomIn, ZoomOut, RotateCw, RotateCcw, Ban } from 'lucide-react';

export type CameraMovement = 
  | 'static' 
  | 'pan_left' | 'pan_right' | 'pan_up' | 'pan_down' 
  | 'zoom_in' | 'zoom_out' 
  | 'roll_cw' | 'roll_ccw';

interface CameraControlPanelProps {
  value?: string | null;
  onChange: (movement: CameraMovement) => void;
  disabled?: boolean;
}

export default function CameraControlPanel({ value, onChange, disabled }: CameraControlPanelProps) {
  const activeValue = value || 'static';
  
  const movements: { id: CameraMovement; icon: React.ComponentType<{ size: number }>; label: string }[] = [
    { id: 'pan_left', icon: ArrowLeft, label: '左移' },
    { id: 'pan_up', icon: ArrowUp, label: '上移' },
    { id: 'pan_right', icon: ArrowRight, label: '右移' },
    { id: 'pan_down', icon: ArrowDown, label: '下移' },
    { id: 'zoom_in', icon: ZoomIn, label: '推近' },
    { id: 'zoom_out', icon: ZoomOut, label: '拉远' },
    { id: 'roll_cw', icon: RotateCw, label: '顺旋' },
    { id: 'roll_ccw', icon: RotateCcw, label: '逆旋' },
  ];

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">运镜控制</h3>
        <span className="text-xs text-slate-400">Camera Movement</span>
      </div>
      
      <div className="grid grid-cols-4 gap-2">
        {/* Static / Reset Button */}
        <button
          onClick={() => onChange('static')}
          disabled={disabled}
          className={`col-span-4 py-2 rounded-lg text-xs font-medium border flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer
            ${activeValue === 'static' 
                ? 'bg-cyan-50 text-cyan-600 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
            <Ban size={14} />
            固定镜头 (Static)
        </button>

        {movements.map((item) => (
            <button
                key={item.id}
                onClick={() => onChange(item.id)}
                disabled={disabled}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center gap-1 transition-all duration-200 border cursor-pointer
                    ${activeValue === item.id 
                        ? 'bg-cyan-50 text-cyan-600 border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-600 hover:scale-105 hover:shadow-lg'
                    } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
                title={item.label}
            >
                <item.icon size={16} />
                <span className="text-[9px]">{item.label}</span>
            </button>
        ))}
      </div>
    </div>
  );
}
