// STUB — owned by the ui agent. Base station panels + inventory. open(name) pauses the world (main checks isOpen).
export function createPanels(ctx) {
  return { isOpen: false, current: null, open(name, data) {}, close() {}, update(dt) {} };
}
