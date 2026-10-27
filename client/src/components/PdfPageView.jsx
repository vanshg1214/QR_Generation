import { useEffect, useRef, useState } from "react";

// Draws page 1 of a PDF (a Blob) as an image, so the real generated page can be checked on
// any device, including phones that can't show PDFs inline. pdf.js is loaded only when needed.
let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

export default function PdfPageView({ blob, label }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    let task = null;
    setReady(false);
    setError("");
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const page = await doc.getPage(1);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        // Sharp on high-density screens, but not bigger than needed.
        const cssWidth = Math.min(wrapRef.current?.clientWidth || 600, 900);
        const scale = (cssWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.aspectRatio = `${base.width} / ${base.height}`;
        task = page.render({ canvasContext: canvas.getContext("2d"), viewport });
        await task.promise;
        if (!cancelled) setReady(true);
        doc.destroy();
      } catch (err) {
        if (!cancelled && err?.name !== "RenderingCancelledException") setError("Could not show the PDF page here. Use \"Open PDF\" instead.");
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [blob]);

  return (
    <div className="pdf-page-view" ref={wrapRef}>
      {!ready && !error && <p className="muted small">Drawing the PDF page…</p>}
      {error && <p className="error-text">{error}</p>}
      <canvas ref={canvasRef} aria-label={label} hidden={!ready} />
    </div>
  );
}
