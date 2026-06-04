import { Series, OffthreadVideo, AbsoluteFill } from 'remotion';
import React from 'react';

export interface VideoSegment {
  url: string;
  durationInFrames: number;
}

export interface PreviewCompositionProps {
  segments: VideoSegment[];
}

/**
 * Single Video Clip Component
 */
const VideoClip: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo 
        src={segment.url} 
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain', 
        }}
      />
    </AbsoluteFill>
  );
};

export const PreviewComposition: React.FC<PreviewCompositionProps> = ({ segments }) => {
  if (!segments || segments.length === 0) {
    return (
      <AbsoluteFill style={{ 
        backgroundColor: '#050505',
        color: '#999', 
        justifyContent: 'center', 
        alignItems: 'center',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 24,
        fontWeight: 600
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
           <div style={{ opacity: 0.3 }}>Empty Preview Sequence</div>
           <div style={{ fontSize: 14, opacity: 0.5, fontWeight: 400 }}>No video segments provided</div>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Series>
        {segments.map((segment, index) => (
          <Series.Sequence 
            key={`${segment.url}-${index}`} 
            durationInFrames={segment.durationInFrames}
          >
            <VideoClip segment={segment} />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};

export default PreviewComposition;
