import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SceneCard } from './SceneCard';
import type { StoryboardScene } from '../../types/storyboard';
import { Plus } from 'lucide-react';

// Simple ID generator if uuid is not available
const generateId = () => Math.random().toString(36).substr(2, 9);

interface StoryboardContainerProps {
  scenes: StoryboardScene[];
  setScenes: React.Dispatch<React.SetStateAction<StoryboardScene[]>>;
  currentPlayingId?: string;
  onPreviewScene: (scene: StoryboardScene) => void;
}

export const StoryboardContainer: React.FC<StoryboardContainerProps> = ({
  scenes,
  setScenes,
  currentPlayingId,
  onPreviewScene
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
        activationConstraint: {
            distance: 5, // Prevent accidental drags when clicking input
        }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setScenes((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleAddScene = () => {
    const newScene: StoryboardScene = {
      id: generateId(),
      type: 'image',
      content: {
        src: 'https://placehold.co/600x400/1f2937/white?text=New+Scene', // Placeholder
        prompt: '',
      },
      script: {
        text: '',
        duration: 0,
      },
      duration: 4,
    };
    setScenes([...scenes, newScene]);
  };

  const handleUpdateScene = (id: string, updates: Partial<StoryboardScene>) => {
    setScenes(scenes.map(scene => 
      scene.id === id ? { ...scene, ...updates } : scene
    ));
  };

  const handleRemoveScene = (id: string) => {
    setScenes(scenes.filter(scene => scene.id !== id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="flex items-start gap-4 p-6 overflow-x-auto min-h-[400px]">
        <SortableContext
          items={scenes.map(s => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          {scenes.map((scene, index) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              index={index}
              onRemove={handleRemoveScene}
              onUpdate={handleUpdateScene}
              onPreview={onPreviewScene}
              isActive={scene.id === currentPlayingId}
            />
          ))}
        </SortableContext>

        {/* Add Button */}
        <button
          onClick={handleAddScene}
          className="flex flex-col items-center justify-center w-64 h-80 border-2 border-dashed border-slate-200 rounded-xl hover:border-slate-400 text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
        >
          <Plus size={48} className="mb-2 opacity-50" />
          <span className="font-medium">添加分镜</span>
        </button>
      </div>
    </DndContext>
  );
};
