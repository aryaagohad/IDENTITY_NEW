// downloads.js — minimal, non-invasive exports
// PNG -> full card if #cardExportWrapper exists (uses html2canvas if available, otherwise canvas fallback).
// WEBM -> animated glyph only (canvas capture).
(function () {

  function getRendererCanvas() {
    const container = document.getElementById("rendererContainer");
    if (!container) return null;
    return container.querySelector("canvas");
  }

  // PNG: prefer html2canvas on the wrapper; fallback to canvas.toDataURL
  async function downloadPNG() {
    const wrapper = document.getElementById("cardExportWrapper");
    const canvas = getRendererCanvas();

    // If wrapper exists and html2canvas is available, snapshot the wrapper (glyph + card)
    if (wrapper && window.html2canvas) {
      try {
        const snap = await html2canvas(wrapper, { backgroundColor: null, scale: 2, useCORS: true });
        const link = document.createElement("a");
        link.href = snap.toDataURL("image/png");
        link.download = generateFilename("identity_card", "png");
        link.click();
        return;
      } catch (err) {
        // fallthrough to canvas fallback
        console.warn("html2canvas capture failed, falling back to canvas:", err);
      }
    }

    // If wrapper exists but html2canvas missing -> alert and fall back to canvas if present
    if (wrapper && !window.html2canvas) {
      console.warn("html2canvas not found — capturing canvas-only as fallback.");
    }

    // Fallback: capture the renderer canvas only (may not include card UI)
    if (canvas) {
      try {
        const dataUrl = canvas.toDataURL("image/png");
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = generateFilename("identity_canvas", "png");
        link.click();
        return;
      } catch (err) {
        alert("Unable to export PNG: canvas capture failed.");
        console.error(err);
        return;
      }
    }

    alert("Nothing to export: renderer not ready.");
  }

  // WEBM: capture the canvas stream and record for durationMs
  function downloadWEBM(durationMs = 3000, fps = 30) {
    const canvas = getRendererCanvas();
    if (!canvas) {
      alert("Renderer not ready — try again in a moment.");
      return;
    }

    let stream;
    try {
      stream = canvas.captureStream(fps);
    } catch (e) {
      alert("Canvas captureStream not supported in this browser.");
      console.error(e);
      return;
    }

    const chunks = [];
    let mimeType = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = "video/webm;codecs=vp8";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm";
      }
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      try {
        recorder = new MediaRecorder(stream);
      } catch (err2) {
        alert("MediaRecorder not supported in this browser.");
        console.error(err2);
        return;
      }
    }

    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = generateFilename("identity_glyph", "webm");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };

    recorder.start();
    // optional UI: disable button while recording — kept out to avoid changing visuals

    setTimeout(() => {
      try { recorder.stop(); } catch (e) { console.warn("recorder stop error", e); }
    }, durationMs);
  }

  // small util filename generator
  function generateFilename(base, ext) {
    const id = (new URLSearchParams(window.location.search).get("id")) || (sessionStorage.getItem("participantId") || "");
    const timeSuffix = new Date().toISOString().replace(/[:.]/g, "-");
    return `${base}${id ? "-" + id : ""}-${timeSuffix}.${ext}`;
  }

  // wire buttons on DOM ready, but do not modify visual elements
  function wireButtons() {
    const pngBtn = document.getElementById("downloadPngBtn");
    const webmBtn = document.getElementById("downloadWebmBtn");

    if (pngBtn) {
      pngBtn.addEventListener("click", (e) => {
        e.preventDefault();
        downloadPNG();
      });
    }
    if (webmBtn) {
      webmBtn.addEventListener("click", (e) => {
        e.preventDefault();
        downloadWEBM();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireButtons);
  } else {
    wireButtons();
  }

  // expose for debugging if needed
  window._identityDownloads = {
    downloadPNG, downloadWEBM
  };

})(); 
