import { useEffect, useRef, useState, type RefObject } from "react";
import {
  CaretDown,
  Code,
  CodeBlock,
  Eye,
  Keyboard,
  LinkSimple,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  PencilSimple,
  Quotes,
  TextB,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
} from "@phosphor-icons/react";
import { t, type Key } from "../i18n";

export type MdMode = "edit" | "preview";
type LineKind = "heading" | "bullet" | "numbered" | "task" | "quote";
type Action =
  | "bold" | "italic" | "strike" | "code" | "codeBlock" | "link" | "hr"
  | LineKind;

/** Langages proposés pour les blocs de code (⌥⌘1 … ⌥⌘6). */
export const CODE_LANGS = [
  { id: "bash", label: "Bash" },
  { id: "python", label: "Python" },
  { id: "javascript", label: "JavaScript" },
  { id: "yaml", label: "YAML" },
  { id: "json", label: "JSON" },
  { id: "sql", label: "SQL" },
] as const;

/** Marqueur de commentaire d'une ligne selon le langage (null : pas de commentaire, ex. JSON). */
function commentToken(lang: string): string | null {
  const l = lang.toLowerCase();
  if (/^(bash|sh|zsh|shell|console|python|py|yaml|yml|toml|ini|conf|dockerfile|powershell|ps1|ruby|rb|r|perl|make|makefile)$/.test(l)) return "#";
  if (/^(javascript|js|jsx|typescript|ts|tsx|java|c|cpp|cs|go|rust|rs|swift|kotlin|php|jsonc)$/.test(l)) return "//";
  if (/^(sql|lua|haskell)$/.test(l)) return "--";
  if (l === "json") return null;
  return "#";
}

// ── Édition du texte ─────────────────────────────────────────────────────────

/**
 * Remplace `start..end` puis sélectionne `selStart..selEnd`. `execCommand` garde l'annulation (⌘Z) de la
 * zone de texte ; à défaut, `setRangeText` + un événement `input` (que React reçoit comme un onChange).
 */
function replace(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart: number, selEnd: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
  const ok = text ? document.execCommand("insertText", false, text) : document.execCommand("delete");
  if (!ok) {
    ta.setRangeText(text, start, end);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ta.setSelectionRange(selStart, selEnd);
}

/** Entoure la sélection (`**gras**`…), ou retire l'entourage s'il est déjà là. */
function wrap(ta: HTMLTextAreaElement, before: string, after: string, placeholder: string) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  if (v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
    replace(ta, s - before.length, e + after.length, v.slice(s, e), s - before.length, e - before.length);
    return;
  }
  const inner = v.slice(s, e) || placeholder;
  replace(ta, s, e, before + inner + after, s + before.length, s + before.length + inner.length);
}

const LINE_RE: Record<LineKind, RegExp> = {
  heading: /^#{1,6} /,
  task: /^- \[[ xX]\] /,
  bullet: /^[-*+] (?!\[[ xX]\] )/,
  numbered: /^\d+\. /,
  quote: /^> /,
};
const ANY_PREFIX = /^(#{1,6} |- \[[ xX]\] |[-*+] |\d+\. |> )/;

/** Préfixe chaque ligne sélectionnée (titre, liste, citation) ; si toutes l'ont déjà, le retire. */
function prefixLines(ta: HTMLTextAreaElement, kind: LineKind) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const le = v.indexOf("\n", e) === -1 ? v.length : v.indexOf("\n", e);
  const lines = v.slice(ls, le).split("\n");
  const filled = lines.filter((l) => l.trim());
  const remove = filled.length > 0 && filled.every((l) => LINE_RE[kind].test(l));
  let n = 0;
  const out = lines.map((l) => {
    if (remove) return l.replace(LINE_RE[kind], "");
    if (!l.trim() && lines.length > 1) return l;
    const bare = l.replace(ANY_PREFIX, "");
    const prefix = { heading: "## ", bullet: "- ", task: "- [ ] ", quote: "> ", numbered: `${++n}. ` }[kind];
    return prefix + bare;
  });
  const text = out.join("\n");
  // Une seule ligne : le curseur va en fin de ligne ; plusieurs : le bloc reste sélectionné.
  if (lines.length === 1) replace(ta, ls, le, text, ls + text.length, ls + text.length);
  else replace(ta, ls, le, text, ls, ls + text.length);
}

