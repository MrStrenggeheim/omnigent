import { createContext, useContext, useLayoutEffect } from "react";

export type FileContentReader = () => string;
export const FileContentReaderContext = createContext<
  ((reader: FileContentReader) => () => void) | null
>(null);

/** Expose the active editor buffer to shared file actions without serializing on each edit. */
export function useFileContentReader(reader: FileContentReader) {
  const register = useContext(FileContentReaderContext);
  useLayoutEffect(() => register?.(reader), [register, reader]);
}
