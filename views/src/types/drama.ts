// Shared types for drama entities
export interface Shot {
  id: string; // Made required as most components expect it
  chapter_id?: string;
  index: number;
  sortOrder?: number; // Used in some cards
  narration: string;
  image_prompt: string;
  image_url?: string;
  imageUrl?: string; // Support for both snake and camel
  status: 'pending' | 'queued' | 'processing' | 'generating_image' | 'image_completed' | 'generating_video' | 'video_completed' | 'failed' | 'cancelled';
  video_url?: string;
  videoUrl?: string; // legacy support if needed
  duration?: string;
  // new fields
  visual_description?: string;
  character_id?: string | null;
  character_name?: string | null;
  scene_id?: string | null;
  // video generation fields
  camera_movement?: string | null;
  video_prompt?: string | null;
}

export interface Chapter {
    id: string;
    project_id: string;
    title: string;
    content: string;
    order: number;
    status: 'draft' | 'pending' | 'analyzing' | 'analysis_completed' | 'storyboard_completed' | 'video_completed';
    shots?: Shot[];
    characters_json?: string; // stringified json
    scenes_json?: string; // stringified json
    created_at?: string;
    // extended fields used in UI
    progress?: number;
    hook?: string;
    emotions_json?: string;
    wordCount?: number;
    number?: number;
}

export interface Character {
  id: string;
  name: string;
  alias?: string | null;
  description?: string | null;
  avatarUrl: string | null;
  voiceId?: string | null;
  voice?: { id: string; name: string } | null;
  prompt?: string | null;
  referenceImages?: string[];
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  imageUrl: string | null;
  prompt?: string;
  tags?: string | null;
}

export interface Voice {
  id: string;
  name: string;
  voiceType: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  coverUrl: string | null;
  style?: string;
  lora_model?: string;
  lora_strength?: number;
  archiveStatus?: string;  // active, archived
  createdAt: string;
  status?: string;
  duration?: string;
  resolution?: string;
  progress?: number;
  chapterCount?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chapters: Chapter[];
  characters?: Character[];
  scenes?: Scene[];
  voices?: Voice[];
}
