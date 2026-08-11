import type { PlacementKey } from './orderView';

type Listener = () => void;

export interface OrderSelectionStore {
  isSelected: (key: PlacementKey) => boolean;
  select: (key: PlacementKey | null) => void;
  subscribe: (key: PlacementKey, listener: Listener) => () => void;
}

/** Keyed listeners notify only the previously and newly selected cards. */
export function createOrderSelectionStore(): OrderSelectionStore {
  let selected: PlacementKey | null = null;
  const listeners = new Map<PlacementKey, Set<Listener>>();
  const emit = (key: PlacementKey | null) => {
    if (key === null) return;
    for (const listener of listeners.get(key) ?? []) listener();
  };
  return {
    isSelected: (key) => selected === key,
    select: (key) => {
      if (selected === key) return;
      const previous = selected;
      selected = key;
      emit(previous);
      emit(key);
    },
    subscribe: (key, listener) => {
      let keyed = listeners.get(key);
      if (!keyed) {
        keyed = new Set();
        listeners.set(key, keyed);
      }
      keyed.add(listener);
      return () => {
        keyed!.delete(listener);
        if (keyed!.size === 0) listeners.delete(key);
      };
    },
  };
}
