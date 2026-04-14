export function isRoverWidgetHost(el: Element): boolean {
  try {
    return el.id === 'rover-widget-root';
  } catch {
    return false;
  }
}
