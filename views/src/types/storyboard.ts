export interface StoryboardScene {
  id: string; // UUID
  type: 'image' | 'video';
  content: {
    src: string; // Image or Video URL
    prompt?: string;
    thumbnail?: string; // Optional thumbnail for video
  };
  script: {
    text: string;
    audioSrc?: string; // TTS Audio URL
    duration: number; // Audio duration in seconds
  };
  transition?: {
    type: 'fade' | 'none' | 'slide';
    duration: number;
  };
  duration: number; // Scene duration (video length or image display time)
}

export interface StoryboardConfig {
  resolution: '1080p' | '720p' | '4k';
  aspectRatio: '16:9' | '9:16';
  globalBgm?: {
    src: string;
    volume: number; // 0.0 - 1.0
  };
}

export interface StoryboardProject {
  id: string;
  name: string;
  scenes: StoryboardScene[];
  config: StoryboardConfig;
  lastModified: number;
}

export interface StoryboardShotRecord {
  id: string;
  index: number;
  title: string;
  scene: string;
  cameraType: string;
  durationSec: number;
  dialogue: string;
  action: string;
  speaker: string;
  characters: string[];
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  status: string;
}

export interface StoryboardEditablePayload {
  projectId: string;
  scriptId: string;
  episodeId: string;
  title: string;
  shots: StoryboardShotRecord[];
}
