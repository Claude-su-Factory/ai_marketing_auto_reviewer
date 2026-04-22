import { EventEmitter } from "events";
export const fsWatchEmitter = new EventEmitter();
export function fakeFsWatch(path: string, cb: (ev: string, name: string) => void) {
  const h = (name: string) => cb("change", name);
  fsWatchEmitter.on(`change:${path}`, h);
  return { close: () => fsWatchEmitter.off(`change:${path}`, h) };
}