function codeBlock(ta: HTMLTextAreaElement, lang: string) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const sel = v.slice(s, e).replace(/\n$/, "");
  const lead = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
  const open = `${lead}\`\`\`${lang}\n`;
  const text = `${open}${sel}\n\`\`\`${v[e] === "\n" || e === v.length ? "" : "\n"}`;
  replace(ta, s, e, text, s + open.length, s + open.length + sel.length);
}

function link(ta: HTMLTextAreaElement) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const label = v.slice(s, e) || t("md.linkText");
  const text = `[${label}](https://)`;
  const urlStart = s + label.length + 3;
  replace(ta, s, e, text, urlStart, urlStart + "https://".length);
}

function rule(ta: HTMLTextAreaElement) {
  const { value: v, selectionEnd: e } = ta;
  const lead = e > 0 && v[e - 1] !== "\n" ? "\n\n" : e > 0 && v[e - 2] !== "\n" ? "\n" : "";
  const text = `${lead}---\n`;
  replace(ta, e, e, text, e + text.length, e + text.length);
}

function apply(ta: HTMLTextAreaElement, action: Action, lang: string) {
  switch (action) {
    case "bold": return wrap(ta, "**", "**", t("md.boldText"));
    case "italic": return wrap(ta, "*", "*", t("md.italicText"));
    case "strike": return wrap(ta, "~~", "~~", t("md.strikeText"));
    case "code": return wrap(ta, "`", "`", "code");
    case "codeBlock": return insertCode(ta, lang);
    case "link": return link(ta);
    case "hr": return rule(ta);
    default: return prefixLines(ta, action);
  }
}

interface Fence {
  /** Début et fin de la ligne d'ouverture (```lang). */
  openStart: number;
  openEnd: number;
  /** Début du langage sur la ligne d'ouverture. */
  infoStart: number;
  lang: string;
}

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})(.*)$/gm;

/** Bloc de code qui contient `pos` (ligne d'ouverture et de fermeture comprises), ou null. */
function fenceAt(v: string, pos: number): Fence | null {
  let open: (Fence & { marker: string }) | null = null;
  for (const m of v.matchAll(FENCE_LINE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (!open) {
      if (start > pos) return null;
      open = { openStart: start, openEnd: end, infoStart: start + m[1].length + m[2].length, lang: m[3].trim(), marker: m[2] };
    } else if (m[2][0] === open.marker[0] && m[2].length >= open.marker.length && !m[3].trim()) {
      if (pos <= end) return open;
      open = null;
    }
  }
  return open; // bloc non fermé : jusqu'à la fin du texte
}

/** Le curseur est-il à l'intérieur d'un bloc de code (après sa ligne d'ouverture) ? */
function inFence(v: string, pos: number): boolean {
  const f = fenceAt(v, pos);
  return !!f && pos > f.openEnd;
}

/** Langage en vigueur au curseur : celui du bloc qui l'entoure, sinon celui du type de commande. */
function langAt(v: string, pos: number, fallback: string): string {
  const f = fenceAt(v, pos);
  return f && pos > f.openEnd ? f.lang || fallback : fallback;
}

/** Insère un bloc de code ; dans un bloc existant, change seulement son langage. */
function insertCode(ta: HTMLTextAreaElement, lang: string) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const f = fenceAt(v, s);
  if (!f) return codeBlock(ta, lang);
  const delta = lang.length - (f.openEnd - f.infoStart);
  const move = (p: number) => (p > f.infoStart ? Math.max(f.infoStart, p + delta) : p);
  replace(ta, f.infoStart, f.openEnd, lang, move(s), move(e));
}

/** Lignes touchées par la sélection : [début, fin) ; une fin de sélection en tout début de ligne ne compte pas. */
function lineRange(v: string, s: number, e: number): [number, number] {
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const last = e > s && v[e - 1] === "\n" ? e - 1 : e;
  const nl = v.indexOf("\n", last);
  return [ls, nl === -1 ? v.length : nl];
}

const indentUnit = (lang: string) => (/^(python|py)$/i.test(lang) ? "    " : "  ");

