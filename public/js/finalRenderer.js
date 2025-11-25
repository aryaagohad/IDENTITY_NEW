// finalRenderer.js — WEBGL final renderer using glyphEngine

(function () {

  function parseQuery() {
    return new URLSearchParams(window.location.search);
  }

  function ensureNameOverlay(container) {
    let overlay = container.querySelector(".id-name-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "id-name-overlay";
      overlay.style.position = "absolute";
      overlay.style.right = "14px";
      overlay.style.bottom = "10px";
      overlay.style.color = "#E6E6E6";
      overlay.style.fontFamily =
        "ui-monospace, Menlo, SFMono-Regular, Monaco";
      overlay.style.fontWeight = "300";
      overlay.style.fontSize = "14px";
      overlay.style.pointerEvents = "none";
      overlay.style.zIndex = "5";
      container.style.position = "relative";
      container.appendChild(overlay);
    }
    return overlay;
  }

  // exported from id.html
  window.setupFinal = function () {
    const container = document.getElementById("rendererContainer");

    let participant = null;
    let metrics = null;
    let state = null;

    const sketch = function (p) {

      p.setup = function () {
        const c = p.createCanvas(
          container.clientWidth,
          container.clientHeight,
          p.WEBGL
        );
        c.parent(container);

        p.colorMode(p.HSL);
        p.noStroke();
        ensureNameOverlay(container);
      };

      p.windowResized = function () {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      p.draw = function () {
        const W = container.clientWidth;
const H = container.clientHeight;
if (p.width !== W || p.height !== H) {
  p.resizeCanvas(W, H);
}
        p.clear();
        p.background(245,245,246);
;

        if (!metrics) {
          const id = parseQuery().get("id") || sessionStorage.getItem("participantId");
          if (!id) {
            p.noLoop();
            container.innerHTML = `<div style="padding:18px;color:#ddd">Missing participant id.</div>`;
            return;
          }

          fetch(`/_archive/participant/${id}`)
            .then(r => r.json())
            .then(j => {
              participant = j;
              metrics = j.data.metrics;
              state = window.glyphEngine.generateGlyphState(metrics);

              let overlay = ensureNameOverlay(container);
              overlay.textContent = j.data.firstName || "";
            })
            .catch(() => {
              p.noLoop();
              container.innerHTML = `<div style="padding:18px;color:#ddd">Could not load participant.</div>`;
            });

          return;
        }

        // WEBGL origin is already centered — DO NOT translate
        window.glyphEngine.drawGlyph(p, state, {
          progress: 1,
          mode: "final"
        });
      };
    };

    new p5(sketch, container);
  };

})();









