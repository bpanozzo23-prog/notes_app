import Dialog from "./Dialog.jsx";
import { estimateRequest, imageTokens } from "../claude/payload.js";
import { aboutMoney } from "../claude/ask.js";
import { CLAUDE_MODEL, PRICES } from "../claude/config.js";

export default function Disclosure({ prepared, onImages, onCancel, onClose = onCancel, onSend, busy, disabled, message }) {
  const { payload, question, images, now } = prepared;
  const tidy = payload.kind === "tidy";
  const estimate = estimateRequest({ kind: tidy ? "tidy" : "question", payload, images, question, now });
  const count = payload.images?.length ?? 0;
  const extra = (images?.images ?? payload.images ?? []).slice(0, 20).reduce((sum, image) => sum + (Number.isFinite(image.width) ? imageTokens(image) : 0), 0);
  return <Dialog title="Send to Anthropic?" onClose={onClose} busy={busy}>
    <div className="space-y-3 break-words text-sm leading-relaxed">
      <p className="whitespace-pre-wrap font-medium">{tidy ? payload.instruction || "Fix mistakes and tidy the formatting" : question}</p>
      {tidy ? <><p>This note: its title, text and formatting, folder and tags</p>
        <p>Also: your folder names, the tags you use, and the titles of your other {payload.otherNotes.length} notes</p>
        <p>Images: not sent (Claude sees only where they are)</p></> : <p>{payload.entries.length} {payload.entries.length === 1 ? "note" : "notes"}: titles, text, folders, tags, dates</p>}
      {!tidy && !images && <p>Images: not sent ([image] marks where they are)</p>}
      {payload.scope?.kind === "note" && count > 0 && <label className="flex min-h-11 items-start gap-2">
        <input type="checkbox" className="mt-1" checked={!!images} disabled={busy || disabled} onChange={(event) => onImages(event.target.checked)} />
        <span>Include its {count} {count === 1 ? "image" : "images"} (about {extra.toLocaleString("en-GB")} tokens, {aboutMoney(extra * PRICES[CLAUDE_MODEL][1] / 1000000)} more)</span>
      </label>}
      {images && <>
        <p>{images.images.length} {images.images.length === 1 ? "image" : "images"} prepared · {images.sentBytes < 1024 * 1024 ? `${Math.max(1, Math.round(images.sentBytes / 1024))} KB` : `${(images.sentBytes / 1024 ** 2).toFixed(1)} MB`} to send</p>
        {images.omitted.map((item, index) => <p key={item.fileId}>Image {(payload.images ?? []).findIndex((image) => image.fileId === item.fileId) + 1 || index + 1} omitted: {item.reason}</p>)}
      </>}
      <p>Trash: not sent</p>
      <p>About {estimate.tokens.toLocaleString("en-GB")} tokens · {aboutMoney(estimate.dollars)}</p>
      {estimate.tokens > 100000 && <p className="font-semibold">This is a large request</p>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Preparing images…</p>}
    </div>
    <div className="mt-5 flex justify-end gap-2">
      <button data-initial-focus className="app-button" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="app-button" disabled={busy || disabled} onClick={onSend}>Send</button>
    </div>
  </Dialog>;
}
