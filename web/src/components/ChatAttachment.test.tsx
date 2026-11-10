import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatAttachment } from "./ChatAttachment";
import { ImageLightboxProvider } from "./ImageLightbox";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";

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
function mount(
  filename: string,
  mime: string,
  content: string,
  props: Partial<ComponentProps<typeof ChatAttachment>> = {},
) {
  mocks.fetch.mockImplementation(async (url: string) =>
    url.endsWith("/content") || url.includes("/attachments/references/")
      ? new Response(content, { headers: { "Content-Type": mime } })
      : new Response(JSON.stringify({ metadata: { bytes: content.length, content_type: mime } })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <ImageLightboxProvider>
          <ChatAttachment
            sessionId="original-chat"
            attachment={{ file_id: "file-id", filename }}
            {...props}
          />
        </ImageLightboxProvider>
      </TooltipProvider>
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
it("keeps local references filename-only and fetches their captured message only on activation", async () => {
  const reference = "/original/workspace/docs/My notes.md";
  mount("My notes.md", "text/markdown", "# Original workspace", {
    attachment: undefined,
    compact: true,
    reference,
    itemId: "source/item",
  });
  const chip = screen.getByRole("button", { name: "My notes.md" });
  expect(chip).toHaveClass("inline-flex", "align-baseline", "items-baseline");
  expect(chip).not.toHaveAttribute("title");
  expect(chip.querySelectorAll("svg")).toHaveLength(1);
  expect(chip.querySelector("svg")).toHaveAttribute("data-file-type", "document");
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.focus(chip);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(reference);
  fireEvent.click(chip);
  expect(await screen.findByRole("article")).toHaveTextContent("Original workspace");
  expect(mocks.fetch).toHaveBeenCalledWith(
    `/v1/sessions/original-chat/attachments/references/source%2Fitem?${new URLSearchParams({ path: reference })}`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent("Download original");
});

it("shows a compact metadata row with working overflow preview and original download", async () => {
  mount("report.pdf", "application/pdf", "original-pdf");
  expect(await screen.findByText("· 12 B")).toBeInTheDocument();
  expect(screen.getByText("application/pdf")).toBeInTheDocument();
  expect(
    screen.getByTestId("chat-attachment").querySelector("svg[data-file-type]"),
  ).toHaveAttribute("data-file-type", "pdf");
  expect(mocks.fetch.mock.calls.every(([url]) => !url.endsWith("/content"))).toBe(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "More actions for report.pdf" }));
  await user.click(screen.getByRole("menuitem", { name: "Preview" }));
  expect(await screen.findByText("PDF document preview")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download report.pdf" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), "report.pdf"));
});

it("keeps path and size beside one set of footer controls for a long reference", async () => {
  const reference = `/original/workspace/${"nested-directory/".repeat(12)}report.txt`;
  const content = "Original reference bytes";
  mount("report.txt", "text/plain", content, {
    attachment: undefined,
    reference,
    itemId: "source/item",
  });
  expect(screen.getByText(`${reference} · TXT`)).toBeInTheDocument();
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "report.txt" }));
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent(content));
  const card = screen.getByTestId("chat-attachment");
  expect(card).toHaveTextContent(`${reference} · text/plain · ${content.length} B`);
  await userEvent.setup().keyboard("{Escape}");
  fireEvent.click(within(card).getByRole("button", { name: "Download report.txt" }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  expect(await mocks.download.mock.calls[0][0].text()).toBe(content);
  expect(mocks.fetch).toHaveBeenCalledWith(
    `/v1/sessions/original-chat/attachments/references/source%2Fitem?${new URLSearchParams({ path: reference })}`,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it.each([
  ["notes.txt", "text/plain", "Original plain text"],
  ["app.ts", "text/typescript", "const original = 42;"],
  ["config.json", "application/json", '{"original":42}'],
  ["config.yaml", "application/yaml", "original: 42"],
  ["data.csv", "text/csv", "original,value\nfirst,42"],
])("preserves bounded text previews and exact downloads for %s", async (name, mime, text) => {
  mount(name, mime, text);
  fireEvent.click(screen.getByRole("button", { name }));
  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent?.replace(/\s/g, "")).toContain(
      text.replace(/\s/g, ""),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: `Download ${name}` }));
  await waitFor(() => expect(mocks.download).toHaveBeenCalledOnce());
  expect(await mocks.download.mock.calls[0][0].text()).toBe(text);
});

it("retains rendered Markdown and its source toggle", async () => {
  mount("guide.md", "text/markdown", "# Original guide");
  fireEvent.click(screen.getByRole("button", { name: "guide.md" }));
  expect(await screen.findByRole("article")).toHaveTextContent("# Original guide");
  fireEvent.click(screen.getByRole("button", { name: "Source" }));
  expect(screen.queryByRole("article")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByRole("article")).toHaveTextContent("# Original guide");
});
it("renders SVG only in an image element rather than inserting active markup", async () => {
  mount("unsafe.svg", "image/svg+xml", "<svg><script>window.pwned=true</script></svg>");
  await screen.findByRole("img", { name: "unsafe.svg" });
  expect(document.querySelector("script")).toBeNull();
});

it("closes an attachment lightbox with one Escape and retains its download name", async () => {
  mount("chart ü.png", "image/png", "original-bytes");
  await screen.findByRole("img", { name: "chart ü.png" });
  const download = screen.getByRole("button", { name: "Download chart ü.png" });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Zoom image: chart ü.png" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(download).toHaveAttribute("aria-label", "Download chart ü.png");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Download chart ü.png" })).toBeVisible();
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
  fireEvent.click(screen.getByRole("button", { name: "Download archive.zip" }));
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
      <TooltipProvider delayDuration={0}>
        <ChatAttachment
          sessionId="other-chat"
          attachment={{ file_id: "other", filename: "new.png" }}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("img")).toBeNull();
  await act(async () => finish(new Response("new", { headers: { "Content-Type": "image/png" } })));
  await screen.findByRole("img", { name: "new.png" });
});

it.each([
  { filename: { name: "report.pdf" } },
  { file_id: 42 },
  { filename: 7, file_id: ["file_1"], image_url: { url: "bad" } },
])("keeps malformed imported attachment fields from breaking the message: %j", (attachment) => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <ChatAttachment sessionId="original-chat" attachment={attachment as never} />
      <p>Other message text stays readable.</p>
    </QueryClientProvider>,
  );
  expect(screen.getByRole("button", { name: "Attachment" })).toBeInTheDocument();
  expect(screen.getByText("Other message text stays readable.")).toBeInTheDocument();
  expect(mocks.fetch).not.toHaveBeenCalled();
});
