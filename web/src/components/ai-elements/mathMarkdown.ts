// Optional 1–3 space indent + a fence run, per CommonMark. Matching the full
// run (not just the first three chars) also keeps a ````-fenced block from
// leaking its fourth backtick into inline-code tracking.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * LLMs often emit TeX delimiters (`\(...\)` and `\[...\]`), while remark-math
 * parses dollar delimiters. Convert both to `$$`, the only math delimiter the
 * renderer honours (single-dollar math is off, so prose dollars stay prose —
 * see `STREAMDOWN_PLUGINS`), but only where doing so is safe:
 *
 * - Not inside fenced or inline code, so code examples stay verbatim.
 * - Not inside an already `$$`-delimited math span, so a LaTeX line break
 *   (`\\[1em]`) inside `$$\begin{aligned}…\end{aligned}$$` isn't mistaken for a
 *   display-math opener and turned into `\$$1em]`.
 * - A literal `\\` or `\$` is copied verbatim so its trailing `\[`/`\(` isn't
 *   read as an explicit delimiter and an escaped dollar isn't re-toggled.
 *
 * `$$…$$` inside a paragraph stays inline math, so a converted `\(x\)` reads as
 * inline math and only a `$$` opening its own line renders as a display block.
 */
export function normalizeExplicitMathDelimiters(text: string, sourceOffsets?: number[]): string {
  const tableLines = new Set<number>();
  let offset = 0;
  const lines = text.split("\n");
  let inTable = false;
  for (let line = 0; line < lines.length; line += 1) {
    if (/^\s*\|?\s*:?-{3,}:?\s*\|/.test(lines[line])) {
      inTable = true;
      if (line > 0) tableLines.add(offset - lines[line - 1].length - 1);
    } else if (!lines[line].includes("|")) inTable = false;
    if (inTable) tableLines.add(offset);
    offset += lines[line].length + 1;
  }
  let tableLine = false;
  let explicitMath = false;
  let result = "";
  function emit(value: string, from: number, consumed = value.length) {
    result += value;
    if (sourceOffsets)
      for (let offset = 0; offset < value.length; offset++)
        sourceOffsets.push(from + Math.min(offset, consumed - 1));
  }
  // The marker (`` ``` `` / `~~~` run) that opened the current fenced block, or
  // "" when outside a fence. CommonMark closes a fence only with the same char
  // and a run at least as long, so a stray `~~~` inside a ``` block stays code.
  let openFence = "";
  // Length of the backtick run that opened the current inline-code span, or 0
  // when not in inline code. Tracking the run length lets a ``…`` span close
  // only on a matching-length run, so single backticks inside it don't leak.
  let inlineCodeTicks = 0;
  // Inside a pre-existing `$$…$$` span (toggled on each run of 2+ `$`).
  let inMath = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const atLineStart = i === 0 || text[i - 1] === "\n";
    if (atLineStart) tableLine = tableLines.has(i);

    if (!inlineCodeTicks && atLineStart) {
      const fence = text.slice(i).match(FENCE_RE);
      if (fence) {
        const marker = fence[1];
        if (!openFence) {
          openFence = marker;
        } else if (marker[0] === openFence[0] && marker.length >= openFence.length) {
          openFence = "";
        }
        emit(fence[0], i);
        i += fence[0].length - 1;
        continue;
      }
    }
    if (openFence) {
      emit(char, i);
      continue;
    }

    if (char === "`") {
      let run = 1;
      while (text[i + run] === "`") run += 1;
      if (inlineCodeTicks === 0) {
        inlineCodeTicks = run;
      } else if (run === inlineCodeTicks) {
        inlineCodeTicks = 0;
      }
      emit(text.slice(i, i + run), i);
      i += run - 1;
      continue;
    }
    if (inlineCodeTicks) {
      emit(char, i);
      continue;
    }

    if (char === "\\" && (text[i + 1] === "\\" || text[i + 1] === "$")) {
      emit(text.slice(i, i + 2), i);
      i += 1;
      continue;
    }

    if (char === "$") {
      let run = 1;
      while (text[i + run] === "$") run += 1;
      // A lone `$` never delimits math, so it stays literal prose and leaves the
      // span state alone: "$5 … $10" must not swallow the text in between, and a
      // `\(x\)` after it still converts.
      if (run > 1) inMath = !inMath;
      emit(text.slice(i, i + run), i);
      i += run - 1;
      continue;
    }

    if (!inMath) {
      const pair = text.slice(i, i + 2);
      if (pair === "\\(" || pair === "\\)" || pair === "\\[" || pair === "\\]") {
        explicitMath = pair === "\\(" || pair === "\\[";
        emit("$$", i, 2);
        i += 1;
        continue;
      }
    }

    // GFM splits cells before inline math runs. TeX's equivalent delimiter
    // avoids treating an absolute-value bar as a new table column.
    if (char === "|" && tableLine && (inMath || explicitMath) && text[i - 1] !== "\\") {
      emit("\\vert ", i, 1);
    } else emit(char, i);
  }

  return result;
}
