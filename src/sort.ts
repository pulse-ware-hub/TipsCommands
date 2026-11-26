import { useSyncExternalStore } from "react";
import { getLang } from "./i18n";
import type { Folder, PromptSummary, Selection } from "./types";

/**
 * Tri des listes (règle IHM) : ordre alphabétique par défaut (casse et accents ignorés, nombres
 * dans l'ordre naturel : 2 avant 10), avec un tri manuel au choix. Les éléments système
 * (« Mes commandes », épinglés) gardent leur place fixe en tête.
 */

// ── Comparaison de texte ─────────────────────────────────────────────────────

let collator: Intl.Collator | null = null;
let collatorLang = "";

export function compareText(a: string, b: string): number {
  const lang = getLang();
  if (!collator || collatorLang !== lang) {
    collator = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
    collatorLang = lang;
  }
  return collator.compare(a.trim(), b.trim());
}

/** Copie triée par ordre alphabétique du texte affiché. */
export const sortByText = <T>(items: readonly T[], text: (x: T) => string): T[] =>
  [...items].sort((a, b) => compareText(text(a), text(b)));

/** Valeurs de liste triées ; `last` (« Autre », « Indifférent »…) restent en fin, dans leur ordre. */
export function sortOptions(options: readonly string[], text: (o: string) => string, last: readonly string[] = []): string[] {
  const fixed = last.filter((o) => options.includes(o));
  return [...sortByText(options.filter((o) => !fixed.includes(o)), text), ...fixed];
}

// ── Préférences de tri (mémorisées, partagées avec la fenêtre de la palette) ──

export type ListSort = "alpha" | "alphaDesc" | "updated" | "manual";
export type SideSort = "alpha" | "alphaDesc" | "manual";
type Prefs = { list: ListSort; folders: SideSort; tools: SideSort };

const KEYS: Record<keyof Prefs, string> = { list: "pv.sort.list", folders: "pv.sort.folders", tools: "pv.sort.tools" };
const ALLOWED: Record<keyof Prefs, readonly string[]> = {
  list: ["alpha", "alphaDesc", "updated", "manual"],
  folders: ["alpha", "alphaDesc", "manual"],
  tools: ["alpha", "alphaDesc", "manual"],
};
const TOOL_ORDER_KEY = "pv.toolOrder";

const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((f) => f());
const subscribe = (f: () => void) => {
  subscribers.add(f);
  return () => subscribers.delete(f);
};
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key?.startsWith("pv.sort.") || e.key === TOOL_ORDER_KEY) notify();
  });
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
  notify();
};

export function getSort<K extends keyof Prefs>(name: K): Prefs[K] {
  const v = read(KEYS[name]);
  return (v && ALLOWED[name].includes(v) ? v : "alpha") as Prefs[K];
}
export const setSort = <K extends keyof Prefs>(name: K, value: Prefs[K]) => write(KEYS[name], value);
export const useSort = <K extends keyof Prefs>(name: K): Prefs[K] =>
  useSyncExternalStore(subscribe, () => getSort(name));

/** Le tri manuel des dossiers a-t-il déjà été initialisé (à partir de l'ordre alphabétique) ? */
export const folderManualReady = () => read("pv.sort.folders.ready") === "1";
export const markFolderManualReady = () => write("pv.sort.folders.ready", "1");

/** Ordre manuel des types de commande (identifiants). */
export function getToolOrder(): string[] {
  try {
    const v = JSON.parse(read(TOOL_ORDER_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
export const setToolOrder = (ids: string[]) => write(TOOL_ORDER_KEY, JSON.stringify(ids));
let toolOrderCache = { raw: "", ids: [] as string[] };
export const useToolOrder = (): string[] =>
  useSyncExternalStore(subscribe, () => {
    const raw = read(TOOL_ORDER_KEY) ?? "";
    if (raw !== toolOrderCache.raw) toolOrderCache = { raw, ids: getToolOrder() };
    return toolOrderCache.ids;
  });

// ── Commandes ────────────────────────────────────────────────────────────────

/** Texte de tri d'une commande : son titre, ou à défaut le début de son contenu. */
const promptLabel = (p: PromptSummary) => p.title.trim() || p.preview.trim();
const byName = (a: PromptSummary, b: PromptSummary) =>
  compareText(promptLabel(a), promptLabel(b)) || compareText(a.preview, b.preview);

/**
 * Ordre d'affichage de la liste. « Récents » reste chronologique (c'est sa raison d'être) ;
 * ailleurs les épinglés restent en tête (sauf dans la corbeille), chaque groupe trié selon `mode`.
 */
export function sortPrompts(items: PromptSummary[], mode: ListSort, kind: Selection["kind"]): PromptSummary[] {
  if (kind === "recent") return items;
  const cmp: Record<ListSort, (a: PromptSummary, b: PromptSummary) => number> = {
    alpha: byName,
    alphaDesc: (a, b) => byName(b, a),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || byName(a, b),
    manual: (a, b) => a.position - b.position || byName(a, b),
  };
  const sorted = [...items].sort(cmp[mode]);
  if (kind === "trash") return sorted;
  return [...sorted.filter((p) => p.pinned), ...sorted.filter((p) => !p.pinned)];
}

// ── Dossiers et types ────────────────────────────────────────────────────────

/** Frères d'un même parent : le dossier système d'abord, puis selon `mode`. */
export function sortFolders(siblings: Folder[], mode: SideSort): Folder[] {
  const cmp = (a: Folder, b: Folder) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
    if (mode === "manual") return a.position - b.position || compareText(a.name, b.name);
    return mode === "alphaDesc" ? compareText(b.name, a.name) : compareText(a.name, b.name);
  };
  return [...siblings].sort(cmp);
}

/** Enfants de chaque dossier (clé `null` = racine), triés. */
export function folderTree(folders: Folder[], mode: SideSort): Map<string | null, Folder[]> {
  const map = new Map<string | null, Folder[]>();
  for (const f of folders) map.set(f.parentId, [...(map.get(f.parentId) ?? []), f]);
  for (const [k, v] of map) map.set(k, sortFolders(v, mode));
  return map;
}

/** Types de commande triés selon `mode` (ordre manuel : `order`, les types absents à la fin par nom). */
export function sortTools<T extends { id: string }>(list: T[], mode: SideSort, order: string[], text: (x: T) => string): T[] {
  const alpha = sortByText(list, text);
  if (mode === "alphaDesc") return alpha.reverse();
  if (mode !== "manual") return alpha;
  const rank = (x: T) => {
    const i = order.indexOf(x.id);
    return i === -1 ? order.length + alpha.indexOf(x) : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/** Déplace `id` juste avant ou après `target` dans `ids`. */
export function moveId(ids: string[], id: string, target: string, where: "before" | "after"): string[] {
  const out = ids.filter((x) => x !== id);
  const i = out.indexOf(target);
  if (i === -1) return ids;
  out.splice(where === "before" ? i : i + 1, 0, id);
  return out;
}
