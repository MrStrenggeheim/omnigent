import type { ChatAttachmentContent } from "@/lib/chatAttachments";
import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { DownloadIcon, FileIcon, Loader2Icon } from "lucide-react";
import { authenticatedFetch } from "@/lib/identity";
import { apiErrorFromResponse } from "@/lib/sessionsApi";
import { downloadBlob } from "@/lib/explorerOperations";
import { toast } from "@/lib/notifications";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ZoomableImage } from "./ImageLightbox";
import { CodeBlock } from "./ai-elements/code-block";
import { detectLang } from "@/shell/codeViewerHelpers";
import { formatBytes } from "@/shell/fileStatusUtils";
import type { FileContentResponse } from "@/hooks/useFileContent";

const PdfViewer = lazy(() => import("@/shell/PdfViewer").then((m) => ({ default: m.PdfViewer })));
const MarkdownPreview = lazy(() =>
  import("@/shell/CodeViewer").then((m) => ({ default: m.MarkdownPreview })),
);
export const ChatAttachmentContext = createContext<{
  sessionId: string | null;
  itemId: string | null;
}>({ sessionId: null, itemId: null });
export type AttachmentContent = ChatAttachmentContent;

const MAX_BYTES = 50 * 1024 * 1024;
const TEXT_BYTES = 512 * 1024;

