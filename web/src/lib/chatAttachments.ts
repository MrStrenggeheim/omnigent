export interface ChatAttachmentContent {
  type?: string;
  file_id?: string;
  filename?: string;
  image_url?: string;
  file_data?: string;
  error?: string;
}
export function attachmentsFromContent(content: unknown[]): ChatAttachmentContent[] {
  return content.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const block = value as Record<string, unknown>;
    if (
      !["file_id", "image_url", "file_data", "error"].some((key) => typeof block[key] === "string")
    )
      return [];
    return [
      Object.fromEntries(
        ["type", "file_id", "filename", "image_url", "file_data", "error"]
          .filter((key) => typeof block[key] === "string")
          .map((key) => [key, block[key]]),
      ) as ChatAttachmentContent,
    ];
  });
}
