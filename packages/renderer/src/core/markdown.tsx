import { Fragment, type ReactNode } from "react";

// A small Markdown renderer that builds React elements (never HTML strings):
// headings, paragraphs, lists, checklists, quotes, code, rules, and inline
// bold / italic / strike / code / links. Checklist boxes report the source
// line so callers can toggle them.

const SAFE_LINK = /^(https?:|mailto:)/i;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const k = `${key}-${n++}`;
    if (match[1]) out.push(<code key={k}>{match[1].slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={k}>{inline(match[2], k)}</strong>);
    else if (match[3]) out.push(<s key={k}>{inline(match[3], k)}</s>);
    else if (match[4] || match[5]) out.push(<em key={k}>{inline(match[4] || match[5], k)}</em>);
    else if (match[6]) out.push(SAFE_LINK.test(match[7]) ? <a key={k} href={match[7]} target="_blank" rel="noreferrer">{inline(match[6], k)}</a> : match[0]);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type ListItem = { line: number; text: string; checked: boolean | null };

export function renderMarkdown(source: string, onToggle?: (line: number) => void): ReactNode {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;
    if (!line.trim()) { i += 1; continue; }
    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i += 1;
      blocks.push(<pre key={key}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = (["h2", "h3", "h4"] as const)[heading[1].length - 1];
      blocks.push(<Tag key={key}>{inline(heading[2], key)}</Tag>);
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(<hr key={key} />); i += 1; continue; }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key}>{inline(body.join(" "), key)}</blockquote>);
      continue;
    }
    const bullet = /^\s*[-*+]\s+/;
    const ordered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const items: ListItem[] = [];
      while (i < lines.length && (isOrdered ? ordered : bullet).test(lines[i])) {
        const text = lines[i].replace(isOrdered ? ordered : bullet, "");
        const box = /^\[( |x|X)\]\s+(.*)$/.exec(text);
        items.push({ line: i, text: box ? box[2] : text, checked: box ? box[1] !== " " : null });
        i += 1;
      }
      const children = items.map((item) => <li key={item.line} data-checked={item.checked === null ? undefined : item.checked}>
        {item.checked !== null ? <input type="checkbox" checked={item.checked} disabled={!onToggle} onChange={() => onToggle?.(item.line)} aria-label={item.text} /> : null}
        <span>{inline(item.text, `${key}-${item.line}`)}</span>
      </li>);
      blocks.push(isOrdered ? <ol key={key}>{children}</ol> : <ul key={key} data-checklist={items.some((item) => item.checked !== null) || undefined}>{children}</ul>);
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s|-{3,}\s*$)/.test(lines[i])) body.push(lines[i++]);
    blocks.push(<p key={key}>{body.map((text, index) => <Fragment key={index}>{index ? <br /> : null}{inline(text, `${key}-${index}`)}</Fragment>)}</p>);
  }
  return blocks;
}

/** Flip the checklist box on a source line. */
export function toggleMarkdownCheck(source: string, line: number) {
  const lines = source.split("\n");
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (box) => (box === "[ ]" ? "[x]" : "[ ]"));
  return lines.join("\n");
}
