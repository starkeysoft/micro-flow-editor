import { reactive } from 'vue';

export const toasts = reactive([]);
let next = 1;

export function toast(text, tone = 'info', ms = 3500) {
  const id = next++;
  toasts.push({ id, text, tone });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}
