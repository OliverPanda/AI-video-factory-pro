


import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableShotCard } from './SortableShotCard';

import type { Shot } from '../../types/drama';

interface StoryboardGridProps {
  shots: Shot[];
  onReorder: (newShots: Shot[]) => void;
  onSelectShot: (shot: Shot) => void;
  selectedShotId?: string | null;
}

export default function StoryboardGrid({ 
  shots, 
  onReorder,
  onSelectShot,
  selectedShotId 
}: StoryboardGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
        activationConstraint: {
            distance: 8, // Prevent accidental drags when clicking
        },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = shots.findIndex((shot) => shot.id === active.id);
      const newIndex = shots.findIndex((shot) => shot.id === over.id);
      
      const newShots = arrayMove(shots, oldIndex, newIndex);
      // Update sortOrders to match new index
      const reindexedShots = newShots.map((s, i) => ({ ...s, sortOrder: i }));
      
      onReorder(reindexedShots);
    }
  };

  return (
    <DndContext 
      sensors={sensors} 
      collisionDetection={closestCenter} 
      onDragEnd={handleDragEnd}
    >
      <div className="p-6 h-full overflow-y-auto">
        <SortableContext 
          items={shots.map(s => s.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-20">
            {shots.map((shot, index) => (
              <SortableShotCard 
                key={shot.id} 
                shot={shot}
                index={index}
                isSelected={selectedShotId === shot.id}
                onSelect={() => onSelectShot(shot)}
                onPlay={() => console.log('Play', shot.id)}
                isPlaying={false}
                onRegenerate={() => console.log('Regenerate grid', shot.id)}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </DndContext>
  );
}
