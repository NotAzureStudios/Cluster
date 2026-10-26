import { useEffect, useState } from "react";
import { getNativeClipboardStatus, readNativeClipboardText, writeNativeClipboardText } from "../../core/desktop";
import { ClusterIcon } from "../../components/ClusterIcon";
import { openCommandPaletteWithQuery } from "../search/command-palette-handoff";
import { openSharedCreate } from "../create/shared-create-handoff";
import "./desktop-workspace.css";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";

export function DesktopClipboardWidget() {
  const desktop = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!desktop) return;
    void getNativeClipboardStatus()
      .then((status) => setAvailable(Boolean(status.available && status.readText && status.readRequiresConfirmation)))
      .catch(() => setAvailable(false));
  }, [desktop]);

  if (!desktop) return null;

  async function readClipboard() {
    setBusy(true);
    setMessage("");
    try {
      const result = await readNativeClipboardText("fill the Home clipboard widget");
      setText(result.text || "");
      setMessage(result.truncated ? "Clipboard text was capped at the native 4,096-character safety limit." : result.text ? "Clipboard text loaded once." : "The clipboard contains no plain text.");
    } catch (error) {
      const code = String((error as { code?: string })?.code || "");
      setMessage(code === "USER_CANCELLED" ? "Clipboard access was not granted." : error instanceof Error ? error.message : "Clipboard read failed.");
    } finally {
      setBusy(false);
    }
  }

  function searchClipboard() {
    const query = text.trim();
    if (!query) return;
    openCommandPaletteWithQuery(query);
  }


  function createFromClipboard(mode: "card" | "ticket") {
    const value = text.trim();
    if (!value) return;
    const [firstLine, ...rest] = value.split(/\r?\n/);
    const title = firstLine.trim().slice(0, 160) || (mode === "ticket" ? "Clipboard ticket" : "Clipboard card");
    openSharedCreate(mode, { title, details: rest.join("\n").trim() || value });
    setMessage(`Clipboard text handed to Shared Create as a ${mode === "ticket" ? "ticket" : "card"}.`);
  }

  async function copyEditedText() {
    const value = text.trim();
    if (!value) return;
    try {
      await writeNativeClipboardText(value);
      setMessage("Edited text copied back through the native clipboard boundary.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clipboard write failed.");
    }
  }

  return <section className="desktop-clipboard-widget-v481" aria-label="Clipboard">
    <div className="home-section-title-v141 compact">
      <div className="desktop-clipboard-title-v481"><ClusterIcon name="work" /><h3>Clipboard</h3></div>
      <span>{available ? "On demand" : "Unavailable"}</span>
    </div>
    {text ? <div className="desktop-clipboard-preview-v481"><ClusterTextArea aria-label="Clipboard text" value={text} maxLength={4096} onChange={(event) => setText(event.target.value)} /></div> : <p className="muted desktop-clipboard-empty-v481">Read plain text only when you ask. Desktop confirms every read and never monitors clipboard changes.</p>}
    <div className="desktop-clipboard-actions-v481">
      <ClusterButton type="button" className="" disabled={!available || busy} onClick={() => void readClipboard()} variant="quiet" size="compact">{busy ? "Reading…" : text ? "Read again" : "Read clipboard"}</ClusterButton>
      {text && <ClusterButton type="button" className="" onClick={searchClipboard} variant="quiet" size="compact">Search</ClusterButton>}
      {text && <ClusterButton type="button" className="" onClick={() => createFromClipboard("card")} variant="quiet" size="compact">Create card</ClusterButton>}
      {text && <ClusterButton type="button" className="" onClick={() => createFromClipboard("ticket")} variant="quiet" size="compact">Create ticket</ClusterButton>}
      {text && <ClusterButton type="button" className="" onClick={() => void copyEditedText()} variant="quiet" size="compact">Copy back</ClusterButton>}
      {text && <ClusterButton type="button" className="" onClick={() => { setText(""); setMessage(""); }} variant="quiet" size="compact">Clear</ClusterButton>}
    </div>
    {message && <small className="desktop-clipboard-message-v481" role="status">{message}</small>}
  </section>;
}
