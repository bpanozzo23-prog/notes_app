import { Fragment } from "react";

// Only paragraphs, line breaks, and '- ' lists. All answer strings stay React text.
export default function ClaudeAnswer({ display }) {
  const lines = [{ parts: [], text: "" }];
  const stretches = display.citations?.length ? display.citations : [{ text: display.text, numbers: [] }];
  for (const stretch of stretches) {
    const pieces = stretch.text.split("\n");
    pieces.forEach((text, i) => {
      if (i) lines.push({ parts: [], text: "" });
      lines.at(-1).parts.push(text); lines.at(-1).text += text;
    });
    if (stretch.numbers.length) lines.at(-1).parts.push(<sup key={`cite-${lines.length}-${lines.at(-1).parts.length}`} className="ml-0.5 text-[var(--color-accent)]" aria-label={`Sources ${stretch.numbers.join(", ")}`}>{stretch.numbers.join(", ")}</sup>);
  }
  const groups = [];
  for (const line of lines) {
    if (!line.text.trim() && line.parts.every((part) => typeof part === "string")) { groups.push({ kind: "space", lines: [] }); continue; }
    const kind = line.text.startsWith("- ") ? "list" : "paragraph";
    if (kind === "list") {
      let remove = 2;
      line.parts = line.parts.map((part) => {
        if (typeof part !== "string" || !remove) return part;
        const result = part.slice(remove); remove = Math.max(0, remove - part.length); return result;
      });
    }
    if (groups.at(-1)?.kind === kind) groups.at(-1).lines.push(line);
    else groups.push({ kind, lines: [line] });
  }
  return <div className="space-y-3 break-words leading-relaxed">{groups.map((group, i) => group.kind === "space" ? null : group.kind === "list"
    ? <ul key={i} className="list-disc space-y-1 pl-5">{group.lines.map((line, j) => <li key={j}>{line.parts}</li>)}</ul>
    : <p key={i}>{group.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}{line.parts}</Fragment>)}</p>)}</div>;
}
