import { decodeHtmlEntities } from "@tiptap/core";

interface PreviewNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: PreviewNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Map decoded Markdown text offsets back to exact source character ranges. */
function textOffsets(raw: string, text: string, start: number) {
  const starts: number[] = [],
    ends: number[] = [];
  let decoded = "";
  for (let i = 0; i < raw.length; i++) {
    let value = raw[i],
      end = i + 1;
    const entity = raw.slice(i).match(/^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i);
    if (entity) {
      value = decodeHtmlEntities(entity[0]);
      end = i + entity[0].length;
    } else if (raw[i] === "\\" && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(raw[i + 1] ?? "")) {
      value = raw[i + 1];
      end = i + 2;
    }
    decoded += value;
    for (let j = 0; j < value.length; j++) {
      starts.push(start + i);
      ends.push(start + end);
    }
    i = end - 1;
  }
  return decoded === text ? { starts, ends } : null;
}

/** Runs after sanitization; authored HTML cannot forge these source markers. */
export function previewSourceMarkers(source: string, normalizedOffsets: number[]) {
  return () => (tree: PreviewNode) => {
    function visit(parent: PreviewNode) {
      parent.children = (parent.children ?? []).flatMap((node): PreviewNode[] => {
        if (node.type === "element") {
          if (node.tagName === "a" && node.children?.length === 1) {
            const child = node.children[0];
            if (
              child.type === "text" &&
              child.position?.start.offset !== undefined &&
              child.position.end.offset !== undefined
            ) {
              const from = normalizedOffsets[child.position.start.offset];
              const end = normalizedOffsets[child.position.end.offset - 1] + 1;
              if (from !== undefined && end !== undefined)
                node.properties = {
                  ...node.properties,
                  "data-source-start": from,
                  "data-source-end": end,
                };
              return [node];
            }
          }
          // Preserve code, MathML and SVG structure; raw text nodes elsewhere retain source positions.
          if (!["code", "pre", "svg", "math"].includes(node.tagName ?? "")) visit(node);
          return [node];
        }
        if (
          node.type !== "text" ||
          typeof node.value !== "string" ||
          (!node.position?.start.offset && node.position?.start.offset !== 0)
        )
          return [node];
        const from = normalizedOffsets[node.position.start.offset];
        const last = node.position.end.offset;
        const end = last === undefined ? undefined : normalizedOffsets[last - 1] + 1;
        if (from === undefined || end === undefined) return [node];
        const offsets = textOffsets(source.slice(from, end), node.value, from);
        if (!offsets) return [node];
        return [
          {
            type: "element",
            tagName: "span",
            properties: { "data-source-start": from, "data-source-end": end },
            children: [node],
          },
        ];
      });
    }
    visit(tree);
  };
}

export function renderedMarkdownSelection(container: HTMLElement, source: string) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer))
    return null;
  function boundary(node: Node, offset: number, end: boolean) {
    const element = node instanceof Element ? node : node.parentElement;
    let marked = element?.closest<HTMLElement>("[data-source-start]");
    if (!marked && node instanceof Element) {
      const child = node.childNodes[end ? Math.max(0, offset - 1) : offset];
      const childElement = child instanceof Element ? child : child?.parentElement;
      const candidates = childElement?.matches("[data-source-start]")
        ? [childElement]
        : Array.from(childElement?.querySelectorAll<HTMLElement>("[data-source-start]") ?? []);
      marked = (end ? candidates.at(-1) : candidates[0]) as HTMLElement | undefined;
    }
    if (!marked || !container.contains(marked)) return null;
    const prefix = document.createRange();
    prefix.setStart(marked, 0);
    prefix.setEnd(node, offset);
    const index = prefix.toString().length;
    const start = Number(marked.dataset.sourceStart);
    const finish = Number(marked.dataset.sourceEnd);
    const map = textOffsets(source.slice(start, finish), marked.textContent ?? "", start);
    if (!map) return null;
    return end ? map.ends[index - 1] : map.starts[index];
  }
  const start = boundary(range.startContainer, range.startOffset, false);
  const end = boundary(range.endContainer, range.endOffset, true);
  if (start == null || end == null || end <= start) return null;
  return {
    start_index: start,
    end_index: end,
    anchor_content: source.slice(start, end),
    text: selection.toString(),
    rect: range.getBoundingClientRect(),
  };
}
