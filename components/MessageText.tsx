import { Fragment, type ReactNode } from "react";

// Shows a chat message the way WhatsApp/Slack do: *bold*, _italic_, ~strike~, `code`, ```blocks```,
// clickable links and the original line breaks. Built as React nodes (no HTML injection).

const URL_RE = /https?:\/\/[^\s<>"']+/;
const TOKEN = new RegExp(
  [
    "```[\\s\\S]+?```", // code block
    "`[^`\\n]+`", // inline code
    URL_RE.source, // link
    "(?<![\\w*])\\*(?!\\s)[^*\\n]+?(?<!\\s)\\*(?![\\w*])", // *bold*
    "(?<![\\w_])_(?!\\s)[^_\\n]+?(?<!\\s)_(?![\\w_])", // _italic_
    "(?<![\\w~])~(?!\\s)[^~\\n]+?(?<!\\s)~(?![\\w~])", // ~strike~
  ].join("|"),
  "g",
);

function format(text: string, dark: boolean, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${depth}-${at}`;
    if (tok.startsWith("```")) {
      out.push(
        <code key={key} className={`my-1 block whitespace-pre-wrap rounded-lg px-2.5 py-1.5 font-mono text-[12.5px] ${dark ? "bg-white/10" : "bg-black/[.05]"}`}>
          {tok.slice(3, -3).replace(/^\n/, "")}
        </code>,
      );
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} className={`rounded px-1 font-mono text-[0.92em] ${dark ? "bg-white/10" : "bg-black/[.05]"}`}>
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (/^https?:\/\//.test(tok)) {
      // Leave trailing punctuation outside the link
      const url = tok.replace(/[).,;:!?\]]+$/, "");
      out.push(
        <a key={key} href={url} target="_blank" rel="noreferrer" className={`underline underline-offset-2 ${dark ? "text-white" : "text-[var(--blue)]"}`} onClick={(e) => e.stopPropagation()}>
          {url}
        </a>,
      );
      if (url.length < tok.length) out.push(tok.slice(url.length));
    } else {
      const inner = format(tok.slice(1, -1), dark, depth + 1);
      if (tok[0] === "*") out.push(<strong key={key} className="font-semibold">{inner}</strong>);
      else if (tok[0] === "_") out.push(<em key={key}>{inner}</em>);
      else out.push(<s key={key}>{inner}</s>);
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function MessageText({ text, dark = false, className = "" }: { text: string; dark?: boolean; className?: string }) {
  return (
    <span dir="auto" className={`whitespace-pre-wrap ${className}`}>
      {/* A message with no text at all should render as nothing, not bring the page down. */}
      {format(String(text ?? ""), dark).map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </span>
  );
}

// One-line previews (inbox list, notifications): drop the formatting marks and squash line breaks
export function plainText(text: string | null | undefined) {
  return String(text ?? "")
    .replace(/```([\s\S]+?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?![\w*])/g, "$1")
    .replace(/(?<![\w_])_(?!\s)([^_\n]+?)_(?![\w_])/g, "$1")
    .replace(/(?<![\w~])~(?!\s)([^~\n]+?)~(?![\w~])/g, "$1")
    .replace(/\s*\n+\s*/g, " · ")
    .trim();
}
