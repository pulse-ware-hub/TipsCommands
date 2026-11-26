import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { fullDate } from "../format";
import type { Folder, Prompt, PromptChanges, Tool, Version } from "../types";
import { DEFAULT_FOLDER_ID, tools } from "../types";
import { t, tn } from "../i18n";
import { extractVariables, renderPrompt } from "../vars";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Copy, DotsThree, PushPin, Sparkle, Star, X } from "@phosphor-icons/react";
import { AiPanel } from "./AiPanel";
import { TagInput } from "./TagInput";
import { ToolFields } from "./ToolFields";
import { sortTags } from "../tagSuggestions";
import { commandText } from "../markdown";
import {
  handleMarkdownKey,
  MarkdownToolbar,
  onMarkdownCompositionEnd,
  onMarkdownCompositionStart,
  type MdMode,
} from "./MarkdownToolbar";
import { MarkdownPreview } from "./MarkdownPreview";
import { findHits, scrollTextareaTo } from "../searchHit";
import { folderTree, sortTools, useSort, useToolOrder, type SideSort } from "../sort";

interface Props {
  prompt: Prompt;
  folders: Folder[];
  /** Ouvert depuis un résultat de recherche : aller à la première occurrence de `query` dans le contenu. */
  jump?: { query: string; n: number } | null;
  onSave: (id: string, patch: PromptChanges) => Promise<void>;
  onToggleFavorite: (p: Prompt) => void;
  onTogglePin: (p: Prompt) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCopied: (id: string) => void;
  onVersionRestored: () => void;
  onExportPrompt: (id: string) => void;
  onOpenSettings: () => void;
  /** Boutons de la bande haute : ceux des volets repliés (barre latérale, liste). */
  bar?: React.ReactNode;
  notify: (msg: string) => void;
}

const SAVE_DELAY_MS = 600;
const MODE_KEY = "pv.mdMode";

/** Langage proposé pour un nouveau bloc de code, d'après le type de commande. */
function fenceLang(tool: Tool, meta: Record<string, unknown>): string {
  switch (tool) {
    case "sql": return "sql";
    case "python": return "python";
    case "powershell": return "powershell";
    case "config": return typeof meta.format === "string" && /^[a-z]+$/i.test(meta.format) ? meta.format.toLowerCase() : "";
    default: return "bash";
  }
}

