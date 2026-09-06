import { useState } from 'react';
import { Check } from 'lucide-react';

export interface StyleOption {
  value: string;
  label: string;
  gradient: string;
  accent: string;
  image?: string;
}

export const STYLE_PRESETS: StyleOption[] = [
  {
    value: '',
    label: '选择画风',
    gradient: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
    accent: '#94a3b8',
  },
  {
    value: '写实摄影',
    label: '写实摄影',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
    accent: '#e2b44d',
    image: '/style-presets/realistic-photo.png',
  },
  {
    value: '日系动漫',
    label: '日系动漫',
    gradient: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 50%, #a8edea 100%)',
    accent: '#6366f1',
    image: '/style-presets/japanese-anime.png',
  },
  {
    value: '美漫风格',
    label: '美漫风格',
    gradient: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)',
    accent: '#1e3a5f',
    image: '/style-presets/american-comic.png',
  },
  {
    value: '国风水墨',
    label: '国风水墨',
    gradient: 'linear-gradient(135deg, #2c3e50 0%, #4ca1af 30%, #c9d6ff 70%, #e2e2e2 100%)',
    accent: '#2c3e50',
    image: '/style-presets/chinese-ink.png',
  },
  {
    value: '3D渲染',
    label: '3D渲染',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
    accent: '#667eea',
    image: '/style-presets/3d-render.png',
  },
  {
    value: '油画质感',
    label: '油画质感',
    gradient: 'linear-gradient(135deg, #8B6914 0%, #D4A843 30%, #C67B3C 60%, #8B4513 100%)',
    accent: '#D4A843',
    image: '/style-presets/oil-painting.png',
  },
  {
    value: '赛博朋克',
    label: '赛博朋克',
    gradient: 'linear-gradient(135deg, #0a0a0a 0%, #1a0030 30%, #00f5ff 70%, #ff00ff 100%)',
    accent: '#00f5ff',
    image: '/style-presets/cyberpunk.png',
  },
];

const GENRE_OPTIONS = [
  { value: '', label: '选择题材' },
  { value: '都市情感', label: '都市情感' },
  { value: '古装仙侠', label: '古装仙侠' },
  { value: '悬疑推理', label: '悬疑推理' },
  { value: '科幻未来', label: '科幻未来' },
  { value: '校园青春', label: '校园青春' },
  { value: '恐怖惊悚', label: '恐怖惊悚' },
  { value: '喜剧搞笑', label: '喜剧搞笑' },
  { value: '历史传记', label: '历史传记' },
];

const RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '4:3', label: '4:3 经典' },
];

export { GENRE_OPTIONS, RATIO_OPTIONS };

/** 画风选择器：视觉化卡片网格 */
export function StylePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [hoveredStyle, setHoveredStyle] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-4 gap-2.5">
      {STYLE_PRESETS.filter((s) => s.value).map((style) => {
        const selected = value === style.value;
        const hovered = hoveredStyle === style.value;
        return (
          <button
            key={style.value}
            type="button"
            onClick={() => onChange(selected ? '' : style.value)}
            onMouseEnter={() => setHoveredStyle(style.value)}
            onMouseLeave={() => setHoveredStyle(null)}
            className={`relative group rounded-xl overflow-hidden border-2 transition-all duration-200 ${
              selected
                ? 'border-cyan-500 ring-2 ring-cyan-200 scale-[1.03]'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            {/* 风格预览图 */}
            <div
              className="relative h-20 w-full overflow-hidden"
              style={{ background: style.gradient }}
            >
              {style.image && (
                <img
                  src={style.image}
                  alt={style.label}
                  className={`absolute inset-0 h-full w-full object-cover transition-transform duration-300 ${
                    hovered ? 'scale-110' : 'scale-100'
                  }`}
                  loading="lazy"
                />
              )}
              {/* 悬停半透明遮罩 */}
              <div className={`absolute inset-0 transition-opacity duration-200 ${
                hovered ? 'bg-black/10' : 'bg-transparent'
              }`} />
            </div>
            {/* 选中勾 */}
            {selected && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center shadow-md">
                <Check size={12} className="text-white" />
              </div>
            )}
            {/* 标签 */}
            <div className={`px-1.5 py-1.5 text-center text-[10px] font-bold transition-colors ${
              selected ? 'text-cyan-700 bg-cyan-50' : 'text-slate-600 bg-white group-hover:bg-slate-50'
            }`}>
              {style.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 已选画风的展示标签 */
export function StyleBadge({ value }: { value: string }) {
  const preset = STYLE_PRESETS.find((s) => s.value === value);
  if (!preset) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold" style={{ borderColor: preset.accent + '40', backgroundColor: preset.accent + '10', color: preset.accent }}>
      {preset.image ? (
        <span className="w-4 h-4 rounded-full shrink-0 overflow-hidden border border-white/50">
          <img src={preset.image} alt={preset.label} className="w-full h-full object-cover" />
        </span>
      ) : (
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: preset.gradient }} />
      )}
      {preset.label}
    </span>
  );
}