/** ⇥ / ⇧⇥ : indente ou désindente les lignes sélectionnées (4 espaces en Python, 2 sinon). */
function indent(ta: HTMLTextAreaElement, out: boolean, fallback: string) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const unit = indentUnit(langAt(v, s, fallback));
  if (!out && !v.slice(s, e).includes("\n")) {
    replace(ta, s, e, unit, s + unit.length, s + unit.length);
    return;
  }
  const [ls, le] = lineRange(v, s, e);
  const lines = v.slice(ls, le).split("\n");
  let firstDelta = 0;
  const outLines = lines.map((l, i) => {
    let d: number;
    let res: string;
    if (out) {
      const n = l.startsWith("\t") ? 1 : Math.min(l.match(/^ */)![0].length, unit.length);
      d = -n;
      res = l.slice(n);
    } else if (!l.trim()) {
      d = 0;
      res = l;
    } else {
      d = unit.length;
      res = unit + l;
    }
    if (i === 0) firstDelta = d;
    return res;
  });
  const text = outLines.join("\n");
  if (lines.length === 1) {
    const p = Math.max(ls, s + firstDelta);
    replace(ta, ls, le, text, p, Math.max(p, e + firstDelta));
  } else replace(ta, ls, le, text, ls, ls + text.length);
}

/** ⌥↑ / ⌥↓ : déplace les lignes sélectionnées d'un cran. */
function moveLines(ta: HTMLTextAreaElement, dir: -1 | 1): boolean {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const [ls, le] = lineRange(v, s, e);
  const block = v.slice(ls, le);
  if (dir < 0) {
    if (ls === 0) return true;
    const ps = v.lastIndexOf("\n", ls - 2) + 1;
    const prev = v.slice(ps, ls - 1);
    const shift = ls - ps;
    replace(ta, ps, le, `${block}\n${prev}`, s - shift, e - shift);
  } else {
    if (le >= v.length) return true;
    const nl = v.indexOf("\n", le + 1);
    const ne = nl === -1 ? v.length : nl;
    const next = v.slice(le + 1, ne);
    replace(ta, ls, ne, `${next}\n${block}`, s + next.length + 1, e + next.length + 1);
  }
  return true;
}

/** ⇧⌘D : duplique les lignes sélectionnées en dessous. */
function duplicateLines(ta: HTMLTextAreaElement) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const [ls, le] = lineRange(v, s, e);
  const block = v.slice(ls, le);
  const shift = block.length + 1;
  replace(ta, le, le, `\n${block}`, s + shift, e + shift);
}

/** ⌘/ : commente ou décommente les lignes, avec le marqueur du langage (# , // , --). */
function toggleComment(ta: HTMLTextAreaElement, fallback: string) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const tok = commentToken(langAt(v, s, fallback));
  if (!tok) return;
  const [ls, le] = lineRange(v, s, e);
  const lines = v.slice(ls, le).split("\n");
  const filled = lines.filter((l) => l.trim());
  if (!filled.length) return;
  const esc = tok.replace(/[/\-]/g, "\\$&");
  const commented = new RegExp(`^(\\s*)${esc} ?`);
  const remove = filled.every((l) => commented.test(l));
  const minIndent = Math.min(...filled.map((l) => l.match(/^\s*/)![0].length));
  const out = lines.map((l) => {
    if (!l.trim()) return l;
    return remove ? l.replace(commented, "$1") : `${l.slice(0, minIndent)}${tok} ${l.slice(minIndent)}`;
  });
  const text = out.join("\n");
  if (lines.length === 1) {
    const p = Math.max(ls, s + text.length - (le - ls));
    replace(ta, ls, le, text, p, p);
  } else replace(ta, ls, le, text, ls, ls + text.length);
}

/** Entrée dans un bloc de code : garde l'indentation (et l'augmente après « : » en Python / YAML). */
function keepIndent(ta: HTMLTextAreaElement, fallback: string): boolean {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e || !inFence(v, s)) return false;
  const line = v.slice(v.lastIndexOf("\n", s - 1) + 1, s);
  let ind = line.match(/^[ \t]*/)![0];
  const lang = langAt(v, s, fallback);
  if (/^(python|py|yaml|yml)$/i.test(lang) && line.trimEnd().endsWith(":")) ind += indentUnit(lang);
  if (!ind) return false;
  const text = `\n${ind}`;
  replace(ta, s, e, text, s + text.length, s + text.length);
  return true;
}

/**
 * Caractères qui entourent la sélection quand on les tape : `exemple`, "exemple", (exemple)…
 * Le caractère ouvrant comme le fermant fonctionnent : « ( » et « ) » donnent tous deux (exemple).
 */
