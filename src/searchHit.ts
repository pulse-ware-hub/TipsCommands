/**
 * Occurrence de la recherche dans le contenu d'une commande, avec les mêmes règles que la recherche
 * plein texte (store.rs, `fts_query`) : casse et accents ignorés, chaque mot cherché en début de mot.
 * On vise d'abord la phrase entière, sinon le mot cherché qui apparaît le plus tôt.
 */

/** Texte normalisé (minuscules, sans accents) et, pour chaque caractère, sa position d'origine. */
function normalize(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const n = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < n.length; k++) map.push(i);
    norm += n;
    i += ch.length;
  }
  map.push(s.length);
  return { norm, map };
}

const normText = (s: string) => normalize(s).norm;
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Termes cherchés : la phrase entière (si plusieurs mots), puis chaque mot (lettres et chiffres seuls). */
export function searchTerms(query: string): { phrase: string | null; words: string[] } {
  const q = normText(query).trim().replace(/\s+/g, " ");
  // Mots découpés comme l'index de recherche : « pare-feu » → « pare », « feu ».
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return { phrase: words.length > 1 ? q : null, words };
}

/** Première occurrence de `needle` dans `norm` ; `wordStart` : seulement en début de mot. */
function indexIn(norm: string, needle: string, from: number, wordStart: boolean): number {
  for (let i = norm.indexOf(needle, from); i !== -1; i = norm.indexOf(needle, i + 1)) {
    if (!wordStart || !isWordChar(norm[i - 1])) return i;
  }
  return -1;
}

export interface Hit {
  start: number;
  end: number;
}

/**
 * Toutes les occurrences (sans chevauchement), triées. `auto` : la phrase si elle est présente, sinon les mots ;
 * `phrase` / `words` : seulement l'un des deux.
 */
export function findHits(text: string, query: string, mode: "auto" | "phrase" | "words" = "auto"): Hit[] {
  const { norm, map } = normalize(text);
  const { phrase, words } = searchTerms(query);
  const collect = (needles: string[], wordStart: boolean): Hit[] => {
    const hits: Hit[] = [];
    for (const n of needles) {
      if (!n) continue;
      for (let i = indexIn(norm, n, 0, wordStart); i !== -1; i = indexIn(norm, n, i + n.length, wordStart)) {
        hits.push({ start: map[i], end: map[i + n.length] });
      }
    }
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    let end = -1;
    return hits.filter((h) => (h.start >= end ? ((end = h.end), true) : false));
  };
  if (phrase && mode !== "words") {
    const p = collect([phrase], false);
    if (p.length || mode === "phrase") return p;
  }
  return mode === "phrase" ? [] : collect(words, true);
}

/** Fait défiler une zone de texte pour que la position `pos` soit visible (au tiers supérieur). */
export function scrollTextareaTo(ta: HTMLTextAreaElement, pos: number) {
  // Copie invisible de la zone (mêmes largeur, police, marges) pour mesurer la hauteur du texte avant `pos`,
  // retours à la ligne automatiques compris.
  const cs = getComputedStyle(ta);
  const mirror = document.createElement("div");
  for (const p of ["font", "letterSpacing", "lineHeight", "padding", "border", "boxSizing", "tabSize", "wordSpacing"] as const) {
    mirror.style[p] = cs[p];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    width: `${ta.clientWidth}px`,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
  });
  mirror.textContent = ta.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = "​";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  mirror.remove();
  ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
}

/** Surligne les occurrences dans un aperçu HTML (nœuds texte) ; renvoie le premier surlignage. */
export function markHits(root: HTMLElement, query: string): HTMLElement | null {
  const { phrase, words } = searchTerms(query);
  // Même choix que dans l'éditeur : la phrase si elle figure dans un même bloc de texte, sinon les mots.
  if (phrase) {
    const first = markWith(root, (text) => findHits(text, query, "phrase"));
    if (first) return first;
  }
  return words.length ? markWith(root, (text) => findHits(text, query, "words")) : null;
}

function markWith(root: HTMLElement, hitsOf: (text: string) => Hit[]): HTMLElement | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(".code-copy, .code-lang, mark.search-hit") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let first: HTMLElement | null = null;
  for (const node of nodes) {
    const text = node.data;
    const hits = hitsOf(text);
    if (!hits.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const h of hits) {
      frag.append(text.slice(last, h.start));
      const mark = document.createElement("mark");
      mark.className = "search-hit";
      mark.textContent = text.slice(h.start, h.end);
      frag.append(mark);
      first ??= mark;
      last = h.end;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return first;
}