function savedMode(): MdMode {
  try {
    return localStorage.getItem(MODE_KEY) === "preview" ? "preview" : "edit";
  } catch {
    return "edit";
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Liste plate « avec retrait » des dossiers pour un <select>. */
function folderOptions(folders: Folder[], mode: SideSort): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const tree = folderTree(folders, mode); // même ordre que la barre latérale
  const walk = (parent: string | null, depth: number) => {
    for (const f of tree.get(parent) ?? []) {
      out.push({ id: f.id, label: `${" ".repeat(depth)}${f.id === DEFAULT_FOLDER_ID ? t("folder.default") : f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export const Editor = forwardRef<HTMLInputElement, Props>(function Editor(props, titleRef) {
  const { prompt, folders } = props;
  const readOnly = prompt.trashedAt !== null;

  const [title, setTitle] = useState(prompt.title);
  const [content, setContent] = useState(prompt.content);
  const [tags, setTags] = useState(() => sortTags(prompt.tags));
  const [meta, setMeta] = useState<Record<string, unknown>>(prompt.meta ?? {});
  const [library, setLibrary] = useState<{ tag: string; count: number }[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [mode, setModeState] = useState<MdMode>(savedMode);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const setMode = useCallback((next: MdMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* préférence non mémorisée */
    }
    if (next === "edit") setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  // ── Sauvegarde différée : les modifications sont fusionnées puis envoyées ensemble.
  const pending = useRef<Partial<Omit<Prompt, "id">>>({});
  const timer = useRef<number | null>(null);
  const { onSave } = props;
  const promptId = prompt.id;

  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) await onSave(promptId, patch);
  }, [onSave, promptId]);

  const queue = useCallback(
    (patch: Partial<Omit<Prompt, "id">>) => {
      pending.current = { ...pending.current, ...patch };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Enregistre ce qui reste quand on change de prompt ou qu'on quitte.
  useEffect(() => () => void flush(), [flush]);
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    return () => window.removeEventListener("beforeunload", onHide);
  }, [flush]);

  useEffect(() => {
    api.listTags().then(setLibrary).catch(() => setLibrary([]));
  }, [promptId]);

  // Résultat de recherche cliqué : en Édition, l'occurrence est sélectionnée et amenée à l'écran ;
  // l'aperçu (et l'aperçu affiché plus tard) surligne les occurrences et centre la première.
  const [highlight, setHighlight] = useState<{ query: string; n: number } | null>(null);
  const jumped = useRef(0);
  const { jump } = props;
  useEffect(() => {
    if (!jump) {
      setHighlight(null); // recherche effacée ou modifiée : plus de surlignage
      return;
    }
    if (jumped.current === jump.n) return;
    jumped.current = jump.n;
    const hit = findHits(content, jump.query)[0];
    if (!hit) {
      setHighlight(null); // trouvé seulement dans le titre ou les tags
      return;
    }
    setHighlight(jump);
    const ta = textareaRef.current;
    if (mode === "edit" && !readOnly && ta) {
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(hit.start, hit.end);
      scrollTextareaTo(ta, hit.start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump]);

  // ⇧⌘P : bascule Édition / Aperçu (une commande à la corbeille reste en lecture).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && !e.altKey && e.code === "KeyP") {
        e.preventDefault();
        setMode(mode === "edit" || readOnly ? "preview" : "edit");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, readOnly, setMode]);

  const variables = useMemo(() => extractVariables(content), [content]);
  const rendered = useMemo(() => renderPrompt(content, values), [content, values]);
  const missing = variables.filter((v) => !values[v]);
  const folderSort = useSort("folders");
  const toolSort = useSort("tools");
  const toolOrder = useToolOrder();
  const options = folderOptions(folders, folderSort); // recalculé à chaque rendu : les noms suivent la langue
  const toolChoices = sortTools(tools(), toolSort, toolOrder, (x) => x.label);

  const copy = async (text: string, label: string) => {
    if (await copyText(text)) {
      props.notify(label);
      props.onCopied(prompt.id);
    } else {
      props.notify(t("ed.copyFailed"));
    }
  };

  const openVersions = async () => setVersions(await api.listVersions(prompt.id));

  const moreMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.right - 200,
      y: r.bottom + 4,
      items: [
        { label: t("ctx.duplicate"), onClick: () => props.onDuplicate(prompt.id) },
        { label: t("ctx.versions"), onClick: () => void openVersions() },
        { label: t("ctx.exportMd"), onClick: () => props.onExportPrompt(prompt.id) },
        { label: "", onClick: () => {}, separator: true },
        { label: t("ctx.trash"), danger: true, onClick: () => props.onTrash(prompt.id) },
      ],
    });
  };

  return (
    <section className="editor-pane">
      <div className="drag-region" data-tauri-drag-region />
      <div className="pane-bar">{props.bar}</div>
      {readOnly && (
        <div className="banner">
          <span>{t("ed.inTrash")}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => props.onRestore(prompt.id)}>
            {t("ctx.restore")}
          </button>
          <button className="btn danger" onClick={() => props.onDeleteForever(prompt.id)}>
            {t("ed.deleteForever")}
          </button>
        </div>
      )}
      <header className="editor-head">
        <span className="muted">
          {t("ed.modified", { date: fullDate(prompt.updatedAt) })}
          {prompt.useCount > 0 ? tn("ed.used", prompt.useCount) : ""}
        </span>
        <span className="spacer" />
        {!readOnly && (
          <>
            <button
              className={"icon-btn big pin-btn" + (prompt.pinned ? " on" : "")}
              title={prompt.pinned ? t("ed.unpinTip") : t("ed.pinTip")}
              onClick={() => props.onTogglePin(prompt)}
            >
              <PushPin size={17} weight={prompt.pinned ? "fill" : "regular"} aria-hidden />
            </button>
            <button
              className={"icon-btn big" + (prompt.favorite ? " on" : "")}
              title={t("ed.favoriteTip")}
              onClick={() => props.onToggleFavorite(prompt)}
            >
              <Star size={17} weight={prompt.favorite ? "fill" : "regular"} aria-hidden />
            </button>
            <button className="btn ai-btn" title={t("ai.buttonTip")} onClick={() => setAiOpen(true)}>
              <Sparkle size={14} weight="fill" aria-hidden /> {t("ai.button")}
            </button>
            <button className="btn" title={t("ed.copyTip")} onClick={() => copy(commandText(content), t("ed.copied"))}>
              <Copy size={14} aria-hidden /> {t("ed.copy")}
            </button>
            <button className="icon-btn big" title={t("ed.more")} onClick={moreMenu}>
              <DotsThree size={20} weight="bold" aria-hidden />
            </button>
          </>
        )}
      </header>

      <input
        ref={titleRef}
        className="title-input"
        placeholder={t("ed.titlePlaceholder")}
        value={title}
        disabled={readOnly}
        onChange={(e) => {
          setTitle(e.target.value);
          queue({ title: e.target.value });
        }}
      />

      <div className="meta-row">
        <label>
          {t("ed.tool")}
          <select
            value={prompt.tool}
            disabled={readOnly}
            onChange={(e) => void props.onSave(prompt.id, { tool: e.target.value as Tool })}
          >
            <option value="none">{t("tool.none.short")}</option>
            {toolChoices.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("ed.folder")}
          <select
            value={prompt.folderId}
            disabled={readOnly}
            onChange={(e) => void props.onSave(prompt.id, { folderId: e.target.value })}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <TagInput
          tags={tags}
          tool={prompt.tool}
          library={library}
          disabled={readOnly}
          onChange={(next) => {
            setTags(next);
            queue({ tags: next });
          }}
        />
      </div>

      <ToolFields
        tool={prompt.tool}
        meta={meta}
        disabled={readOnly}
        onChange={(next) => {
          setMeta(next);
          queue({ meta: next });
        }}
      />

      <MarkdownToolbar
        textareaRef={textareaRef}
        mode={readOnly ? "preview" : mode}
        onMode={setMode}
        lang={fenceLang(prompt.tool, meta)}
        disabled={readOnly}
      />
      {mode === "edit" && !readOnly ? (
        <textarea
          ref={textareaRef}
          className="content-input"
          placeholder={t("ed.contentPlaceholder")}
          value={content}
          spellCheck={false}
          onKeyDown={(e) => handleMarkdownKey(e, fenceLang(prompt.tool, meta))}
          onCompositionStart={onMarkdownCompositionStart}
          onCompositionEnd={onMarkdownCompositionEnd}
          onChange={(e) => {
            setContent(e.target.value);
            queue({ content: e.target.value });
          }}
        />
      ) : (
        <MarkdownPreview
          content={content}
          highlight={highlight}
          onCopyCode={(code) => void copy(code, t("ed.copiedBlock"))}
        />
      )}

      {variables.length > 0 && (
        <div className="vars-panel">
          <div className="vars-head">
            <strong>{t("ed.vars")}</strong>
            <span className="muted">{t("ed.varsCount", { n: variables.length })}</span>
            <span className="spacer" />
            <button
              className="btn primary"
              onClick={() =>
                copy(
                  commandText(rendered),
                  missing.length ? t("ed.copiedMissing", { n: missing.length }) : t("ed.copiedFilled"),
                )
              }
            >
              <Copy size={14} aria-hidden /> {t("ed.copyWithValues")}
            </button>
          </div>
          <div className="vars-grid">
            {variables.map((v) => (
              <label key={v}>
                <span>{v}</span>
                <input
                  value={values[v] ?? ""}
                  placeholder={`{{${v}}}`}
                  onChange={(e) => setValues((prev) => ({ ...prev, [v]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <pre className="vars-preview">{commandText(rendered)}</pre>
        </div>
      )}

      {versions && (
        <div className="drawer" onClick={() => setVersions(null)}>
          <div className="drawer-card" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <strong>{t("ed.versionsTitle")}</strong>
              <span className="spacer" />
              <button className="icon-btn big" onClick={() => setVersions(null)} aria-label={t("ed.close")}>
                <X size={16} weight="bold" aria-hidden />
              </button>
            </div>
            <div className="scroll">
              {versions.length === 0 && <div className="empty">{t("ed.noVersions")}</div>}
              {versions.map((v, i) => (
                <div key={v.id} className="version">
                  <div className="version-top">
                    <strong>{fullDate(v.savedAt)}</strong>
                    {i === 0 && <span className="tag">{t("ed.current")}</span>}
                    <span className="spacer" />
                    {i > 0 && !readOnly && (
                      <button
                        className="btn"
                        onClick={async () => {
                          await flush();
                          await api.restoreVersion(v.id);
                          setVersions(null);
                          props.onVersionRestored();
                        }}
                      >
                        {t("ctx.restore")}
                      </button>
                    )}
                  </div>
                  <div className="version-title">{v.title || t("list.untitled")}</div>
                  <pre>{v.content.slice(0, 600)}</pre>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {aiOpen && (
        <AiPanel
          content={content}
          tool={prompt.tool}
          meta={meta}
          onApply={async (text) => {
            await flush(); // enregistre d'abord ce qui était en cours de frappe
            setContent(text);
            // `newVersion` : l'ancien texte reste consultable dans l'historique, même juste après une modification.
            await props.onSave(prompt.id, { content: text, newVersion: true });
            props.notify(t("ai.applied"));
          }}
          onCopy={(text) => void copy(text, t("ed.copied"))}
          onOpenSettings={props.onOpenSettings}
          onClose={() => setAiOpen(false)}
        />
      )}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </section>
  );
});
