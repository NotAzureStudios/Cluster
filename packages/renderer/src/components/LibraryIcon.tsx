import { useEffect, useState } from "react";
import { loadLibraryGlyph, type IconLibrarySet, type LibraryGlyph } from "../core/icon-library";

/** One icon from the on-demand library, drawn in the current text color. */
export function LibraryIcon({ set, name, className = "" }: { set: IconLibrarySet; name: string; className?: string }) {
  const [glyph, setGlyph] = useState<LibraryGlyph | null>(null);
  useEffect(() => {
    let live = true;
    setGlyph(null);
    void loadLibraryGlyph(set, name).then((value) => { if (live) setGlyph(value); }).catch(() => undefined);
    return () => { live = false; };
  }, [set, name]);
  // Bodies come from the bundled Tabler and Simple Icons sets, not from users.
  return <svg className={`library-icon ${className}`.trim()} viewBox={`0 0 ${glyph?.width || 24} ${glyph?.height || 24}`} width="1em" height="1em" aria-hidden="true" dangerouslySetInnerHTML={glyph ? { __html: glyph.body } : undefined} />;
}
