export interface StyleConfig {
  id: string;
  name: string;
  label: string;
  description: string;
  loraModel?: string;   // Now handled by backend fallback if not provided
  loraStrength?: number;
  previewColor: string; // fallback if no image
}

export const PROJECT_STYLES: StyleConfig[] = [
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    label: 'Cyberpunk',
    description: '霓虹灯光、科技感与未来主义风格',
    previewColor: 'from-blue-600 to-purple-600'
  },
  {
    id: 'ancient',
    name: '古装',
    label: 'Ancient',
    description: '唯美古风、仙侠意境与华丽汉服',
    previewColor: 'from-amber-600 to-red-600'
  },
  {
    id: 'anime',
    name: '二次元',
    label: 'Anime',
    description: '日系动漫风格，色彩鲜艳且充满活力',
    previewColor: 'from-pink-500 to-sky-400'
  },
  {
    id: 'pixar',
    name: '皮克斯',
    label: 'Pixar',
    description: '3D 动画电影质感，圆润且富有光泽',
    previewColor: 'from-yellow-400 to-orange-500'
  },
  {
    id: 'realistic',
    name: '写实',
    label: 'Realistic',
    description: '电影级写实摄影质感，光影自然真实',
    previewColor: 'from-slate-400 to-slate-600'
  },
  {
    id: 'suspense',
    name: '悬疑',
    label: 'Suspense',
    description: '冷酷色调、强光影对比的黑色电影风格',
    previewColor: 'from-indigo-700 to-slate-900'
  },
  {
    id: 'urban',
    name: '都市',
    label: 'Urban',
    description: '现代职业剧感，明亮的办公室与成熟风格',
    previewColor: 'from-blue-400 to-indigo-600'
  },
  {
    id: 'pixel',
    name: '像素',
    label: 'Pixel',
    description: '怀旧 8-bit/16-bit 像素游戏艺术风',
    previewColor: 'from-green-500 to-emerald-700'
  }
];