const PAIRS: [string, string][] = [["`", "`"], ['"', '"'], ["'", "'"], ["(", ")"], ["[", "]"], ["{", "}"]];
const pairFor = (ch: string) => PAIRS.find(([o, c]) => ch === o || ch === c) ?? null;

/** Entoure la sélection avec la paire du caractère `ch` ; renvoie false si `ch` n'en a pas. */
function surround(ta: HTMLTextAreaElement, ch: string): boolean {
  const pair = pairFor(ch);
  if (!pair || ta.selectionStart === ta.selectionEnd) return false;
  wrap(ta, pair[0], pair[1], "");
  lastSurround = Date.now();
  return true;
}

/**
 * Touches mortes (` sur un clavier français : touche à gauche d'Entrée). macOS les traite comme le début
 * d'une composition (` puis e → è). On intercepte la touche ; si la composition démarre malgré tout,
 * la sélection mémorisée au début est entourée quand le caractère est validé (compositionend).
 */
const DEAD_BACKTICK_CODES = new Set(["Backslash", "Backquote", "IntlBackslash"]);
let lastSurround = 0;
let pendingComposition: { start: number; text: string } | null = null;

export function onMarkdownCompositionStart(e: React.CompositionEvent<HTMLTextAreaElement>) {
  const { selectionStart: s, selectionEnd: en, value: v } = e.currentTarget;
  pendingComposition = s !== en && Date.now() - lastSurround > 300 ? { start: s, text: v.slice(s, en) } : null;
}

export function onMarkdownCompositionEnd(e: React.CompositionEvent<HTMLTextAreaElement>) {
  const p = pendingComposition;
  pendingComposition = null;
  const ch = e.data;
  const pair = p && ch ? pairFor(ch) : null;
  if (!p || !pair) return;
  const ta = e.currentTarget;
  // Après l'insertion du caractère composé (qui a remplacé la sélection) : on le remplace par la paire.
  setTimeout(() => {
    if (ta.value.slice(p.start, p.start + ch.length) !== ch) return;
    const text = pair[0] + p.text + pair[1];
    const inner = p.start + pair[0].length;
    replace(ta, p.start, p.start + ch.length, text, inner, inner + p.text.length);
    lastSurround = Date.now();
  }, 0);
}

/** Entrée dans une liste : nouvel élément du même type ; sur un élément vide, sort de la liste. */
function continueList(ta: HTMLTextAreaElement): boolean {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e || inFence(v, s)) return false;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  const line = v.slice(ls, s);
  const m = line.match(/^(\s*)(- \[[ xX]\] |[-*+] |(\d+)\. |> )/);
  if (!m) return false;
  const [prefix, indent, marker, num] = m;
  if (line === prefix) {
    replace(ta, ls, s, indent, ls + indent.length, ls + indent.length);
    return true;
  }
  const next = num ? `${Number(num) + 1}. ` : marker.startsWith("- [") ? "- [ ] " : marker;
  const text = `\n${indent}${next}`;
  replace(ta, s, s, text, s + text.length, s + text.length);
  return true;
}

// ── Raccourcis ───────────────────────────────────────────────────────────────

interface Shortcut {
  action: Action;
  label: string;
  /** Touche physique (`e.code`) : indépendante de la disposition du clavier et de ⌥. */
  code: string;
  shift?: boolean;
  alt?: boolean;
}

const SHORTCUTS: Shortcut[] = [
  { action: "bold", label: "⌘B", code: "KeyB" },
  { action: "italic", label: "⌘I", code: "KeyI" },
  { action: "strike", label: "⇧⌘X", code: "KeyX", shift: true },
  { action: "heading", label: "⇧⌘H", code: "KeyH", shift: true },
  { action: "code", label: "⌘E", code: "KeyE" },
  { action: "codeBlock", label: "⌥⌘C", code: "KeyC", alt: true },
  { action: "bullet", label: "⇧⌘8", code: "Digit8", shift: true },
  { action: "numbered", label: "⇧⌘7", code: "Digit7", shift: true },
  { action: "task", label: "⇧⌘L", code: "KeyL", shift: true },
  { action: "quote", label: "⇧⌘9", code: "Digit9", shift: true },
  { action: "link", label: "⌘K", code: "KeyK" },
];
export const PREVIEW_SHORTCUT = "⇧⌘P";