function useObjectUrl(blob: Blob | undefined) {
  const [value, setValue] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setValue({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return value?.blob === blob ? value?.url : undefined;
}

/** One authenticated file surface for uploads, agent artifacts and captured Markdown references. */
export function ChatAttachment({
  sessionId,
  attachment,
  reference,
  itemId,
  label,
  compact = false,
}: {
  sessionId: string | null;
  attachment?: AttachmentContent;
  reference?: string;
  itemId?: string | null;
  label?: ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState<string>();
  const filenameHint = attachment?.filename ?? reference?.split(/[\\/]/).at(-1) ?? "Attachment";
  const storedReference = reference?.match(
    /^\/v1\/sessions\/([^/]+)\/resources\/files\/([^/]+)\/content$/,
  );
  const fileId =
    attachment?.file_id ??
    (storedReference && decodeURIComponent(storedReference[1]) === sessionId
      ? decodeURIComponent(storedReference[2])
      : undefined);
  const base = `/v1/sessions/${encodeURIComponent(sessionId ?? "")}`;
  const url = fileId
    ? `${base}/resources/files/${encodeURIComponent(fileId)}/content`
    : reference && itemId
      ? `${base}/attachments/references/${encodeURIComponent(itemId)}?${new URLSearchParams({ path: reference })}`
      : undefined;
  const inline = attachment?.image_url ?? attachment?.file_data;
  const metadata = useQuery({
    queryKey: ["chat-attachment-metadata", sessionId, fileId],
    enabled: !!sessionId && !!fileId && !fileId.startsWith("pending:"),
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await authenticatedFetch(
        `${base}/resources/files/${encodeURIComponent(fileId!)}`,
        { signal },
      );
      if (!res.ok) throw await apiErrorFromResponse(res);
      return res.json() as Promise<{
        name?: string;
        metadata: { bytes: number; content_type?: string };
      }>;
    },
  });
  const filename = metadata.data?.name ?? filenameHint;
  const image =
    /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(filename) || inline?.startsWith("data:image/");
  const content = useQuery({
    queryKey: ["chat-attachment-bytes", sessionId, fileId ?? itemId, reference, inline],
    enabled:
      ((!!url && !!sessionId) || !!inline?.startsWith("data:")) && ((!compact && image) || open),
    retry: false,
    gcTime: 30_000,
    queryFn: async ({ signal }) => {
      let response: Response;
      if (url) response = await authenticatedFetch(url, { signal });
      else if (inline?.startsWith("data:")) {
        const match = inline.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match || match[2].length > 70 * 1024 * 1024)
          throw new Error("Invalid inline attachment");
        response = new Response(
          Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0)),
          { headers: { "Content-Type": match[1] } },
        );
      } else throw new Error("This attachment has no accessible content.");
      if (!response.ok) throw await apiErrorFromResponse(response);
      if (Number(response.headers.get("Content-Length")) > MAX_BYTES)
        throw new Error("Preview exceeds 50 MB. Download from Files instead.");
      const blob = await response.blob();
      if (blob.size > MAX_BYTES) throw new Error("Preview exceeds 50 MB.");
      return blob;
    },
  });
  const blobUrl = useObjectUrl(content.data);
  const mime =
    content.data?.type ||
    metadata.data?.metadata.content_type ||
    filename.split(".").at(-1)?.toUpperCase() ||
    "File";
  const error = attachment?.error ? new Error(attachment.error) : (content.error ?? metadata.error);
  async function download() {
    try {
      const blob = content.data ?? (await content.refetch()).data;
      if (!blob) throw new Error("The file is unavailable. Retry opening it.");
      downloadBlob(blob, filename);
    } catch (failure) {
      toast.error("Could not download attachment", { description: String(failure) });
    }
  }
  const available = !!url || !!inline?.startsWith("data:");
  return (
    <span
      className={
        compact
          ? "not-prose inline"
          : "not-prose my-1 inline-flex max-w-full flex-col gap-1 rounded-md border border-border p-2 align-top"
      }
      data-testid="chat-attachment"
    >
      {!compact && image && blobUrl && failedImage !== blobUrl && (
        <ZoomableImage
          src={blobUrl}
          alt={filename}
          className="max-h-64 max-w-full rounded object-contain"
          onError={() => setFailedImage(blobUrl)}
        />
      )}
      <span className={compact ? "inline" : "flex min-w-0 items-center gap-2"}>
        {!compact && <FileIcon className="size-4 shrink-0 text-muted-foreground" />}
        <button
          type="button"
          className="min-w-0 truncate text-left text-sm text-link hover:underline"
          onClick={() => setOpen(true)}
        >
          {label ?? filename}
        </button>
        {!compact && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Download ${filename}`}
            disabled={!available || content.isFetching}
            onClick={() => void download()}
          >
            <DownloadIcon />
          </Button>
        )}
      </span>
      {!compact && (
        <span className="max-w-full truncate text-xs text-muted-foreground" title={mime}>
          {mime}
          {(metadata.data || content.data) &&
            ` · ${formatBytes(content.data?.size ?? metadata.data!.metadata.bytes)}`}
        </span>
      )}
      {content.isFetching && (
        <span role="status" className="flex items-center gap-1 text-xs">
          <Loader2Icon className="size-3 animate-spin" />
          Loading file…
        </span>
      )}
      {blobUrl && failedImage === blobUrl && (
        <span role="alert" className="text-xs text-destructive">
          This image could not be decoded. Download the original to open it.
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void content.refetch();
              void metadata.refetch();
            }}
          >
            Retry
          </button>
        </span>
      )}
      {!available && !attachment?.error && (
        <span className="text-xs text-muted-foreground">
          {fileId?.startsWith("pending:")
            ? "Uploading…"
            : "File is not attached. Ask the agent to use omnigent attach-file."}
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="break-all">{filename}</DialogTitle>
            <DialogDescription>
              {mime}
              {content.data && ` · ${formatBytes(content.data.size)}`} ·{" "}
              <button type="button" className="text-link underline" onClick={() => void download()}>
                Download original
              </button>
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto">
            {content.isFetching ? (
              <p role="status">Loading file…</p>
            ) : error ? (
              <p role="alert">{error.message}</p>
            ) : content.data && blobUrl ? (
              <AttachmentPreview
                blob={content.data}
                url={blobUrl}
                filename={filename}
                sessionId={sessionId ?? ""}
              />
            ) : (
              <p>Preview unavailable. Download the file to open it.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </span>
  );
}

function AttachmentPreview({
  blob,
  url,
  filename,
  sessionId,
}: {
  blob: Blob;
  url: string;
  filename: string;
  sessionId: string;
}) {
  const lang = detectLang(filename);
  const isText =
    blob.type.startsWith("text/") ||
    /\.(md|txt|log|json|ya?ml|csv|tsv|[cm]?[jt]sx?|py|sh|rs|go|html?)$/i.test(filename);
  const [text, setText] = useState<string>();
  const [source, setSource] = useState(false);
  useEffect(() => {
    let active = true;
    if (isText)
      void blob
        .slice(0, TEXT_BYTES)
        .text()
        .then((value) => {
          if (active) setText(value);
        });
    return () => {
      active = false;
    };
  }, [blob, isText]);
  if (blob.type.startsWith("image/") || /\.(svg|png|jpe?g|webp|avif|gif)$/i.test(filename))
    return (
      <ZoomableImage src={url} alt={filename} className="max-h-[65dvh] max-w-full object-contain" />
    );
  if (blob.type.startsWith("audio/"))
    return (
      <audio
        controls
        src={url}
        className="w-full"
        onError={() => toast.error("Audio playback unavailable. Download the original.")}
      />
    );
  if (blob.type.startsWith("video/"))
    return (
      <video
        controls
        src={url}
        className="max-h-[65dvh] w-full"
        onError={() => toast.error("Video playback unavailable. Download the original.")}
      />
    );
  if (blob.type === "application/pdf" || /\.pdf$/i.test(filename))
    return (
      <Suspense fallback={<p>Loading PDF…</p>}>
        <AttachmentPdf blob={blob} filename={filename} sessionId={sessionId} />
      </Suspense>
    );
  if (!isText)
    return (
      <p className="text-sm text-muted-foreground">
        Preview is unavailable for this format. Download the original to open it.
      </p>
    );
  if (text === undefined) return <p role="status">Loading text…</p>;
  const html = /\.html?$/i.test(filename);
  const markdown = lang === "markdown";
  return (
    <div className="space-y-2">
      {(html || markdown) && (
        <Button type="button" variant="outline" size="sm" onClick={() => setSource(!source)}>
          {source ? "Preview" : "Source"}
        </Button>
      )}
      {blob.size > TEXT_BYTES && (
        <p role="status" className="text-xs text-muted-foreground">
          Preview limited to 512 KiB. Download for the complete file.
        </p>
      )}
      {html && !source ? (
        <iframe
          title={filename}
          sandbox=""
          referrerPolicy="no-referrer"
          className="h-[60dvh] w-full border-0"
          srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">${text}`}
        />
      ) : markdown && !source ? (
        <Suspense fallback={<p>Loading Markdown…</p>}>
          <MarkdownPreview content={text} path={null} tocOpen={false} onTocOpenChange={() => {}} />
        </Suspense>
      ) : (
        <CodeBlock code={text} language={lang} wrap />
      )}
    </div>
  );
}
function AttachmentPdf({
  blob,
  filename,
  sessionId,
}: {
  blob: Blob;
  filename: string;
  sessionId: string;
}) {
  const [data, setData] = useState<FileContentResponse>();
  useEffect(() => {
    let active = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (active)
        setData({
          object: "session.environment.filesystem.file_content",
          path: filename,
          content_type: "application/pdf",
          encoding: "base64",
          content: String(reader.result).split(",")[1],
          bytes: blob.size,
        });
    };
    reader.readAsDataURL(blob);
    return () => {
      active = false;
      reader.abort();
    };
  }, [blob, filename]);
  return data ? <PdfViewer data={data} conversationId={sessionId} /> : <p>Loading PDF…</p>;
}
export function ScopedChatAttachment({
  reference,
  label,
}: {
  reference: string;
  label?: ReactNode;
}) {
  const { sessionId, itemId } = useContext(ChatAttachmentContext);
  return (
    <ChatAttachment sessionId={sessionId} itemId={itemId} reference={reference} label={label} />
  );
}
