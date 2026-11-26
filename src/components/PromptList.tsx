import { Fragment, forwardRef, useState } from "react";
import type { Folder, PromptSummary, Selection } from "../types";
import { DEFAULT_FOLDER_ID, toolInfo } from "../types";
import { ArrowsDownUp, PushPin, Plus, Star } from "@phosphor-icons/react";
import { ToolIcon } from "./Icons";
import { dragPayload, dropSide, endDrag, startDrag } from "../dnd";
import { compareText, sortFolders, type ListSort } from "../sort";
import { t, tn } from "../i18n";
import { relativeDate } from "../format";
import { ContextMenu, type MenuItem } from "./ContextMenu";

interface Props {
  title: string;
  selection: Selection;
  /** Déjà triés dans l'ordre d'affichage. */
  items: PromptSummary[];
  sort: ListSort;
  onSort: (mode: ListSort) => void;
  /** Tri manuel : place la commande `id` avant / après `targetId`. */
  onReorder: (id: string, targetId: string, where: "before" | "after") => void;
  selectedId: string | null;
  folders: Folder[];
  query: string;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onToggleFavorite: (p: PromptSummary) => void;
  onTogglePin: (p: PromptSummary) => void;
  onExportPrompt: (id: string) => void;
  onMove: (id: string, folderId: string) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onEmptyTrash: () => void;
  /** Boutons de la bande haute (à côté des pastilles si la barre latérale est repliée). */
  bar?: React.ReactNode;
}

