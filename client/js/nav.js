// Client-side navigation (History API). main.js registers the renderer.
let renderer = () => {};
let hardReload = false;
export const setRenderer = fn => (renderer = fn);
// After a service-worker update, the next navigation loads the new version.
export const reloadOnNextNav = () => (hardReload = true);
export function go(path, replace = false) {
  if (hardReload) return location.assign(path);
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  renderer();
}
