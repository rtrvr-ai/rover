export function docOf(node: Node | null | undefined): Document {
  // ownerDocument exists on Element/Text; for Document, ownerDocument is null.
  if (!node) return document;
  // @ts-ignore
  return (node as any).ownerDocument || (node as any).document || document;
}

export function winOf(node: Node | null | undefined): Window {
  const d = docOf(node);
  return (d.defaultView || window) as Window;
}
