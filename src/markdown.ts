import { marked } from "marked";
import DOMPurify from "dompurify";

/** Blocs de code délimités (```bash … ``` ou ~~~ … ~~~) : groupe 2 = contenu. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n {0,3}\1[ \t]*$/gm;

/**
 * Texte à copier ou coller dans le Terminal : les blocs de code s'il y en a (séparés par une ligne vide),
 * sinon tout le contenu — une commande saisie sans mise en forme reste copiée telle quelle.
 */
export function commandText(content: string): string {
  const blocks = [...content.matchAll(FENCE_RE)].map((m) => m[2]);
  return blocks.length ? blocks.join("\n\n") : content;
}

/** Markdown → HTML assaini (GitHub Flavored Markdown, retours à la ligne conservés). */
export function renderMarkdown(content: string): string {
  const html = marked.parse(content, { gfm: true, breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
}
