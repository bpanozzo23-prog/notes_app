import { useEffect, useState } from "react";
import Dialog from "../components/Dialog.jsx";
import { acquire, release } from "./fileUrls.js";

export default function ImageViewer({ image, onClose }) {
  const [url, setUrl] = useState(undefined);
  const [actual, setActual] = useState(false);
  useEffect(() => {
    let alive = true;
    acquire(image.file).then((url) => { if (alive) setUrl(url); });
    return () => { alive = false; release(image.file); };
  }, [image.file]);
  return <Dialog title="Image" sheet fullScreen fullWidth onClose={onClose} footer={<div className="flex justify-between gap-3">
    <button className="app-button image-size-toggle" aria-pressed={actual} onClick={() => setActual(!actual)}>Actual size</button>
    <button className="app-button" onClick={onClose}>Close</button>
  </div>}>
    <div className={`image-viewer ${actual ? "image-viewer-actual" : ""}`}>
      {url ? <img src={url} alt={image.alt} width={image.width ?? undefined} height={image.height ?? undefined} onError={() => setUrl(null)} />
        : <div className="image-missing">{url === undefined ? "Loading image…" : "Image not found"}</div>}
    </div>
  </Dialog>;
}
