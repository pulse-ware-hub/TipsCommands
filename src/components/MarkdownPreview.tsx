import { useEffect, useMemo, useRef } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "../markdown";
import { markHits } from "../searchHit";
import { t } from "../i18n";

interface Props {
  content: string;
  /** Recherche à surligner ; la première occurrence est centrée une fois par `n`. */
  highlight?: { query: string; n: number } | null;
  /** Copie d'un bloc de code (bouton « Copier » affiché sur chaque bloc). */
  onCopyCode: (code: string) => void;
}

/** Aperçu Markdown : liens ouverts dans le navigateur, bouton de copie sur chaque bloc de code. */
export function MarkdownPreview({ content, highlight, onCopyCode }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(content), [content]);
  const scrolled = useRef(0);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // Retire un surlignage précédent avant d'en poser un nouveau.
    root.querySelectorAll("mark.search-hit").forEach((m) => m.replaceWith(m.textContent ?? ""));
    root.normalize();
    if (!highlight) return;
    const first = markHits(root, highlight.query);
    first?.classList.add("current");
    if (first && scrolled.current !== highlight.n) {
      scrolled.current = highlight.n;
      // Défilement de l'aperçu seul (scrollIntoView décalerait aussi les volets parents).
      const top = first.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      root.scrollTop = Math.max(0, top - root.clientHeight / 2);
    }
  }, [html, highlight]);

  useEffect(() => {
    ref.current?.querySelectorAll("pre").forEach((pre) => {
      if (pre.querySelector(".code-copy")) return; // effet rejoué (mode strict) : un seul bouton
      const lang = /(?:^|\s)language-([\w+#.-]+)/.exec(pre.querySelector("code")?.className ?? "")?.[1];
      if (lang) {
        const badge = document.createElement("span");
        badge.className = "code-lang";
        badge.textContent = lang;
        pre.appendChild(badge);
      }
      const btn = document.createElement("button");
      btn.className = "btn code-copy";
      btn.type = "button";
      btn.textContent = t("ed.copy");
      pre.appendChild(btn);
    });
  }, [html]);

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const copy = target.closest(".code-copy");
    if (copy) {
      const code = copy.parentElement?.querySelector("code")?.textContent ?? "";
      onCopyCode(code.replace(/\n$/, ""));
      return;
    }
    const a = target.closest("a");
    if (a) {
      // Un lien ne doit jamais remplacer la fenêtre de l'application : il s'ouvre dans le navigateur.
      e.preventDefault();
      const href = a.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) void openUrl(href).catch(() => {});
    }
  };

  return content.trim() ? (
    <div ref={ref} className="md-preview" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className="md-preview empty-preview muted">{t("md.emptyPreview")}</div>
  );
}
