export function jsonBlob(obj) {
  if (!Array.isArray(obj.files)) return new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const { files, ...envelope } = obj;
  const parts = [JSON.stringify(envelope).slice(0, -1), ',"files":['];
  files.forEach((file, index) => { if (index) parts.push(","); parts.push(JSON.stringify(file)); });
  parts.push("]}");
  return new Blob(parts, { type: "application/json" });
}

export function downloadJson(obj, filename) {
  downloadBlob(jsonBlob(obj), filename);
}

// A note title as a file name that Android's share sheet, Downloads and Windows all accept.
export function safeFileName(name, extension, fallback = "Note") {
  let base = String(name ?? "").normalize("NFC").replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[/\\:|]/g, "-").replace(/[*?"<>]/g, "")
    .replace(/^[. ]+|[. ]+$/g, "").replace(/\.{2,}/g, "…");
  base = Array.from(base).slice(0, 60).join("").replace(/[. ]+$/, "");
  // Windows reserves these names even with an extension ("CON.txt").
  base = base.replace(/^(con|prn|aux|nul|com\d|lpt\d)(?=\.|$)/i, "$1_");
  return `${base || fallback}.${extension}`;
}

// Chrome on Android shares only listed file types, checking both the name's extension and the
// exact type: .md and text/markdown are refused, so Markdown travels as a .txt file.
// Returns null when this browser can't share the file, otherwise the share's promise.
export function shareTextFile(text, filename) {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  const file = new File([text], filename, { type: "text/plain" });
  try { if (!navigator.canShare({ files: [file] })) return null; } catch { return null; }
  return navigator.share({ files: [file] });
}

export function downloadText(text, filename) {
  downloadBlob(new Blob([text], { type: "text/markdown;charset=utf-8" }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Android Chrome can cancel a download if its URL is revoked immediately.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read this file"));
    reader.onabort = () => reject(new Error("File reading was cancelled"));
    reader.readAsText(file);
  });
}
