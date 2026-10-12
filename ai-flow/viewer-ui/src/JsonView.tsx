import { useState } from "react";
import { SURFACE } from "./palette";

/**
 * A small, dependency-free, collapsible JSON viewer. Used for the Ticket tab,
 * whose body/comments are cached verbatim from the softzilla MCP as raw JSON —
 * far more legible as a foldable tree than as a wall of unformatted text.
 */

const COLORS = {
  key: "#881391",
  string: "#0a7d28",
  number: "#1a5fb4",
  boolean: "#b4361a",
  null: "#777777",
  bracket: "#555555",
  muted: "#999999",
};

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span style={{ color: COLORS.null }}>null</span>;
  if (typeof value === "string") return <span style={{ color: COLORS.string }}>"{value}"</span>;
  if (typeof value === "number") return <span style={{ color: COLORS.number }}>{value}</span>;
  if (typeof value === "boolean") return <span style={{ color: COLORS.boolean }}>{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function JsonNode({
  name,
  value,
  isLast,
  depth,
}: {
  name: string | null;
  value: unknown;
  isLast: boolean;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object" && !isArray;

  if (!isObject && !isArray) {
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        {name !== null && <span style={{ color: COLORS.key }}>"{name}": </span>}
        <Primitive value={value} />
        {!isLast && <span style={{ color: COLORS.muted }}>,</span>}
      </div>
    );
  }

  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const openBracket = isArray ? "[" : "{";
  const closeBracket = isArray ? "]" : "}";

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            setOpen((prev) => !prev);
          }
        }}
        style={{ cursor: "pointer", userSelect: "none", borderRadius: 4, outlineOffset: 2 }}
      >
        {name !== null && <span style={{ color: COLORS.key }}>"{name}": </span>}
        {open ? (
          <span style={{ color: COLORS.bracket }}>{openBracket}</span>
        ) : (
          <span style={{ color: COLORS.bracket }}>
            {openBracket}
            <span style={{ color: COLORS.muted }}>…</span>
            {closeBracket}{" "}
            <span style={{ color: COLORS.muted, fontStyle: "italic" }}>({entries.length})</span>
          </span>
        )}
      </div>
      {open && (
        <>
          {entries.map(([key, val], index) => (
            <JsonNode
              key={key}
              name={isArray ? null : key}
              value={val}
              isLast={index === entries.length - 1}
              depth={depth + 1}
            />
          ))}
          <div style={{ paddingLeft: depth * 14 }}>
            <span style={{ color: COLORS.bracket }}>{closeBracket}</span>
            {!isLast && <span style={{ color: COLORS.muted }}>,</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function JsonView({ data }: { data: unknown }) {
  return (
    <div
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        backgroundColor: SURFACE,
        padding: 12,
        borderRadius: 8,
        overflow: "auto",
      }}
    >
      <JsonNode name={null} value={data} isLast depth={0} />
    </div>
  );
}
