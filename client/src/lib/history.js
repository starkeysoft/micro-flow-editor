// Undo/redo over JSON snapshots of the graph.
import { ref, computed } from 'vue';

export function createHistory(limit = 100) {
  const stack = ref([]);
  const index = ref(-1);

  return {
    reset(snapshot) {
      stack.value = [snapshot];
      index.value = 0;
    },
    // Records a snapshot if it differs from the current one.
    push(snapshot) {
      if (stack.value[index.value] === snapshot) return;
      stack.value = stack.value.slice(0, index.value + 1);
      stack.value.push(snapshot);
      if (stack.value.length > limit) stack.value.shift();
      index.value = stack.value.length - 1;
    },
    current: () => stack.value[index.value],
    undo() {
      if (index.value <= 0) return null;
      index.value--;
      return stack.value[index.value];
    },
    redo() {
      if (index.value >= stack.value.length - 1) return null;
      index.value++;
      return stack.value[index.value];
    },
    canUndo: computed(() => index.value > 0),
    canRedo: computed(() => index.value < stack.value.length - 1),
  };
}
