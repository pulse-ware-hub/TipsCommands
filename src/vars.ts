/**
 * Variables de commande : `{{nom}}` (espaces et accents autorisés).
 * Les gabarits Go de Docker, kubectl… (`{{.Names}}`, `{{json .}}`, `{{end}}`) ne sont pas des variables :
 * un nom contenant un point, ou un mot-clé de gabarit, est laissé tel quel.
 */
const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const TEMPLATE_KEYWORDS = new Set(["end", "else"]);

const isVariable = (name: string) => !name.includes(".") && !TEMPLATE_KEYWORDS.has(name);

export function extractVariables(content: string): string[] {
  const seen = new Set<string>();
  for (const m of content.matchAll(VAR_RE)) {
    const name = m[1].trim();
    if (isVariable(name)) seen.add(name);
  }
  return [...seen];
}

/** Remplace les variables renseignées ; les vides et les gabarits restent tels quels (`{{nom}}`). */
export function renderPrompt(content: string, values: Record<string, string>): string {
  return content.replace(VAR_RE, (whole, name: string) => {
    const v = isVariable(name.trim()) ? values[name.trim()] : undefined;
    return v ? v : whole;
  });
}
