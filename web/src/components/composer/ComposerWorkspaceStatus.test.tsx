import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComposerWorkspaceStatus } from "./ComposerWorkspaceStatus";

afterEach(cleanup);

const base = {
  workspacePath: "/home/alice/repo",
  worktreePath: "/home/alice/repo",
  isWorktree: false,
  branch: "feature/login",
  branchState: "branch" as const,
  creationBranch: null,
  showWorktree: true,
};

describe("ComposerWorkspaceStatus", () => {
  it("renders the working directory and selected worktree as read-only composer text", () => {
    render(<ComposerWorkspaceStatus {...base} />);
    const directory = screen.getByTestId("composer-workspace-dir");
    const worktree = screen.getByTestId("composer-git-branch");
    expect(directory).toHaveTextContent("repo");
    expect(worktree).toHaveTextContent("feature/login");
    expect(directory).toHaveAccessibleName("Working directory: /home/alice/repo");
    expect(worktree).toHaveAccessibleName("Worktree: feature/login");
    expect(directory.tagName).toBe("SPAN");
    expect(worktree.tagName).toBe("SPAN");
    expect(directory).toHaveClass("text-ui", "font-normal", "text-foreground");
    expect(worktree).toHaveClass("text-ui", "font-normal", "text-foreground");
    expect(directory).not.toHaveAttribute("title");
    expect(worktree).not.toHaveAttribute("title");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("completely hides worktree information for folders not confirmed as GitHub repositories", () => {
    render(<ComposerWorkspaceStatus {...base} showWorktree={false} />);
    expect(screen.getByTestId("composer-workspace-dir")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-git-branch")).toBeNull();
  });

  it("models detached, non-git, unavailable, and loading states honestly", () => {
    const { rerender } = render(
      <ComposerWorkspaceStatus {...base} branch={null} branchState="detached" />,
    );
    expect(screen.getByTestId("composer-git-branch")).toHaveTextContent("Detached HEAD");
    rerender(<ComposerWorkspaceStatus {...base} branch={null} branchState="not-git" />);
    expect(screen.getByTestId("composer-git-branch")).toHaveTextContent("Not a Git repository");
    rerender(<ComposerWorkspaceStatus {...base} branch={null} branchState="unknown" />);
    expect(screen.getByTestId("composer-git-branch")).toHaveTextContent("Branch unavailable");
    rerender(<ComposerWorkspaceStatus {...base} branch={null} branchState="loading" />);
    expect(screen.getByTestId("composer-git-branch")).toHaveTextContent("Checking branch…");
  });

  it("keeps creation-time branch history in the canonical tooltip, never the live label", async () => {
    render(
      <ComposerWorkspaceStatus
        {...base}
        branch={null}
        branchState="unknown"
        creationBranch="feature/created"
      />,
    );
    const worktree = screen.getByTestId("composer-git-branch");
    expect(worktree).toHaveTextContent("Branch unavailable");
    expect(worktree).not.toHaveAttribute("title");
    fireEvent.focus(worktree);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Branch unavailable. Created on branch feature/created.",
    );
  });

  it("omits a tooltip that only repeats the branch label", () => {
    render(<ComposerWorkspaceStatus {...base} />);
    fireEvent.focus(screen.getByTestId("composer-git-branch"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
