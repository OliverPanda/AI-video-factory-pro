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