export const PromptList = forwardRef<HTMLInputElement, Props>(function PromptList(p, searchRef) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const inTrash = p.selection.kind === "trash";
  const isRecent = p.selection.kind === "recent";
  // Glisser une commande avant / après une autre : seulement en tri manuel, hors corbeille et « Récents ».
  const canReorder = p.sort === "manual" && !inTrash && !isRecent;

  const sortMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const modes: ListSort[] = inTrash ? ["alpha", "alphaDesc", "updated"] : ["alpha", "alphaDesc", "updated", "manual"];
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      items: modes.map((m) => ({ label: t(`sort.${m}`), checked: m === p.sort, onClick: () => p.onSort(m) })),
    });
  };
  const moveTargets = sortFolders(p.folders, "alpha"); // « Mes commandes » d'abord, puis A → Z
  // Séparateurs « Épinglés » / « Autres » : seulement si la liste en contient et qu'elle est triée ainsi
  // (pas dans la corbeille ni dans « Récents », qui restent chronologiques).
  const showGroups = !inTrash && p.selection.kind !== "recent" && p.items.some((it) => it.pinned);

  const folderName = (id: string) =>
    id === DEFAULT_FOLDER_ID ? t("folder.default") : (p.folders.find((f) => f.id === id)?.name ?? "");

  const openMenu = (e: React.MouseEvent, it: PromptSummary) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = inTrash
      ? [
          { label: t("ctx.restore"), onClick: () => p.onRestore(it.id) },
          { label: t("ctx.deleteForever"), danger: true, onClick: () => p.onDeleteForever(it.id) },
        ]
      : [
          { label: it.pinned ? t("ctx.unpin") : t("ctx.pin"), onClick: () => p.onTogglePin(it) },
          { label: it.favorite ? t("ctx.unfavorite") : t("ctx.favorite"), onClick: () => p.onToggleFavorite(it) },
          { label: t("ctx.duplicate"), onClick: () => p.onDuplicate(it.id) },
          { label: t("ctx.exportMd"), onClick: () => p.onExportPrompt(it.id) },
          { label: "", onClick: () => {}, separator: true },
          ...moveTargets
            .filter((f) => f.id !== it.folderId)
            .slice(0, 12)
            .map((f) => ({ label: t("ctx.moveTo", { name: f.id === DEFAULT_FOLDER_ID ? t("folder.default") : f.name }), onClick: () => p.onMove(it.id, f.id) })),
          { label: "", onClick: () => {}, separator: true },
          { label: t("ctx.trash"), danger: true, onClick: () => p.onTrash(it.id) },
        ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <section className="list-pane">
      <div className="drag-region" data-tauri-drag-region />
      <div className="pane-bar">{p.bar}</div>
      <header className="list-header">
        <div className="list-title">
          <h2>{p.title}</h2>
          <span className="muted">{tn("list.count", p.items.length)}</span>
          {!isRecent && (
            <button
              className="sort-btn"
              title={`${t("sort.by")} : ${t(`sort.${p.sort}`)}`}
              aria-label={t("sort.title")}
              onClick={sortMenu}
            >
              <ArrowsDownUp size={12} aria-hidden /> {t(`sort.short.${p.sort}`)}
            </button>
          )}
        </div>
        {inTrash ? (
          <button className="btn" disabled={!p.items.length} onClick={p.onEmptyTrash}>
            {t("list.emptyTrash")}
          </button>
        ) : (
          <button className="btn primary" onClick={p.onNew} title={t("list.newTitle")}>
            <Plus size={13} weight="bold" aria-hidden /> {t("list.new")}
          </button>
        )}
      </header>
      <div className="search">
        <input
          ref={searchRef}
          type="search"
          placeholder={t("list.search")}
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
        />
      </div>
      <div className="scroll">
        {p.items.length === 0 && (
          <div className="empty">
            {p.query ? t("list.noResults") : inTrash ? t("list.trashEmpty") : t("list.none")}
          </div>
        )}
        {p.items.map((it, i) => (
          <Fragment key={it.id}>
            {showGroups && i === 0 && it.pinned && <div className="group-title"><PushPin size={11} weight="fill" aria-hidden /> {t("list.pinned")}</div>}
            {showGroups && !it.pinned && (i === 0 || p.items[i - 1].pinned) && (
              <div className="group-title">{i === 0 ? t("list.first") : t("list.others")}</div>
            )}
          <div
            className={
              "item" + (it.id === p.selectedId ? " active" : "") + (drop?.id === it.id ? " drop-" + drop.side : "")
            }
            title={canReorder ? t("sort.manualHint") : undefined}
            draggable={!inTrash}
            onDragStart={(e) => startDrag(e, { type: "prompt", id: it.id }, it.title || "Prompt")}
            onDragEnd={() => {
              endDrag();
              setDrop(null);
            }}
            onDragOver={(e) => {
              const d = dragPayload();
              if (!canReorder || d?.type !== "prompt" || d.id === it.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDrop({ id: it.id, side: dropSide(e, false) as "before" | "after" });
            }}
            onDragLeave={() => setDrop((d) => (d?.id === it.id ? null : d))}
            onDrop={(e) => {
              const d = dragPayload();
              const side = drop?.id === it.id ? drop.side : null;
              setDrop(null);
              if (!canReorder || d?.type !== "prompt" || d.id === it.id || !side) return;
              e.preventDefault();
              endDrag();
              p.onReorder(d.id, it.id, side);
            }}
            onClick={() => p.onSelect(it.id)}
            onContextMenu={(e) => openMenu(e, it)}
          >
            <div className="item-top">
              <span className="item-title">{it.title || t("list.untitled")}</span>
              {it.pinned && !inTrash && (
                <span className="pin" title={t("list.pinnedTip")}>
                  <PushPin size={12} weight="fill" aria-hidden />
                </span>
              )}
              {it.favorite && (
                <span className="star" title={t("list.favoriteTip")}>
                  <Star size={12} weight="fill" aria-hidden />
                </span>
              )}
            </div>
            <div className="item-meta">
              <span className="date">{relativeDate(it.updatedAt)}</span>
              <span className="preview">{it.preview || t("list.noContent")}</span>
            </div>
            <div className="item-foot">
              <span title={toolInfo(it.tool).label} className="tool-badge">
                <ToolIcon tool={it.tool} size={14} />
              </span>
              <span className="muted">{folderName(it.folderId)}</span>
              {[...it.tags].sort(compareText).slice(0, 3).map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          </Fragment>
        ))}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </section>
  );
});
