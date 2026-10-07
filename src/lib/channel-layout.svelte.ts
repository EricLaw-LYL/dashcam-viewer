import { CHANNELS } from './model';
import type { Channel } from './model';
function restored() {
  try {
    const value = JSON.parse(localStorage.getItem('dashcam-channel-layout') || 'null');
    if (
      value?.order?.length === 3 &&
      new Set(value.order).size === 3 &&
      value.order.every((c: Channel) => CHANNELS.includes(c)) &&
      Array.isArray(value.visible) &&
      value.visible.every((c: Channel) => CHANNELS.includes(c))
    )
      return value as { order: Channel[]; visible: Channel[] };
  } catch {}
  return { order: [...CHANNELS], visible: [...CHANNELS] };
}
export const channelLayout = $state(restored());
export function saveChannelLayout() {
  localStorage.setItem('dashcam-channel-layout', JSON.stringify(channelLayout));
}