/** Raccourcis de la zone de texte ; renvoie `true` si la touche a été traitée. */
export function handleMarkdownKey(e: React.KeyboardEvent<HTMLTextAreaElement>, lang: string): boolean {
  const ta = e.currentTarget;
  const done = () => {
    e.preventDefault();
    return true;
  };
  // Sélection + ` " ' ( ) [ ] { } : entoure au lieu de remplacer. Testé avant le garde « composition »,
  // car la touche morte ` est justement signalée comme le début d'une composition.
  if (!e.metaKey && !e.ctrlKey && ta.selectionStart !== ta.selectionEnd) {
    const dead = e.key === "Dead" || e.nativeEvent.keyCode === 229;
    const ch = dead ? (DEAD_BACKTICK_CODES.has(e.code) && !e.shiftKey && !e.altKey ? "`" : "") : e.key;
    if (ch && surround(ta, ch)) return done();
  }
  if (e.nativeEvent.isComposing || e.ctrlKey) return false;
  const plain = !e.metaKey && !e.altKey;

  if (e.key === "Enter" && plain && !e.shiftKey) {
    return continueList(ta) || keepIndent(ta, lang) ? done() : false;
  }
  if (e.key === "Tab" && plain) {
    indent(ta, e.shiftKey, lang);
    return done();
  }
  if ((e.key === "ArrowUp" || e.key === "ArrowDown") && e.altKey && !e.metaKey && !e.shiftKey) {
    moveLines(ta, e.key === "ArrowUp" ? -1 : 1);
    return done();
  }
  if (!e.metaKey) return false;

  if (e.code === "Slash" && !e.altKey) {
    toggleComment(ta, lang);
    return done();
  }
  if (e.code === "KeyD" && e.shiftKey && !e.altKey) {
    duplicateLines(ta);
    return done();
  }
  // ⌥⌘1 … ⌥⌘6 : bloc de code dans un langage précis.
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && e.altKey && !e.shiftKey && CODE_LANGS[Number(digit[1]) - 1]) {
    insertCode(ta, CODE_LANGS[Number(digit[1]) - 1].id);
    return done();
  }
  const sc = SHORTCUTS.find((x) => x.code === e.code && !!x.shift === e.shiftKey && !!x.alt === e.altKey);
  if (!sc) return false;
  apply(ta, sc.action, lang);
  return done();
}

/** Raccourcis sans bouton, listés dans l'aide (clé de libellé, touches). */
const EXTRA_SHORTCUTS: [Key, string][] = [
  ["md.sc.surround", "` \" ' ( ) [ ] { }"],
  ["md.sc.indent", "⇥ / ⇧⇥"],
  ["md.sc.move", "⌥↑ / ⌥↓"],
  ["md.sc.duplicate", "⇧⌘D"],
  ["md.sc.comment", "⌘/"],
  ["md.sc.preview", PREVIEW_SHORTCUT],
];

// ── Barre ────────────────────────────────────────────────────────────────────

const ICON = { size: 16, "aria-hidden": true } as const;
const BUTTONS: (Action | "|")[] = [
  "heading", "bold", "italic", "strike", "|",
  "code", "codeBlock", "|",
  "bullet", "numbered", "task", "quote", "|",
  "link", "hr",
];
const ICONS: Record<Action, React.ReactNode> = {
  heading: <TextHTwo {...ICON} />,
  bold: <TextB {...ICON} weight="bold" />,
  italic: <TextItalic {...ICON} />,
  strike: <TextStrikethrough {...ICON} />,
  code: <Code {...ICON} />,
  codeBlock: <CodeBlock {...ICON} />,
  bullet: <ListBullets {...ICON} />,
  numbered: <ListNumbers {...ICON} />,
  task: <ListChecks {...ICON} />,
  quote: <Quotes {...ICON} />,
  link: <LinkSimple {...ICON} />,
  hr: <Minus {...ICON} />,
};

interface Props {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  mode: MdMode;
  onMode: (mode: MdMode) => void;
  /** Langage proposé pour les blocs de code (bash, sql…). */
  lang: string;
  disabled: boolean;
}

