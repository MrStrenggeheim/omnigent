import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/lib/identity";
import { ContentSearchPanel } from "./ContentSearchPanel";

vi.mock("@/lib/identity", () => ({
  authenticatedFetch: vi.fn(),
  getCurrentUserId: () => "actor@example.test",
}));
vi.mock("@/hooks/usePermissions", () => ({ useCanEdit: () => true }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("supports explicit searches, filters and preserved results", async () => {
  vi.mocked(authenticatedFetch).mockImplementation(
    async () => new Response(JSON.stringify({ matches: [], truncated: false, warning: null })),
  );
  const client = new QueryClient();
  const view = (request: number) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <ContentSearchPanel key={request} conversationId="session-one" onFileSelect={vi.fn()} />
      </QueryClientProvider>
    </StrictMode>
  );
  const { rerender } = render(view(1));
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  needle  " } });
  const filters = screen.getByRole("button", { name: "Filter files" });
  expect(screen.getByRole("searchbox").nextElementSibling).toBe(filters);
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("Include")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  expect(filters).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByLabelText("Include")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Include"), { target: { value: "src/**" } });
  fireEvent.change(screen.getByLabelText("Exclude"), { target: { value: "*.test.ts" } });
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  expect(filters).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("Include")).not.toBeVisible();
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("  needle  ");
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  fireEvent.change(screen.getByLabelText("Include"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Exclude"), { target: { value: "" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(2));
  const cleared = new URL(String(vi.mocked(authenticatedFetch).mock.calls[1][0]), "http://test");
  expect(cleared.searchParams.get("include")).toBe("");
  expect(cleared.searchParams.get("exclude")).toBe("");
  expect(await screen.findByText(/No matches for/)).toBeInTheDocument();
  rerender(view(2));
  expect(screen.getByRole("searchbox")).toHaveValue("  needle  ");
  expect(screen.getByText(/No matches for/)).toBeInTheDocument();
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
});

it("submits content and options explicitly, highlights results and opens the exact position", async () => {
  const onFileSelect = vi.fn();
  let resolve!: (response: Response) => void;
  vi.mocked(authenticatedFetch).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const client = new QueryClient();
  const view = (conversationId: string) => (
    <QueryClientProvider client={client}>
      <ContentSearchPanel
        key={conversationId}
        conversationId={conversationId}
        onFileSelect={onFileSelect}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view("session-one"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  Needle.*  " } });
  fireEvent.click(screen.getByLabelText("Match case"));
  fireEvent.click(screen.getByLabelText("Regular expression"));
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  fireEvent.change(screen.getByLabelText("Include"), { target: { value: "src/**, *.{py,txt}" } });
  fireEvent.change(screen.getByLabelText("Exclude"), {
    target: { value: "**/tests/**, a & b/**" },
  });
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
  expect(url.pathname).toBe(
    "/v1/sessions/session-one/resources/environments/default/content-search",
  );
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: "  Needle.*  ",
    case_sensitive: "true",
    regex: "true",
    whole_word: "false",
    use_ignore: "true",
    path: "",
    include: "src/**, *.{py,txt}",
    exclude: "**/tests/**, a & b/**",
  });
  expect(screen.getByText("Searching…")).toBeInTheDocument();
  resolve(
    new Response(
      JSON.stringify({
        matches: [
          {
            path: "src/main.py",
            line: 351,
            column: 4,
            text: "😀 Needle",
            match_start: 3,
            match_end: 9,
          },
        ],
        truncated: true,
        warning: null,
      }),
    ),
  );
  const result = await screen.findByRole("button", { name: "Open src/main.py at line 351" });
  expect(screen.getByText("Needle").tagName).toBe("MARK");
  expect(screen.getByText(/first 1 matches/)).toBeInTheDocument();
  fireEvent.click(result);
  expect(onFileSelect).toHaveBeenCalledWith("src/main.py", { line: 351, column: 4 });

  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "unsent draft" } });
  rerender(view("session-two"));
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByLabelText("Match case")).not.toBeChecked();
  expect(screen.getByLabelText("Include")).toHaveValue("");
  expect(screen.getByLabelText("Exclude")).toHaveValue("");
  expect(screen.queryByRole("button", { name: /Open src\/main.py/ })).not.toBeInTheDocument();
  rerender(view("session-one"));
  expect(screen.getByRole("searchbox")).toHaveValue("unsent draft");
  expect(screen.getByLabelText("Match case")).toBeChecked();
  expect(screen.getByLabelText("Regular expression")).toBeChecked();
  expect(screen.getByLabelText("Include")).toHaveValue("src/**, *.{py,txt}");
  expect(screen.getByLabelText("Exclude")).toHaveValue("**/tests/**, a & b/**");
  expect(screen.getByRole("button", { name: "Filter files" })).toBeInTheDocument();
  expect(screen.getByText(/matches.*Needle/)).toBeInTheDocument();
  expect(screen.getByText(/first 1 matches/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open src/main.py at line 351" }));
  expect(onFileSelect).toHaveBeenLastCalledWith("src/main.py", { line: 351, column: 4 });
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
});

it("keeps an in-flight search across switches without mixing conversations", async () => {
  let resolveFirst!: (response: Response) => void;
  vi.mocked(authenticatedFetch)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ matches: [], truncated: false, warning: null })),
    );
  const client = new QueryClient();
  const view = (conversationId: string) => (
    <QueryClientProvider client={client}>
      <ContentSearchPanel
        key={conversationId}
        conversationId={conversationId}
        onFileSelect={vi.fn()}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view("session-one"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "first" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  rerender(view("session-two"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "second" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByText("No matches for “second”.")).toBeInTheDocument();
  rerender(view("session-one"));
  expect(screen.getByText("Searching…")).toBeInTheDocument();
  expect(screen.getByRole("searchbox")).toHaveValue("first");
  rerender(view("session-two"));
  resolveFirst(new Response(JSON.stringify({ matches: [], truncated: false, warning: null })));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByText("No matches for “second”.")).toBeInTheDocument();
  rerender(view("session-one"));
  expect(await screen.findByText("No matches for “first”.")).toBeInTheDocument();
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
});

it("hides a previous error while retrying and displays runner warnings", async () => {
  let resolveRetry!: (response: Response) => void;
  vi.mocked(authenticatedFetch)
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ matches: [], truncated: false, warning: null })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "regex parse error" })))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContentSearchPanel conversationId="session-one" onFileSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByText("No matches for “needle”.")).toBeInTheDocument();
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("regex parse error");
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByText("Searching…")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const warning = "Some files or ignore rules could not be read.";
  resolveRetry(new Response(JSON.stringify({ matches: [], truncated: true, warning })));
  expect(await screen.findByText("No matches for “needle”.")).toBeInTheDocument();
  expect(screen.getByText(warning)).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([
  [502, "<html>Bad gateway</html>"],
  [200, ""],
  [200, "{}"],
  [200, "null"],
])("handles an invalid search response (%s, %s)", async (status, body) => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(body, { status }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContentSearchPanel conversationId="session-one" onFileSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Content search is unavailable.");
});

it("searches after typing, exposes whole-word and ignore controls, and cancels an active search", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(authenticatedFetch).mockImplementation((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContentSearchPanel conversationId="debounced" scope="src" onFileSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByLabelText("Whole word"));
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  fireEvent.click(screen.getByLabelText("Use ignore files"));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(1));
  const url = new URL(String(vi.mocked(authenticatedFetch).mock.calls[0][0]), "http://test");
  expect(url.searchParams.get("path")).toBe("src");
  expect(url.searchParams.get("whole_word")).toBe("true");
  expect(url.searchParams.get("use_ignore")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Cancel search" }));
  expect(signal?.aborted).toBe(true);
  await waitFor(() => expect(screen.queryByText("Searching…")).not.toBeInTheDocument());
});

it("pins a search folder while browsing changes and opens replace from its shortcut request", async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(
    new Response(JSON.stringify({ matches: [], truncated: false, warning: null })),
  );
  const client = new QueryClient();
  const view = (scope: string, replaceFocusNonce = 0) => (
    <QueryClientProvider client={client}>
      <ContentSearchPanel
        conversationId="scope"
        scope={scope}
        replaceFocusNonce={replaceFocusNonce}
        replaceOpen={replaceFocusNonce > 0}
        onFileSelect={vi.fn()}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view("src"));
  fireEvent.click(screen.getByRole("button", { name: "Filter files" }));
  fireEvent.click(screen.getByLabelText("Pin search folder"));
  rerender(view("tests", 1));
  expect(screen.getByLabelText("Search folder")).toHaveValue("src");
  expect(await screen.findByLabelText("Replace with")).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText("Replace with")).toHaveFocus());
  fireEvent.click(screen.getByLabelText("Pin search folder"));
  expect(screen.getByLabelText("Search folder")).toHaveValue("tests");
});

it("previews selected replacements, applies searched snapshots and can undo them", async () => {
  const match = {
    id: "main:0:6",
    path: "src/main.py",
    relative_path: "main.py",
    line: 1,
    column: 1,
    text: "needle",
    match_start: 0,
    match_end: 6,
    start_byte: 0,
    end_byte: 6,
    sha256: "snapshot-hash",
  };
  const posts: Record<string, unknown>[] = [];
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => {
    if (options?.method !== "POST")
      return new Response(JSON.stringify({ matches: [match], truncated: false, warning: null }));
    const body = JSON.parse(String(options.body));
    posts.push(body);
    if (body.action === "preview")
      return new Response(
        JSON.stringify({
          previews: [{ id: match.id, path: "main.py", line: 1, before: "needle", after: "thread" }],
          errors: [],
        }),
      );
    if (body.action === "apply")
      return new Response(
        JSON.stringify({ applied: ["main.py"], matches: 1, errors: [], undo_id: "undo-token" }),
      );
    return new Response(JSON.stringify({ restored: ["main.py"], errors: [], undo_id: null }));
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContentSearchPanel conversationId="replace" scope="src" replaceOpen onFileSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(
    await screen.findByRole("button", { name: "Open src/main.py at line 1" }),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "thread" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview replacements (1)" }));
  expect(await screen.findByText("Review replacements")).toBeInTheDocument();
  expect(posts[0]).toMatchObject({
    action: "preview",
    path: "src",
    query: "needle",
    replacement: "thread",
    matches: [match],
  });
  expect(posts).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Apply replacements" }));
  expect(await screen.findByText("Replaced 1 matches in 1 files.")).toBeInTheDocument();
  expect(posts[1]).toMatchObject({ action: "apply", matches: [match] });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Undo replacement" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo replacement" }));
  expect(await screen.findByText("Restored 1 files.")).toBeInTheDocument();
  expect(posts[2]).toMatchObject({ action: "undo", path: "src", undo_id: "undo-token" });
});

it("keeps replacement closed for ordinary search focus requests", () => {
  const client = new QueryClient();
  const view = (nonce: number, replaceOpen = false) => (
    <QueryClientProvider client={client}>
      <ContentSearchPanel
        conversationId="focus-search"
        replaceFocusNonce={nonce}
        replaceOpen={replaceOpen}
        onFileSelect={vi.fn()}
      />
    </QueryClientProvider>
  );
  const { rerender } = render(view(1));
  expect(screen.getByRole("button", { name: "Replace" })).toBeVisible();
  expect(screen.queryByLabelText("Replace with")).not.toBeInTheDocument();
  rerender(view(2, true));
  expect(screen.getByLabelText("Replace with")).toBeVisible();
  rerender(view(3));
  expect(screen.queryByLabelText("Replace with")).not.toBeInTheDocument();
});

it("reruns live search when returning to the draft restored at mount", async () => {
  const client = new QueryClient();
  client.setQueryData(["content-search-input", "restored-draft"], { query: "needle" });
  vi.mocked(authenticatedFetch).mockImplementation(
    async () => new Response(JSON.stringify({ matches: [], truncated: false, warning: null })),
  );
  render(
    <QueryClientProvider client={client}>
      <ContentSearchPanel conversationId="restored-draft" onFileSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  expect(await screen.findByText("No matches for “needle”.")).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "other" } });
  expect(await screen.findByText("No matches for “other”.")).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  await waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(3));
  expect(await screen.findByText("No matches for “needle”.")).toBeVisible();
});

it("retains undo when replacement completes after the search panel closes", async () => {
  const client = new QueryClient();
  const match = {
    id: "a:0:6",
    path: "a.txt",
    relative_path: "a.txt",
    line: 1,
    column: 1,
    text: "needle",
    match_start: 0,
    match_end: 6,
    start_byte: 0,
    end_byte: 6,
    sha256: "snapshot",
  };
  let finishApply!: (response: Response) => void;
  vi.mocked(authenticatedFetch).mockImplementation(async (_url, options) => {
    if (options?.method !== "POST")
      return new Response(JSON.stringify({ matches: [match], truncated: false, warning: null }));
    const body = JSON.parse(String(options.body));
    if (body.action === "preview")
      return new Response(
        JSON.stringify({
          previews: [{ id: match.id, path: "a.txt", line: 1, before: "needle", after: "thread" }],
          errors: [],
        }),
      );
    if (body.action === "apply")
      return new Promise<Response>((resolve) => {
        finishApply = resolve;
      });
    return new Response(JSON.stringify({ restored: ["a.txt"], errors: [], undo_id: null }));
  });
  const view = (open: boolean) => (
    <QueryClientProvider client={client}>
      {open && <ContentSearchPanel conversationId="recover" replaceOpen onFileSelect={vi.fn()} />}
    </QueryClientProvider>
  );
  const { rerender } = render(view(true));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  await screen.findByRole("button", { name: "Open a.txt at line 1" });
  fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "thread" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview replacements (1)" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apply replacements" }));
  await waitFor(() => expect(finishApply).toBeDefined());
  rerender(view(false));
  finishApply(
    new Response(
      JSON.stringify({ applied: ["a.txt"], matches: 1, errors: [], undo_id: "recoverable-token" }),
    ),
  );
  await waitFor(() =>
    expect(client.getQueryData(["content-search-undo", "recover", "actor@example.test"])).toEqual({
      id: "recoverable-token",
      path: "",
    }),
  );
  rerender(view(true));
  fireEvent.click(await screen.findByRole("button", { name: "Undo replacement" }));
  expect(await screen.findByText("Restored 1 files.")).toBeVisible();
});

it("disables replacement previews while displayed results belong to an older query", async () => {
  const match = {
    id: "a:0:6",
    path: "a.txt",
    relative_path: "a.txt",
    line: 1,
    column: 1,
    text: "needle",
    match_start: 0,
    match_end: 6,
    start_byte: 0,
    end_byte: 6,
    sha256: "snapshot",
  };
  vi.mocked(authenticatedFetch).mockImplementation(async (url) => {
    const query = new URL(String(url), "http://test").searchParams.get("q");
    return new Response(
      JSON.stringify({
        matches: query === "needle" ? [match] : [],
        truncated: false,
        warning: null,
      }),
    );
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContentSearchPanel conversationId="stale-query" replaceOpen onFileSelect={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "needle" } });
  fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
  await screen.findByRole("button", { name: "Open a.txt at line 1" });
  expect(screen.getByRole("button", { name: "Preview replacements (1)" })).toBeEnabled();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "other" } });
  const preview = screen.getByRole("button", { name: "Preview replacements (1)" });
  expect(preview).toBeDisabled();
  expect(screen.getByRole("button", { name: "Replace matches in a.txt" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Replace a.txt line 1 column 1" })).toBeDisabled();
  fireEvent.click(preview);
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("No matches for “other”.")).toBeVisible();
});
