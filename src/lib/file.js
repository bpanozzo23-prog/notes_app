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
