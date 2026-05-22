export type FileViewMode = "auto" | "panel" | "external" | "reveal";

export const FILE_VIEWER_PANEL_PATH = "builtin:file-viewer";

export type FileViewerKind =
  | "markdown"
  | "text"
  | "html"
  | "code"
  | "json"
  | "table"
  | "image"
  | "pdf"
  | "document"
  | "spreadsheet"
  | "slides"
  | "media"
  | "archive"
  | "directory"
  | "unsupported";

export type FileViewerPayload = {
  panelKind: "file-viewer";
  path: string;
  fileName: string;
  ext: string;
  mimeType: string | null;
  sizeBytes: number;
  viewerKind: FileViewerKind;
  content?: string;
  previewUrl?: string;
  truncated?: boolean;
  documentError?: string;
  actions: {
    openExternal: boolean;
    reveal: boolean;
  };
};
