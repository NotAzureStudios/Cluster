import { API_URL } from "../../core/api";
import type { LibraryItem } from "./library-types";

export function libraryFileUrl(item: LibraryItem, download = false) {
  const source = download ? item.downloadUrl : item.fileUrl;
  return source ? `${API_URL}${source}` : "";
}
