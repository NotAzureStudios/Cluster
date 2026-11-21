import { createContext, useContext } from "react";

/* A page or window that already frames the viewer (the Library preview, a
   project review stage) provides its toolbar element here. The viewer then
   drops its own title bar and border and puts its tools in that toolbar, so
   there is one header instead of a window inside a window. */
export const ViewerHostToolbarContext = createContext<HTMLElement | null | undefined>(undefined);
export const ViewerHostToolbarProvider = ViewerHostToolbarContext.Provider;
export const useViewerHostToolbar = () => useContext(ViewerHostToolbarContext);
