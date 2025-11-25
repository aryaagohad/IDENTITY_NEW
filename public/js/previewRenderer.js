// previewRenderer.js — clean + centered + auto-resize
// Uses glyphEngine + p5 (P2D) correctly

(function () {

  if (!window.glyphEngine) {
    console.warn("previewRenderer: glyphEngine not found — preview disabled.");
    return;
  }

  let latestMetrics = null;
  let latestState = null;
  let parentEl = null;   // <<< FIX: now global inside this closure

  const sketch = (p) => {

    p.setup = () => {
      parentEl = document.getElementById("livePreview");
      if (!parentEl) {
        console.error("previewRenderer: #livePreview not found");
        return;
      }

      const w = parentEl.clientWidth;
      const h = parentEl.clientHeight;

      const c = p.createCanvas(w, h, p.P2D);
      c.parent(parentEl);

      p.colorMode(p.HSL);
      p.noStroke();
    };

    p.draw = () => {
      if (!parentEl) return;

      // 🔥 ALWAYS FORCE CANVAS TO MATCH CONTAINER
      const W = parentEl.clientWidth;
      const H = parentEl.clientHeight;
      if (p.width !== W || p.height !== H) {
        p.resizeCanvas(W, H);
      }

      p.clear();
      p.background(245,245,246);

      if (!latestMetrics) {
        p.push();
        p.translate(p.width / 2, p.height / 2);
        p.fill(220, 10, 80, 0.08);
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(12);
        p.text("live preview", 0, 0);
        p.pop();
        return;
      }

      latestState = window.glyphEngine.generateGlyphState(latestMetrics);
      const progress = latestMetrics._progress ?? 1;

      p.push();
      p.translate(p.width / 2, p.height / 2); // center canvas
      window.glyphEngine.drawGlyph(p, latestState, {
        progress,
        mode: "preview"
      });
      p.pop();
    };
  };

  new p5(sketch);

  // Used by app.js
  window.updateLivePreview = function (metrics) {
    latestMetrics = metrics ? { ...metrics } : null;
  };

})();






