import { Series, OffthreadVideo, Audio, AbsoluteFill, Img } from 'remotion';
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Player, type PlayerRef } from '@remotion/player';

export interface WorkbenchShot {
  id: string;
  title: string;
  videoUrl?: string;
  imageUrl?: string;
  audioUrl?: string;
  dialogue?: string | null;
  speaker?: string | null;
  durationSec?: number;
}

const FPS = 30;

// 单个分镜片段组件（将视频/原画、配音和字幕精细组合）
const ShotClip: React.FC<{ shot: WorkbenchShot }> = ({ shot }) => {
  return (
    <AbsoluteFill className="bg-black flex items-center justify-center relative overflow-hidden select-none">
      {/* 1. 视觉视轨：优先视频，无视频则降级为原画分镜 */}
      {shot.videoUrl ? (
        <OffthreadVideo 
          src={shot.videoUrl} 
          className="w-full h-full object-cover"
        />
      ) : shot.imageUrl ? (
        <div className="w-full h-full relative">
          <Img 
            src={shot.imageUrl} 
            className="w-full h-full object-cover filter blur-[2px] scale-105 opacity-40 absolute inset-0"
          />
          <Img 
            src={shot.imageUrl} 
            className="w-full h-full object-contain relative z-10"
          />
        </div>
      ) : (
        <div className="text-slate-300 font-bold text-xs uppercase tracking-widest bg-gradient-to-br from-emerald-950/20 to-cyan-950/20 w-full h-full flex flex-col justify-center items-center gap-2 border border-slate-400/15">
          <span className="text-[10px] bg-slate-700/30 px-2.5 py-1 rounded-full border border-slate-400/15 backdrop-blur-sm animate-pulse">Waiting for assets</span>
          <span>{shot.title} 无素材</span>
        </div>
      )}

      {/* 2. 音频音轨：如果该镜头有台词配音，进行完美时控合并 */}
      {shot.audioUrl && (
        <Audio 
          src={shot.audioUrl} 
          volume={1.0}
        />
      )}

      {/* 3. 实时字幕（花字台词）：精美还原剪映主流花字特效 */}
      {shot.dialogue ? (
        <div className="absolute bottom-16 left-6 right-6 z-30 flex flex-col items-center pointer-events-none drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]">
          <div className="bg-black/60 border border-slate-400/15 px-4 py-2.5 rounded-2xl backdrop-blur-md max-w-full text-center">
            <span className="text-[10px] font-black text-emerald-400 block mb-1 uppercase tracking-wider">
              {shot.speaker}
            </span>
            <p className="text-white text-sm font-black tracking-wide leading-relaxed font-sans">
              “{shot.dialogue}”
            </p>
          </div>
        </div>
      ) : null}

      {/* 镜头右上角浮标 */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none">
        <span className="px-2.5 py-1 bg-black/65 border border-slate-400/15 backdrop-blur-md rounded-full text-[9px] font-black text-white/70 uppercase tracking-widest">
          {shot.title.replace('镜头', 'SH')}
        </span>
      </div>
    </AbsoluteFill>
  );
};

// Remotion Composition 入口组件
interface CompositionProps {
  shots: WorkbenchShot[];
}

export const GoldComboComposition: React.FC<CompositionProps> = ({ shots }) => {
  return (
    <AbsoluteFill className="bg-[#050505]">
      <Series>
        {shots.map((shot) => {
          const durationInFrames = Math.max(
            FPS, 
            Math.round((shot.durationSec || 3.0) * FPS)
          );
          return (
            <Series.Sequence
              key={shot.id}
              durationInFrames={durationInFrames}
            >
              <ShotClip shot={shot} />
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
};

// Web 端连贯预览模块主渲染入口
interface GoldComboPreviewProps {
  shots: WorkbenchShot[];
  className?: string;
}

export const GoldComboPreview: React.FC<GoldComboPreviewProps> = ({ shots, className = "" }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<PlayerRef>(null);

  // 计算总帧率和时长
  const totalFrames = useMemo(() => {
    return shots.reduce((sum, shot) => {
      const frames = Math.max(FPS, Math.round((shot.durationSec || 3.0) * FPS));
      return sum + frames;
    }, 0) || FPS;
  }, [shots]);

  const compositionWidth = 1080;
  const compositionHeight = 1920;

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    player.addEventListener('play', handlePlay);
    player.addEventListener('pause', handlePause);

    return () => {
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('pause', handlePause);
    };
  }, []);

  return (
    <>
      {isPlaying && (
        <div className="fixed inset-0 bg-[#03050a]/75 backdrop-blur-[2px] z-40 animate-in fade-in duration-500 pointer-events-none" />
      )}
      <div className={`relative overflow-hidden rounded-3xl border shadow-2xl transition-all duration-300 ring-1 ring-black/5 ${className} ${isPlaying ? 'relative z-50 shadow-[0_0_60px_rgba(56,189,248,0.2)] border-cyan-500/30' : 'border-slate-200 bg-white/90'}`}>
        {shots.length === 0 ? (
          <div className="aspect-[9/16] w-full flex items-center justify-center bg-slate-100 text-slate-500 font-bold text-xs uppercase">
            暂无分镜镜头数据
          </div>
        ) : (
          <Player
            ref={playerRef}
            component={GoldComboComposition}
            inputProps={{ shots }}
            durationInFrames={totalFrames}
            fps={FPS}
            compositionWidth={compositionWidth}
            compositionHeight={compositionHeight}
            style={{
              width: '100%',
              aspectRatio: '9 / 16',
            }}
            controls
            loop
            autoPlay={false}
            className="w-full h-full object-cover"
          />
        )}
      </div>
    </>
  );
};

export default GoldComboPreview;
