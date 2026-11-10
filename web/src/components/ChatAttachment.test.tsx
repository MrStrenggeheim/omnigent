import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatAttachment } from "./ChatAttachment";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/identity", () => ({ authenticatedFetch: mocks.fetch }));
vi.mock("@/lib/explorerOperations", () => ({ downloadBlob: mocks.download }));
vi.mock("@/shell/PdfViewer", () => ({ PdfViewer: () => <p>PDF document preview</p> }));
vi.mock("@/shell/CodeViewer", () => ({
  MarkdownPreview: ({ content }: { content: string }) => <article>{content}</article>,
}));
beforeEach(() => {
  mocks.fetch.mockReset();
  mocks.download.mockReset();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:attachment"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(filename: string, mime: string, content: string) {
  mocks.fetch.mockImplementation(async (url: string) =>
    url.endsWith("/content")
      ? new Response(content, { headers: { "Content-Type": mime } })
      : new Response(JSON.stringify({ metadata: { bytes: content.length, content_type: mime } })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChatAttachment sessionId="original-chat" attachment={{ file_id: "file-id", filename }} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
it("loads images through authenticated storage URLs and downloads the original", async () => {
  mount("chart ü.png", "image/png", "original-bytes");
  await waitFor(() =>
    expect(screen.getByRole("img", { name: "chart ü.png" })).toHaveAttribute(
      "src",
      "blob:attachment",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Download chart ü.png" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "chart ü.png"));
  expect(mocks.fetch).toHaveBeenCalledWith(
    "/v1/sessions/original-chat/resources/files/file-id/content",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it("renders SVG only in an image element rather than inserting active markup", async () => {
  mount("unsafe.svg", "image/svg+xml", "<svg><script>window.pwned=true</script></svg>");
  await screen.findByRole("img", { name: "unsafe.svg" });
  expect(document.querySelector("script")).toBeNull();
});
it("isolates HTML with a sandbox and restrictive content policy, while retaining source", async () => {
  mount("page.html", "text/html", "<h1>hello</h1><script>parent.pwned=true</script>");
  fireEvent.click(screen.getByRole("button", { name: "page.html" }));
  const frame = await screen.findByTitle("page.html");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.getByText("parent.pwned", { exact: false })).toBeInTheDocument();
});
it.each([
  ["sound.mp3", "audio/mpeg", "audio"],
  ["movie.mp4", "video/mp4", "video"],
])("plays browser media %s", async (name, mime, tag) => {
  mount(name, mime, "media");
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() => expect(document.querySelector(tag)).toHaveAttribute("controls"));
});
it("keeps unsupported binary files downloadable with a clear fallback", async () => {
  mount("archive.zip", "application/zip", "PK-original");
  fireEvent.click(screen.getByRole("button", { name: "archive.zip" }));
  expect(await screen.findByText(/Preview is unavailable for this format/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download original" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
});
it("reports a missing file without changing the target and retries explicitly", async () => {
  const { client } = mount("gone.png", "image/png", "old");
  await screen.findByRole("img", { name: "gone.png" });
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ detail: "File not found" }), { status: 404 }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["chat-attachment-bytes"] });
  });
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("File not found");
});
it("pins late image responses to the original file identity during chat reuse", async () => {
  const { rerender, client } = mount("old.png", "image/png", "old");
  await screen.findByRole("img");
  let finish!: (response: Response) => void;
  mocks.fetch.mockImplementation(async (url: string) =>
    url.endsWith("/content")
      ? new Promise<Response>((resolve) => {
          finish = resolve;
        })
      : new Response(JSON.stringify({ metadata: { bytes: 3 } })),
  );
  rerender(
    <QueryClientProvider client={client}>
      <ChatAttachment
        sessionId="other-chat"
        attachment={{ file_id: "other", filename: "new.png" }}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("img")).toBeNull();
  await act(async () => finish(new Response("new", { headers: { "Content-Type": "image/png" } })));
  await screen.findByRole("img", { name: "new.png" });
});