/** Ferme un menu au clic extérieur ou sur Échap. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** Barre de mise en forme Markdown au-dessus de l'éditeur, avec bascule Édition / Aperçu. */
export function MarkdownToolbar({ textareaRef, mode, onMode, lang, disabled }: Props) {
  const editing = mode === "edit" && !disabled;
  const [menu, setMenu] = useState<"lang" | "help" | null>(null);
  const close = () => setMenu(null);
  const langRef = useDismiss(menu === "lang", close);
  const helpRef = useDismiss(menu === "help", close);
  const keep = (e: React.MouseEvent) => e.preventDefault(); // garde le focus (et la sélection) dans la zone de texte

  return (
    <div className="md-toolbar" role="toolbar" aria-label={t("md.toolbar")}>
      {BUTTONS.map((b, i) => {
        if (b === "|") return <span key={i} className="md-sep" />;
        const sc = SHORTCUTS.find((x) => x.action === b);
        const label = b === "codeBlock" && lang ? `${t("md.codeBlock")} ${lang}` : t(`md.${b}` as Key);
        const button = (
          <button
            key={b}
            className="icon-btn md-btn"
            title={sc ? `${label} (${sc.label})` : label}
            aria-label={label}
            disabled={!editing}
            onMouseDown={keep}
            onClick={() => textareaRef.current && apply(textareaRef.current, b, lang)}
          >
            {ICONS[b]}
          </button>
        );
        if (b !== "codeBlock") return button;
        return (
          <div key={b} className="md-split" ref={langRef}>
            {button}
            <button
              className="icon-btn md-caret"
              title={t("md.langMenu")}
              aria-label={t("md.langMenu")}
              aria-haspopup="menu"
              aria-expanded={menu === "lang"}
              disabled={!editing}
              onMouseDown={keep}
              onClick={() => setMenu(menu === "lang" ? null : "lang")}
            >
              <CaretDown size={10} weight="bold" aria-hidden />
            </button>
            {menu === "lang" && (
              <div className="md-menu" role="menu">
                <div className="md-menu-title">{t("md.langMenu")}</div>
                {CODE_LANGS.map((l, n) => (
                  <button
                    key={l.id}
                    role="menuitem"
                    className="md-menu-item"
                    onMouseDown={keep}
                    onClick={() => {
                      close();
                      if (textareaRef.current) insertCode(textareaRef.current, l.id);
                    }}
                  >
                    <span>{l.label}</span>
                    <kbd>⌥⌘{n + 1}</kbd>
                  </button>
                ))}
                <div className="md-menu-hint">{t("md.langHint")}</div>
              </div>
            )}
          </div>
        );
      })}
      <span className="spacer" />
      <div className="md-split" ref={helpRef}>
        <button
          className="icon-btn md-btn"
          title={t("md.shortcuts")}
          aria-label={t("md.shortcuts")}
          aria-expanded={menu === "help"}
          onMouseDown={keep}
          onClick={() => setMenu(menu === "help" ? null : "help")}
        >
          <Keyboard {...ICON} />
        </button>
        {menu === "help" && (
          <div className="md-menu md-help" role="dialog" aria-label={t("md.shortcuts")}>
            <div className="md-menu-title">{t("md.shortcuts")}</div>
            {SHORTCUTS.map((sc) => (
              <div key={sc.action} className="md-help-row">
                <span>{t(`md.${sc.action}` as Key)}</span>
                <kbd>{sc.label}</kbd>
              </div>
            ))}
            <div className="md-help-row">
              <span>{t("md.codeBlock")} : {CODE_LANGS.map((l) => l.label).join(", ")}</span>
              <kbd>⌥⌘1…6</kbd>
            </div>
            {EXTRA_SHORTCUTS.map(([k, keys]) => (
              <div key={k} className="md-help-row">
                <span>{t(k)}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="md-mode" role="group">
        <button
          className={"md-mode-btn" + (mode === "edit" ? " on" : "")}
          title={`${t("md.edit")} (${PREVIEW_SHORTCUT})`}
          disabled={disabled}
          onClick={() => onMode("edit")}
        >
          <PencilSimple size={14} aria-hidden /> {t("md.edit")}
        </button>
        <button
          className={"md-mode-btn" + (mode === "preview" ? " on" : "")}
          title={`${t("md.preview")} (${PREVIEW_SHORTCUT})`}
          onClick={() => onMode("preview")}
        >
          <Eye size={14} aria-hidden /> {t("md.preview")}
        </button>
      </div>
    </div>
  );
}
