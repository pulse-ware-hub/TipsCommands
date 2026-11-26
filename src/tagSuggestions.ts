import type { Tool } from "./types";

/** Outils en ligne de commande proposés à la complétion des tags, avec les types de commande correspondants. */
export const COMMAND_TAGS: { name: string; tools: Tool[] }[] = [
  // Conteneurs et orchestration
  { name: "docker", tools: ["shell", "script", "config"] },
  { name: "docker compose", tools: ["shell", "config"] },
  { name: "kubectl", tools: ["shell", "script"] },
  { name: "helm", tools: ["shell"] },
  { name: "podman", tools: ["shell"] },
  // Accès distant et transferts
  { name: "ssh", tools: ["shell", "script", "config"] },
  { name: "scp", tools: ["shell"] },
  { name: "rsync", tools: ["shell", "script"] },
  { name: "curl", tools: ["shell", "script", "powershell"] },
  { name: "wget", tools: ["shell"] },
  // Versionnage
  { name: "git", tools: ["shell", "script", "powershell"] },
  { name: "gh", tools: ["shell"] },
  // Système et fichiers
  { name: "brew", tools: ["shell", "script"] },
  { name: "apt", tools: ["shell", "script"] },
  { name: "systemctl", tools: ["shell", "script"] },
  { name: "launchctl", tools: ["shell"] },
  { name: "cron", tools: ["shell", "config"] },
  { name: "find", tools: ["shell", "script"] },
  { name: "grep", tools: ["shell", "script"] },
  { name: "sed", tools: ["shell", "script"] },
  { name: "awk", tools: ["shell", "script"] },
  { name: "tar", tools: ["shell", "script"] },
  { name: "ffmpeg", tools: ["shell", "script"] },
  { name: "openssl", tools: ["shell", "script"] },
  { name: "réseau", tools: ["shell", "script", "powershell"] },
  { name: "disque", tools: ["shell", "script", "powershell"] },
  { name: "processus", tools: ["shell", "script", "powershell"] },
  // Langages et paquets
  { name: "npm", tools: ["shell", "script"] },
  { name: "pnpm", tools: ["shell"] },
  { name: "node", tools: ["shell", "script"] },
  { name: "pip", tools: ["shell", "python"] },
  { name: "venv", tools: ["shell", "python"] },
  { name: "cargo", tools: ["shell"] },
  // Bases de données
  { name: "psql", tools: ["shell", "sql"] },
  { name: "mysql", tools: ["shell", "sql"] },
  { name: "sqlite3", tools: ["shell", "sql"] },
  { name: "PostgreSQL", tools: ["sql"] },
  { name: "backup", tools: ["shell", "script", "sql"] },
  // Cloud et infra
  { name: "aws", tools: ["shell", "script"] },
  { name: "gcloud", tools: ["shell", "script"] },
  { name: "az", tools: ["shell", "powershell"] },
  { name: "terraform", tools: ["shell", "config"] },
  { name: "ansible", tools: ["shell", "config"] },
  { name: "nginx", tools: ["shell", "config"] },
  // Windows
  { name: "winget", tools: ["powershell"] },
  { name: "WSL", tools: ["powershell", "shell"] },
];

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const MAX = 8;

/** Tri alphabétique des tags (accents et casse ignorés). */
export const sortTags = (tags: string[]): string[] =>
  [...new Set(tags)].sort((a, b) => norm(a).localeCompare(norm(b)));

/**
 * Suggestions pour la saisie d'un tag, par ordre alphabétique. Avec une saisie : d'abord ceux qui
 * commencent par le texte, puis ceux dont un mot commence ainsi (« compose » → docker compose), puis les
 * autres correspondances. Sans saisie : les outils du type de commande courant. Tags déjà posés exclus ;
 * tags de la bibliothèque et outils confondus.
 */
export function suggestTags(
  input: string,
  tool: Tool,
  library: { tag: string; count: number }[],
  current: string[],
): string[] {
  const q = norm(input.replace(/^#/, ""));
  const taken = new Set(current.map(norm));
  const seen = new Set<string>();
  const pool: string[] = [];
  const add = (name: string) => {
    const k = norm(name);
    if (!seen.has(k) && !taken.has(k)) {
      seen.add(k);
      pool.push(name);
    }
  };
  if (!q) {
    COMMAND_TAGS.filter((m) => m.tools.includes(tool)).forEach((m) => add(m.name));
    return pool.sort((a, b) => norm(a).localeCompare(norm(b))).slice(0, MAX);
  }
  library.forEach((t) => add(t.tag));
  COMMAND_TAGS.forEach((m) => add(m.name));
  const rank = (name: string): number | null => {
    const n = norm(name);
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : null;
  };
  return pool
    .map((name) => ({ name, r: rank(name) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r! - b.r! || norm(a.name).localeCompare(norm(b.name)))
    .slice(0, MAX)
    .map((x) => x.name);
}
