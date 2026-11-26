import type { Tool } from "./types";

/**
 * Description d'un paramètre de commande. Le libellé et l'exemple sont traduits par clé
 * (`f.<type>.<champ>` / `fp.<type>.<champ>`) ; les valeurs de liste sont des identifiants stables
 * (`any`, `other`…) traduits à l'affichage (`o.<valeur>`), les valeurs techniques (zsh, YAML…) restent telles quelles.
 */
export interface FieldDef {
  key: string;
  kind: "text" | "select" | "number" | "toggle" | "area";
  options?: string[];
  suffix?: string;
  /** Suggestions libres (liste de complétion) pour un champ texte. */
  suggestions?: string[];
  wide?: boolean;
}

const OS = ["macOS", "Linux", "Windows", "any"];
const SHELLS = ["zsh", "bash", "sh", "fish", "other"];

/** Paramètres propres à chaque type de commande, stockés dans `prompt.meta`. */
export const TOOL_FIELDS: Partial<Record<Tool, FieldDef[]>> = {
  shell: [
    { key: "shell", kind: "select", options: SHELLS },
    { key: "os", kind: "select", options: OS },
    { key: "workdir", kind: "text" },
    { key: "sudo", kind: "toggle" },
    { key: "dangerous", kind: "toggle" },
    { key: "notes", kind: "area", wide: true },
  ],
  script: [
    { key: "interpreter", kind: "select", options: SHELLS },
    { key: "os", kind: "select", options: OS },
    { key: "file", kind: "text" },
    { key: "sudo", kind: "toggle" },
    { key: "dangerous", kind: "toggle" },
    { key: "notes", kind: "area", wide: true },
  ],
  sql: [
    { key: "engine", kind: "select", options: ["PostgreSQL", "MySQL", "MariaDB", "SQLite", "SQL Server", "Oracle", "other"] },
    { key: "database", kind: "text" },
    { key: "dangerous", kind: "toggle" },
    { key: "notes", kind: "area", wide: true },
  ],
  python: [
    { key: "version", kind: "text", suggestions: ["3.14", "3.13", "3.12", "3.11"] },
    { key: "packages", kind: "text" },
    { key: "notes", kind: "area", wide: true },
  ],
  powershell: [
    { key: "os", kind: "select", options: OS },
    { key: "admin", kind: "toggle" },
    { key: "dangerous", kind: "toggle" },
    { key: "notes", kind: "area", wide: true },
  ],
  config: [
    { key: "format", kind: "select", options: ["YAML", "JSON", "TOML", "INI", ".env", "Dockerfile", "nginx", "other"] },
    { key: "file", kind: "text" },
    { key: "notes", kind: "area", wide: true },
  ],
};
