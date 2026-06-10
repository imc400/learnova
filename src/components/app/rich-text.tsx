import type { ReactNode } from "react";

/*
  Markdown LIGERO para texto generado por IA (**negrita**, *cursiva*).
  Sin dangerouslySetInnerHTML: se parsea a nodos React — lo que no calza
  con el patrón se muestra tal cual. El contenedor decide el whitespace
  (las lecciones usan whitespace-pre-wrap para respetar saltos de línea).
*/

const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /\*([^*\n]+)\*/g;

function renderItalics(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(ITALIC_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(<em key={`${keyBase}-i${i++}`}>{m[1]}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(BOLD_RE)) {
    if (m.index! > last) out.push(...renderItalics(text.slice(last, m.index), `t${i}`));
    out.push(
      <strong key={`b${i++}`} className="font-semibold text-foreground">
        {m[1]}
      </strong>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...renderItalics(text.slice(last), `t${i}`));
  return <>{out}</>;
}
