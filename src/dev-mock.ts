/**
 * Faux backend en mémoire, chargé UNIQUEMENT quand l'interface tourne dans un navigateur
 * (npm run dev hors Tauri) : permet de tester l'UI sans l'application native.
 * La vraie logique (SQLite, FTS5, versions…) est dans src-tauri/src/store.rs.
 */
import { mockIPC } from "@tauri-apps/api/mocks";

type Row = Record<string, any>;
const now = () => new Date().toISOString();
let seq = 1;
const id = () => `id-${seq++}`;

export function installDevMock() {
  const folders: Row[] = [
    { id: "my-prompts", name: "Mes commandes", icon: "tray", parentId: null, position: 0, isSystem: true, createdAt: now() },
    ...["Shell", "Docker", "SSH", "Git"].map((name, i) => ({ id: `starter-${i}`, name, icon: "folder", parentId: null, position: i + 1, isSystem: false, createdAt: now() })),
  ];
  const prompts: Row[] = [];
  const versions: Row[] = [];
  const aiState = { provider: "claude", claudeModel: "claude-sonnet-5", geminiModel: "gemini-2.5-flash", keys: { claude: false, gemini: false } };

  // La palette (#palette) tourne dans sa propre page : quelques commandes d'exemple pour la tester seule.
  if (window.location.hash === "#palette") {
    const mk = (title: string, content: string, tool: string, pinned = false) =>
      prompts.push({ id: id(), title, content, pinned, position: prompts.length + 1, folderId: "my-prompts", tool, tags: [], favorite: false, trashedAt: null, meta: {}, useCount: 0, lastUsedAt: null, createdAt: now(), updatedAt: now() });
    mk("Conteneurs actifs", "docker ps --format 'table {{.Names}}\t{{.Status}}'", "shell", true);
    mk("Connexion SSH", "ssh {{utilisateur}}@{{hôte}} -p {{port}}", "shell");
    mk("Taille des tables", "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables;", "sql");
  }

  // Démo (?demo) : jeu d'exemple bilingue pour les captures d'écran des README — aucune donnée réelle.
  if (new URLSearchParams(window.location.search).has("demo")) {
    const fr = (localStorage.getItem("pv.lang") ?? navigator.language).toLowerCase().startsWith("fr");
    const L = (f: string, e: string) => (fr ? f : e);
    const F = { mine: "my-prompts", shell: "starter-0", docker: "starter-1", ssh: "starter-2", git: "starter-3" };
    const t0 = Date.now();
    const mk = (title: string, content: string, folderId: string, tool: string, tags: string[], o: { pinned?: boolean; favorite?: boolean; meta?: Row; ago?: number } = {}) =>
      prompts.push({
        id: id(), title, content, folderId, tool, tags, pinned: !!o.pinned, favorite: !!o.favorite, position: prompts.length + 1,
        trashedAt: null, meta: o.meta ?? {}, useCount: 0, lastUsedAt: null,
        createdAt: new Date(t0 - (o.ago ?? 1) * 3600_000).toISOString(), updatedAt: new Date(t0 - (o.ago ?? 1) * 3600_000).toISOString(),
      });
    mk(
      L("Déployer la stack Compose", "Deploy the Compose stack"),
      L(
        "## Déploiement\nMet à jour les images puis relance les services **sans interruption**.\n\n```bash\ndocker compose pull\ndocker compose up -d --remove-orphans\n```\n\nFichier `compose.yaml` minimal :\n\n```yaml\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\"\n```\n\n> Vérifier ensuite avec `docker compose ps`.",
        "## Deployment\nPulls the images then restarts the services **with no downtime**.\n\n```bash\ndocker compose pull\ndocker compose up -d --remove-orphans\n```\n\nMinimal `compose.yaml`:\n\n```yaml\nservices:\n  web:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\"\n```\n\n> Then check with `docker compose ps`.",
      ),
      F.docker, "shell", ["compose", "docker"], { pinned: true, favorite: true, meta: { shell: "zsh", os: "macOS" }, ago: 2 },
    );
    mk(L("Logs d'un conteneur", "Container logs"), "docker logs -f --tail 100 {{" + L("conteneur", "container") + "}}", F.docker, "shell", ["docker", "logs"], { ago: 5 });
    mk(L("Nettoyer les images", "Prune images"), "docker image prune -a --filter \"until=168h\"", F.docker, "shell", ["docker"], { ago: 30 });
    mk(L("Connexion SSH avec rebond", "SSH through a jump host"), "ssh -J {{" + L("rebond", "jump") + "}} {{" + L("utilisateur", "user") + "}}@{{" + L("hôte", "host") + "}}", F.ssh, "shell", ["ssh"], { favorite: true, ago: 8 });
    mk(L("Copier une clé publique", "Copy a public key"), "ssh-copy-id -i ~/.ssh/id_ed25519.pub {{" + L("utilisateur", "user") + "}}@{{" + L("hôte", "host") + "}}", F.ssh, "shell", ["ssh", L("clés", "keys")], { ago: 50 });
    mk(L("Annuler le dernier commit", "Undo the last commit"), "git reset --soft HEAD~1", F.git, "shell", ["git"], { ago: 3 });
    mk(L("Branches fusionnées à supprimer", "Delete merged branches"), "git branch --merged main | grep -v main | xargs git branch -d", F.git, "shell", ["git"], { ago: 70 });
    mk(L("Espace disque par dossier", "Disk usage by folder"), "du -sh * | sort -h", F.shell, "shell", [L("disque", "disk")], { ago: 12 });
    mk(L("Serveur HTTP local", "Local HTTP server"), "```python\npython3 -m http.server {{port}}\n```", F.mine, "python", ["python", "web"], { ago: 20 });
    mk(L("Taille des tables", "Table sizes"), "SELECT relname, pg_size_pretty(pg_total_relation_size(relid))\nFROM pg_catalog.pg_statio_user_tables\nORDER BY 2 DESC;", F.mine, "sql", ["postgres"], { meta: { engine: "PostgreSQL" }, ago: 90 });
  }

  const sub = (fid: string): string[] => [fid, ...folders.filter((f) => f.parentId === fid).flatMap((f) => sub(f.id))];
  // Épinglés en tête, triés par titre (sinon début du contenu), accents ignorés ; sauf corbeille / récents.
  const key = (s: string) => s.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const sortPinned = (a: Row, b: Row, kind: string) => {
    if (kind === "trash" || kind === "recent" || a.pinned !== b.pinned) return kind === "trash" || kind === "recent" ? 0 : a.pinned ? -1 : 1;
    if (!a.pinned) return 0;
    const ka = key(a.title) || key(a.preview), kb = key(b.title) || key(b.preview);
    return ka.localeCompare(kb) || key(a.preview).localeCompare(key(b.preview));
  };
  const summary = (p: Row) => ({ ...p, preview: p.content.replace(/\n/g, " ").slice(0, 160) });

  const handle = (cmd: string, args: any): unknown => {
    switch (cmd) {
      case "list_folders": return folders;
      case "reorder_folders": { args.ids.forEach((fid: string, i: number) => { const f = folders.find((x) => x.id === fid); if (f) f.position = i + 1; }); return null; }
      case "reorder_prompts": {
        const slots = args.ids.map((pid: string) => prompts.find((p) => p.id === pid)!.position).sort((a: number, b: number) => a - b);
        args.ids.forEach((pid: string, i: number) => { prompts.find((p) => p.id === pid)!.position = slots[i]; });
        return null;
      }
      case "create_folder": { const f = { id: id(), name: args.name, icon: "folder", parentId: args.parentId, position: folders.length + 1, isSystem: false, createdAt: now() }; folders.push(f); return f; }
      case "rename_folder": { const f = folders.find((x) => x.id === args.id)!; f.name = args.name; return f; }
      case "delete_folder": {
        for (const fid of sub(args.id)) prompts.filter((p) => p.folderId === fid).forEach((p) => { p.folderId = "my-prompts"; p.trashedAt ??= now(); });
        const gone = new Set(sub(args.id)); for (let i = folders.length - 1; i >= 0; i--) if (gone.has(folders[i].id)) folders.splice(i, 1);
        return null;
      }
      case "list_prompts": {
        const { kind, id: sid, query } = args.filter;
        const q = (query ?? "").toLowerCase();
        return prompts
          .filter((p) => (kind === "trash" ? p.trashedAt : !p.trashedAt))
          .filter((p) => kind !== "favorites" || p.favorite)
          .filter((p) => kind !== "folder" || p.folderId === sid)
          .filter((p) => kind !== "tool" || p.tool === sid)
          .filter((p) => !q || (p.title + " " + p.content + " " + p.tags.join(" ")).toLowerCase().includes(q))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(summary)
          .sort((a, b) => sortPinned(a, b, kind));
      }
      case "get_prompt": return prompts.find((p) => p.id === args.id);
      case "create_prompt": { const p = { id: id(), title: "", content: "", pinned: false, position: Math.max(0, ...prompts.map((x) => x.position)) + 1, folderId: args.folderId ?? "my-prompts", tool: args.tool ?? "none", tags: [], favorite: false, trashedAt: null, meta: {}, useCount: 0, lastUsedAt: null, createdAt: now(), updatedAt: now() }; prompts.push(p); return p; }
      case "update_prompt": {
        const p = prompts.find((x) => x.id === args.id)!;
        const changed = ("title" in args.patch && args.patch.title !== p.title) || ("content" in args.patch && args.patch.content !== p.content);
        const pinOnly = Object.keys(args.patch).length === 1 && "pinned" in args.patch; // épingler ≠ modifier
        const before = { ...p };
        Object.assign(p, args.patch, pinOnly ? {} : { updatedAt: new Date(Date.now() + seq++).toISOString() });
        if (changed && args.patch.newVersion) {
          if (!versions.some((v) => v.promptId === p.id)) versions.push({ id: seq++, promptId: p.id, title: p.title, content: before.content, savedAt: now() });
          versions.push({ id: seq++, promptId: p.id, title: p.title, content: p.content, savedAt: now() });
        } else if (changed) {
          const mine = versions.filter((v) => v.promptId === p.id);
          const last = mine[mine.length - 1];
          if (last && Date.now() - Date.parse(last.savedAt) < 300_000) Object.assign(last, { title: p.title, content: p.content, savedAt: now() });
          else versions.push({ id: seq++, promptId: p.id, title: p.title, content: p.content, savedAt: now() });
        }
        return p;
      }
      case "trash_prompt": prompts.find((p) => p.id === args.id)!.trashedAt = now(); return null;
      case "restore_prompt": { const p = prompts.find((x) => x.id === args.id)!; p.trashedAt = null; return p; }
      case "delete_prompt_forever": { const i = prompts.findIndex((p) => p.id === args.id); if (i >= 0) prompts.splice(i, 1); return null; }
      case "empty_trash": { let n = 0; for (let i = prompts.length - 1; i >= 0; i--) if (prompts[i].trashedAt) { prompts.splice(i, 1); n++; } return n; }
      case "duplicate_prompt": { const s = prompts.find((p) => p.id === args.id)!; const p = { ...s, id: id(), title: s.title + " (copie)", favorite: false, position: Math.max(0, ...prompts.map((x) => x.position)) + 1, updatedAt: now() }; prompts.push(p); return p; }
      case "mark_used": { const p = prompts.find((x) => x.id === args.id)!; p.useCount++; return null; }
      case "list_versions": return versions.filter((v) => v.promptId === args.promptId).reverse();
      case "restore_version": { const v = versions.find((x) => x.id === args.versionId)!; const p = prompts.find((x) => x.id === v.promptId)!; p.title = v.title; p.content = v.content; return p; }
      case "counts": {
        const live = prompts.filter((p) => !p.trashedAt);
        const by = (k: string) => live.reduce<Record<string, number>>((m, p) => ((m[p[k]] = (m[p[k]] ?? 0) + 1), m), {});
        return { all: live.length, favorites: live.filter((p) => p.favorite).length, trash: prompts.length - live.length, byFolder: by("folderId"), byTool: by("tool") };
      }
      case "list_tags": {
        const n: Record<string, number> = {};
        prompts.filter((p) => !p.trashedAt).forEach((p) => p.tags.forEach((t: string) => (n[t] = (n[t] ?? 0) + 1)));
        return Object.entries(n).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
      }
      case "ai_settings": return { provider: aiState.provider, claudeModel: aiState.claudeModel, geminiModel: aiState.geminiModel, hasClaudeKey: aiState.keys.claude, hasGeminiKey: aiState.keys.gemini };
      case "ai_save_settings": Object.assign(aiState, { provider: args.provider, claudeModel: args.claudeModel || "claude-sonnet-5", geminiModel: args.geminiModel || "gemini-2.5-flash" }); return null;
      case "ai_set_key": if (!String(args.key).trim()) throw "E_AI_NO_KEY"; aiState.keys[args.provider as "claude" | "gemini"] = true; return null;
      case "ai_delete_key": aiState.keys[args.provider as "claude" | "gemini"] = false; return null;
      case "ai_test": { if (!aiState.keys[aiState.provider as "claude" | "gemini"]) throw "E_AI_NO_KEY:" + aiState.provider; return { text: "OK", provider: aiState.provider, model: aiState.provider === "claude" ? aiState.claudeModel : aiState.geminiModel }; }
      case "ai_transform": {
        const p = aiState.provider as "claude" | "gemini";
        if (!aiState.keys[p]) throw "E_AI_NO_KEY:" + p;
        if (!String(args.text).trim()) throw "E_AI_EMPTY_INPUT";
        const t = String(args.text);
        const out: Record<string, string> = { improve: "[Amélioré] " + t, shorten: t.split(" ").slice(0, 4).join(" "), detail: t + " Précisez le contexte et le format attendu.", structure: "Rôle : …\nTâche : " + t, fix: t, translate_fr: "[FR] " + t, translate_en: "[EN] " + t };
        return { text: out[args.action] + (args.instruction ? " (" + args.instruction + ")" : ""), provider: p, model: p === "claude" ? aiState.claudeModel : aiState.geminiModel };
      }
      case "plugin:app|version": return "0.1.0";
      case "palette_choose": return args.paste ? "pasted" : "copied";
      case "palette_hide": return null;
      case "export_markdown": case "export_csv": return args.scope.kind === "prompt" ? 1 : prompts.length;
      case "move_folder": { const f = folders.find((x) => x.id === args.id)!; if (args.parentId && sub(args.id).includes(args.parentId)) throw "Impossible de déplacer un dossier dans lui-même."; f.parentId = args.parentId; return f; }
      default:
        if (cmd === "plugin:dialog|save") return "/tmp/tips-commands-export"; // navigateur : faux chemin
        if (cmd === "plugin:dialog|open") return "/tmp/tips-commands-dir";
        if (cmd === "plugin:dialog|message") return args?.buttons?.OkCancelCustom?.[0] ?? "Ok"; // confirm() : répond « OK »
        return null;
    }
  };

  // Comme le vrai IPC : les réponses sont sérialisées (nouvelles références à chaque appel).
  mockIPC(
    (cmd, args) => {
      const res = handle(cmd, args);
      return res === undefined ? null : JSON.parse(JSON.stringify(res));
    },
    { shouldMockEvents: true },
  );
}
