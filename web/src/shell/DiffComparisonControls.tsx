import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DiffComparison {
  source: "git" | "commit" | "range" | "agent" | "last-turn";
  base: string;
  target: string;
}

export const DEFAULT_DIFF_COMPARISON: DiffComparison = {
  source: "git",
  base: "HEAD",
  target: "WORKTREE",
};

export function DiffComparisonControls({
  value,
  onChange,
}: {
  value: DiffComparison;
  onChange: (value: DiffComparison) => void;
}) {
  const [base, setBase] = useState("HEAD~1");
  const [target, setTarget] = useState("HEAD");
  const revisions = value.source === "commit" || value.source === "range";
  const apply = (source = value.source) =>
    onChange({
      source,
      base: source === "commit" ? `${target.trim()}^` : base.trim(),
      target: target.trim(),
    });
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-ui">
      <Select
        value={value.source}
        onValueChange={(source: DiffComparison["source"]) => {
          if (source === "git") onChange(DEFAULT_DIFF_COMPARISON);
          else if (source === "commit" || source === "range") apply(source);
          else onChange({ ...value, source });
        }}
      >
        <SelectTrigger aria-label="Diff comparison" className="h-7 w-auto min-w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="git">Git working tree</SelectItem>
          <SelectItem value="last-turn">Last agent turn</SelectItem>
          <SelectItem value="agent">Agent changes · session</SelectItem>
          <SelectItem value="commit">Commit</SelectItem>
          <SelectItem value="range">Commit range</SelectItem>
        </SelectContent>
      </Select>
      {revisions ? (
        <form
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          {value.source === "range" && (
            <Input
              aria-label="Base revision"
              value={base}
              onChange={(event) => setBase(event.target.value)}
              className="h-7 min-w-20 flex-1 font-mono text-xs"
            />
          )}
          <Input
            aria-label={value.source === "commit" ? "Commit revision" : "Target revision"}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="h-7 min-w-20 flex-1 font-mono text-xs"
          />
          <Button
            type="submit"
            size="xs"
            variant="outline"
            disabled={!target.trim() || (value.source === "range" && !base.trim())}
          >
            Compare
          </Button>
        </form>
      ) : (
        <span className="text-xs text-muted-foreground">
          {value.source === "git" ? "HEAD → working tree" : "Observed agent file edits"}
        </span>
      )}
    </div>
  );
}
