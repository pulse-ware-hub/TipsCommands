/**
 * Glisser-déposer interne (prompt → dossier / outil / corbeille, dossier → dossier ; en tri manuel,
 * prompt / dossier / type avant ou après un autre pour choisir l'ordre).
 * Pendant un `dragover`, WebKit ne donne pas accès aux données : on garde donc la charge en mémoire.
 */
export type DragPayload = { type: "prompt" | "folder" | "tool"; id: string };

/** Position de dépôt d'après la hauteur du pointeur dans l'élément survolé. */
export function dropSide(e: React.DragEvent, withInside: boolean): "before" | "after" | "inside" {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (!withInside) return y < 0.5 ? "before" : "after";
  return y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
}

let current: DragPayload | null = null;

export const dragPayload = () => current;

export function startDrag(e: React.DragEvent, payload: DragPayload, label: string) {
  current = payload;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", label);
}

export const endDrag = () => {
  current = null;
};
