// glyphEngine.js — unified deterministic glyph generator + renderer
// Provides:
//   glyphEngine.generateGlyphState(metrics)
//   glyphEngine.drawGlyph(p, state, options)

(function (global) {

  // -------------------------
  // Helper Utilities
  // -------------------------

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function map(v, inMin, inMax, outMin, outMax) {
    return outMin + (clamp((v - inMin) / (inMax - inMin), 0, 1) * (outMax - outMin));
  }

  // Safe random using deterministic seed
  function seededRandom(seed) {
    // LCG
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xFFFFFFFF;
    };
  }

  // -------------------------
  // Generate Glyph State
  // -------------------------
  function generateGlyphState(metrics) {
    if (!metrics) return null;

    const rand = seededRandom(metrics.seed || 12345);

    // Color palette derived from colorSeed
    const palettes = [
      {
        ring: { h: 210, s: 40, l: 14 },
        accent: { h: 35, s: 90, l: 55 }
      },
      {
        ring: { h: 28, s: 80, l: 18 },
        accent: { h: 12, s: 90, l: 60 }
      },
      {
        ring: { h: 220, s: 14, l: 20 },
        accent: { h: 40, s: 25, l: 85 }
      }
    ];

    const palette = palettes[(metrics.colorSeed || 0) % palettes.length];

    // Base polygon
    const sides = Math.max(3, Math.floor(metrics.basePolygonSides || 6));

    // Rings
    const ringCount = Math.max(1, metrics.rings || 1);

    // Creases
    const creaseCount = Math.max(1, metrics.creases || 2);

    // Asymmetry angle
    const asymAngle = (metrics.asymmetry || 0) * 0.55;

    // Internal nodes (based on name length)
    const nodeCount = Math.floor(map(metrics.nameLen || 1, 1, 30, 3, 18));
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const a = rand() * Math.PI * 2;
      const r = 0.15 + rand() * 0.25;
      nodes.push({ a, r });
    }

    // Dot accents
    const dotCount = 4 + Math.floor((metrics.highlightClusters || 0) * 8);
    const dots = [];
    for (let i = 0; i < dotCount; i++) {
      dots.push({
        ang: rand() * Math.PI * 2,
        rad: 0.45 + rand() * 0.08,
        size: 4 + rand() * 4
      });
    }

    return {
      seed: metrics.seed || 0,
      palette,
      sides,
      ringCount,
      creaseCount,
      asymAngle,
      asymmetry: metrics.asymmetry || 0,
      audioDurationNorm: metrics.audioDurationNorm || 0,
      nodes,
      dots
    };
  }

  // -------------------------
  // Draw Glyph
  // -------------------------
  // options: { progress: 0..1, mode: 'preview'|'final'|'host' }
  function drawGlyph(p, state, options) {
    // defensive
    options = options || {};
    if (!state) return;

    // small debug guard — don't spam console in production
    // console.log('[drawGlyph] p.width, p.height, progress', p.width, p.height, options.progress);

    const mode = options.mode || "preview";
    const progress = clamp(typeof options.progress === 'number' ? options.progress : 1, 0, 1);

    const t = (p.millis ? p.millis() * 0.0006 : 0);
    const scale = Math.min(p.width, p.height) * 0.42;

    // Detect whether the current p5 renderer is WebGL
    let isWebGL = false;
    try {
      isWebGL = !!(p && p._renderer && p._renderer.drawingContext && (p._renderer.drawingContext instanceof WebGLRenderingContext));
    } catch (e) {
      isWebGL = false;
    }

    p.push();
    // For P2D we translate to center from caller. For WEBGL, caller should NOT translate.
    // Many callers translate before calling drawGlyph; this function assumes (0,0) is center.
    // Apply rotation (small)
    if (mode === "final" && isWebGL && typeof p.rotateY === 'function' && typeof p.rotateX === 'function') {
      // safe to call WEBGL-only funcs only when using WebGL renderer
      try {
        p.rotateY(Math.sin(t * 0.5) * 0.06);
        p.rotateX(Math.sin(t * 0.33) * 0.03);
      } catch (err) {
        // defensive fallback: if any error occurs, skip 3D rotates
      }
    }
    // Safe 2D rotation that always works
    p.rotate(t * (0.1 + 0.05 * state.asymmetry));

    // -------------------------
    // RINGS (progress 0.0 → 0.5)
    // -------------------------
    const ringProg = map(progress, 0.0, 0.5, 0, 1);

    for (let r = state.ringCount; r >= 1; r--) {
      const local = clamp(ringProg, 0, 1);

      const rad = scale * (0.35 + r * 0.18);
      const lightness = Math.max(6, state.palette.ring.l - r * 4);

      p.push();
      // Only apply a 3D translate when in WebGL
      if (mode === "final" && isWebGL && typeof p.translate === 'function') {
        try { p.translate(0, 0, -r * 2); } catch (e) { /* ignore */ }
      }

      p.fill(state.palette.ring.h, state.palette.ring.s, lightness, 0.85 * local);

      p.beginShape();
      for (let i = 0; i < state.sides; i++) {
        const a = (Math.PI * 2 * i) / state.sides;
        const wob = Math.sin(t * 2 + i) * (state.asymmetry * 4);
        p.vertex(Math.cos(a) * (rad + wob), Math.sin(a) * (rad + wob));
      }
      p.endShape(p.CLOSE);

      p.pop();
    }

    // -------------------------
    // CORE POLYGON (progress 0.2 → 0.6)
    // -------------------------
    const coreProg = clamp(map(progress, 0.2, 0.6, 0, 1), 0, 1);

    p.push();
    p.noFill();
    p.stroke(state.palette.accent.h, state.palette.accent.s, state.palette.accent.l, coreProg);
    p.strokeWeight(1.4);

    const coreR = scale * 0.25;

    p.beginShape();
    for (let i = 0; i < state.sides; i++) {
      const a = (Math.PI * 2 * i) / state.sides;
      p.vertex(Math.cos(a) * coreR, Math.sin(a) * coreR);
    }
    p.endShape(p.CLOSE);
    p.noStroke();
    p.pop();

    // -------------------------
    // INTERNAL NODES (0.4 → 0.95)
    // -------------------------
    const nodeProg = clamp(map(progress, 0.4, 0.95, 0, 1), 0, 1);

    p.push();
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      const a = n.a + state.asymAngle * state.asymmetry * 0.6;
      const r = n.r * scale * nodeProg;

      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;

      const size = Math.max(2, 6 * nodeProg * (0.6 + (i / state.nodes.length) * 0.6));

      p.fill(state.palette.ring.h, state.palette.ring.s, state.palette.ring.l + 8, 0.95 * nodeProg);

      if (mode === "final" && isWebGL) {
        p.push();
        // WEBGL-only translate with a small z offset
        try { p.translate(x, y, 2 + Math.sin(t + i) * 2); } catch (e) { p.translate(x, y); }
        p.rectMode(p.CENTER);
        p.rotate(Math.sin(t + i) * 0.2);
        p.rect(0, 0, size * 0.9, size * 0.6, 2);
        p.pop();
      } else {
        // 2D-safe rendering
        p.push();
        p.translate(x, y);
        p.rectMode(p.CENTER);
        p.rotate(Math.sin(t + i) * 0.2);
        p.rect(0, 0, size * 0.9, size * 0.6, 2);
        p.pop();
      }
    }
    p.pop();

    // -------------------------
    // DOT ACCENTS (0.65 → 1)
    // -------------------------
    const dotProg = clamp(map(progress, 0.65, 1, 0, 1), 0, 1);

    p.push();
    for (let i = 0; i < state.dots.length; i++) {
      const d = state.dots[i];

      const ang = d.ang + t * (0.4 + i * 0.02);
      const drad = d.rad * scale;

      const x = Math.cos(ang) * drad;
      const y = Math.sin(ang) * drad;

      const size = d.size * (0.9 + Math.sin(t * 1.2 + i) * 0.15);

      p.push();
      if (mode === "final" && isWebGL) {
        try {
          p.translate(x, y, Math.sin(i * 0.3 + t * 2) * 3);
        } catch (e) {
          p.translate(x, y);
        }
      } else {
        p.translate(x, y);
      }

      p.fill(state.palette.accent.h, state.palette.accent.s, state.palette.accent.l, 0.98 * dotProg);
      p.rectMode(p.CENTER);
      p.rotate(Math.sin(t + i) * 0.2);
      p.rect(0, 0, size * 0.9, size * 0.6, 2);
      p.pop();
    }
    p.pop();

    p.pop();
  }

  // Expose globally
  global.glyphEngine = {
    generateGlyphState,
    drawGlyph
  };

})(window);
