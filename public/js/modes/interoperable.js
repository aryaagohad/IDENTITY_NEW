// public/js/modes/interoperable.js
// Host-side Interoperable Mode — glyph mutation driven by audio (intensity + pitch).
// Listens to interoperable:join / leave / update
// Uses glyphEngine and computeMetrics for deterministic glyphs.

(function (global) {

  window.startModeSketch = function (container, socket) {
    const participants = {}; // pid -> { pdata, metrics, state, control, x,y,vx,vy, merged }

    // fetch participant archive + compute state (same pattern used in other modes)
    async function fetchParticipant(pid) {
      try {
        const res = await fetch('/_archive/participant/' + encodeURIComponent(pid));
        if (!res.ok) throw new Error('not found');
        const j = await res.json();
        const pdata = j.data || j;
        let metrics = pdata.metrics || null;
        if (!metrics && global.computeMetrics) {
          try { metrics = computeMetrics(pdata, pdata.audio || null); } catch (e) { metrics = null; }
        }
        const finalMetrics = metrics || {
          seed: Math.floor(Math.random() * 1e9),
          basePolygonSides: 6,
          rings: 2,
          creases: 2,
          asymmetry: 0.2,
          nameLen: (pdata.firstName || '').length || 5,
          vowelRatio: 0.3,
          highlightClusters: 0.4,
          colorSeed: Math.floor(Math.random() * 360)
        };
        const state = (global.glyphEngine && typeof global.glyphEngine.generateGlyphState === 'function')
          ? global.glyphEngine.generateGlyphState(finalMetrics) : null;

        return { pdata, metrics: finalMetrics, state };
      } catch (err) {
        console.warn('fetchParticipant error', err);
        return null;
      }
    }

    async function addParticipant(pid) {
      if (participants[pid]) return;
      participants[pid] = {
        id: pid,
        pdata: null,
        metrics: null,
        state: null,
        control: { intensity: 0, pitch: 0, ts: Date.now() },
        x: container.clientWidth * (0.25 + Math.random() * 0.5),
        y: container.clientHeight * (0.25 + Math.random() * 0.5),
        vx: 0,
        vy: 0,
        mergedWith: null,
        mergeUntil: 0,
        mergeCount: 0
      };

      const fetched = await fetchParticipant(pid);
      if (fetched) {
        participants[pid].pdata = fetched.pdata;
        participants[pid].metrics = fetched.metrics;
        participants[pid].state = fetched.state;
      }
    }

    function removeParticipant(pid) {
      delete participants[pid];
    }

    // socket handlers
    socket.on('interoperable:participant-joined', (d) => {
      if (d && d.participantId) addParticipant(d.participantId);
    });
    socket.on('interoperable:participant-left', (d) => {
      if (d && d.participantId) removeParticipant(d.participantId);
    });
    socket.on('interoperable:update', (pkt) => {
      if (!pkt || !pkt.participantId) return;
      const p = participants[pkt.participantId];
      if (!p) return;
      // sanitize
      p.control.intensity = Math.max(0, Math.min(1, pkt.intensity || 0));
      p.control.pitch = (typeof pkt.pitch === 'number') ? pkt.pitch : (p.control.pitch || 0);
      p.control.ts = pkt.ts || Date.now();
    });

    // helper: map pitch to normalized 0..1 (human voice range 80Hz..2000Hz roughly)
    function pitchToNorm(p) {
      if (!p || p <= 0) return 0;
      const minHz = 80, maxHz = 2000;
      return Math.max(0, Math.min(1, (Math.log(p) - Math.log(minHz)) / (Math.log(maxHz) - Math.log(minHz))));
    }

    // check merge: when two glyphs come close and both had a non-trivial intensity recently
    function checkMerges() {
      const now = Date.now();
      const ids = Object.keys(participants);
      for (let i = 0; i < ids.length; i++) {
        const a = participants[ids[i]];
        if (!a) continue;
        for (let j = i + 1; j < ids.length; j++) {
          const b = participants[ids[j]];
          if (!b) continue;
          // skip if already merged with someone else
          if (a.mergedWith || b.mergedWith) continue;

          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const threshold = Math.min(container.clientWidth, container.clientHeight) * 0.08;
          // require both recently vocal (intensity > 0.08)
          const recentA = (Date.now() - (a.control.ts || 0)) < 5000;
          const recentB = (Date.now() - (b.control.ts || 0)) < 5000;
          if (d < threshold && recentA && recentB && (a.control.intensity > 0.06 || b.control.intensity > 0.06)) {
            // merge them
            const mergeDuration = 30000; // 30s
            a.mergedWith = b.id;
            b.mergedWith = a.id;
            const until = Date.now() + mergeDuration;
            a.mergeUntil = until;
            b.mergeUntil = until;
            a.mergeCount = (a.mergeCount || 0) + 1;
            b.mergeCount = (b.mergeCount || 0) + 1;
            // freeze their velocity so they "stick"
            a.vx = a.vy = 0;
            b.vx = b.vy = 0;
            // set opacity target via a property
            a._mergedOpacity = 0.4;
            b._mergedOpacity = 0.4;
          }
        }
      }
    }

    // p5 sketch
    const sketch = function (p) {
      p.setup = function () {
        const c = p.createCanvas(container.clientWidth, container.clientHeight);
        c.parent(container);
        p.colorMode(p.HSL);
        p.noStroke();
        p.textFont("ui-monospace, Menlo, Monaco");
      };

      p.windowResized = function () {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      function drawGlyphMutated(part) {
        if (!part.state) return;

        const cx = part.x;
        const cy = part.y;

        // intensity -> scale & progress
        const intensity = part.control.intensity || 0;
        const pitchNorm = pitchToNorm(part.control.pitch || 0);

        // compute scale: base + intensity influence
        const baseScale = Math.min(p.width, p.height) * 0.12;
        const scale = baseScale * (1 + intensity * 0.9);

        p.push();
        p.translate(cx, cy);

        // pitch -> rotation & subtle shear (higher pitch = faster rotation)
        const rot = (pitchNorm - 0.5) * 1.6; // -0.8 .. +0.8 radians
        p.rotate(rot * 0.4);

        // distortion: when intensity is low but pitch high, wobble nodes more; when intensity high, blow up
        const wobble = (0.1 + pitchNorm * 0.6) * (0.8 + intensity * 1.2);

        // apply scale (use p.scale with pixels)
        p.scale(scale / 300); // glyphEngine draws with a notional coordinate system; scale factor normalized

        // subtle animated distortion via translate with sin using frameCount & wobble
        const t = p.frameCount * 0.01;
        const tx = Math.sin(t * (0.5 + pitchNorm * 2.0)) * wobble * 6 * (1 + intensity * 2.0);
        const ty = Math.cos(t * (0.4 + pitchNorm * 1.5)) * wobble * 4 * (1 + intensity * 1.6);
        p.translate(tx, ty);

        // Prepare a modified state copy so we can nudge asymmetry/progress without mutating original
        const s = JSON.parse(JSON.stringify(part.state || {}));
        // push asymmetry with pitch & intensity
        s.asymmetry = Math.max(0, Math.min(1, (s.asymmetry || 0) + pitchNorm * 0.4 + intensity * 0.2));
        // make node positions slightly noisier under intensity
        if (s.nodes && s.nodes.length) {
          for (let i = 0; i < s.nodes.length; i++) {
            s.nodes[i].a += Math.sin(t + i) * (0.05 + pitchNorm * 0.1) * (0.6 + intensity * 0.7);
            s.nodes[i].r *= (0.9 + intensity * 0.25 + pitchNorm * 0.08);
          }
        }
        // push dots outward with intensity
        if (s.dots && s.dots.length) {
          for (let i = 0; i < s.dots.length; i++) {
            s.dots[i].rad *= (1 + intensity * 0.35 + pitchNorm * 0.15);
            s.dots[i].size *= (1 + intensity * 0.3);
          }
        }

        // compute progress param: when in center progress ~1 (defined glyph), when away progress reduces
        const dxC = (part.x - p.width / 2) / p.width;
        const dyC = (part.y - p.height / 2) / p.height;
        const distNorm = Math.sqrt(dxC * dxC + dyC * dyC);
        const centerRadius = 0.28;
        const prog = Math.max(0.35, 1 - Math.max(0, (distNorm - centerRadius) * 1.8));

        // pass progress in options
        try {
          global.glyphEngine.drawGlyph(p, s, { mode: "host", progress: prog });
        } catch (err) {
          // fallback: if draw fails, draw a simple circle
          p.push();
          p.fill(0,0,96,0.12);
          p.circle(0,0, 30);
          p.pop();
        }

        p.pop();
      }

      p.draw = function () {
        p.clear();
        p.background(210, 10, 6);

        const ids = Object.keys(participants);
        if (ids.length === 0) {
          p.push();
          p.fill(0, 0, 96, 0.12);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(14);
          p.text('Waiting for participants to join Interoperable Mode...', p.width / 2, p.height / 2);
          p.pop();
          return;
        }

        // physics & update
        for (const id of ids) {
          const part = participants[id];
          if (!part) continue;

          // simple movement: slight drift + audio-driven nudge
          const intensity = part.control.intensity || 0;
          const pitchN = pitchToNorm(part.control.pitch || 0);

          // nudge velocity based on intensity and a pseudo-random seeded by id
          const seedShake = (id.charCodeAt(0) || 7) % 7;
          const nudgex = (Math.sin((p.frameCount + seedShake * 7) * 0.01 + seedShake) * 0.3);
          const nudgey = (Math.cos((p.frameCount + seedShake * 11) * 0.009 + seedShake) * 0.2);

          part.vx += nudgex * 0.2 + (intensity - 0.1) * 2.4 * (0.5 + pitchN);
          part.vy += nudgey * 0.2 + (intensity - 0.1) * 1.8 * (0.5 + pitchN);

          // damp and apply
          part.vx *= 0.92;
          part.vy *= 0.92;
          part.x += part.vx;
          part.y += part.vy;

          // keep within bounds
          const margin = 24;
          if (part.x < margin) { part.x = margin; part.vx *= -0.6; }
          if (part.y < margin) { part.y = margin; part.vy *= -0.6; }
          if (part.x > p.width - margin) { part.x = p.width - margin; part.vx *= -0.6; }
          if (part.y > p.height - margin) { part.y = p.height - margin; part.vy *= -0.6; }
        }

        // merges
        checkMerges();

        // draw links between similar pitch (if both are vocal lately)
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = participants[ids[i]];
            const b = participants[ids[j]];
            if (!a || !b) continue;
            // if both vocal recently, and pitch proximity small -> draw wavey link
            const now = Date.now();
            const recentA = (now - (a.control.ts || 0)) < 4000;
            const recentB = (now - (b.control.ts || 0)) < 4000;
            const pa = a.control.pitch || 0;
            const pb = b.control.pitch || 0;
            if (!recentA && !recentB) continue;
            if (pa <= 0 || pb <= 0) continue;
            const diff = Math.abs(pa - pb);
            const rel = Math.min(1, diff / Math.max(1, (Math.max(pa, pb) * 0.2)));
            // small tolerance for "similar pitch"
            if (diff < Math.max(40, Math.min(220, Math.max(pa, pb) * 0.12))) {
              p.push();
              p.stroke((a.metrics.colorSeed || 200) % 360, 60, 60, 0.16 + 0.3 * (a.control.intensity + b.control.intensity) / 2);
              p.strokeWeight(1 + (a.control.intensity + b.control.intensity) * 1.6);
              // draw a curved bezier
              p.noFill();
              const mx = (a.x + b.x) / 2 + Math.sin(p.frameCount * 0.02 + rel) * 20;
              const my = (a.y + b.y) / 2 + Math.cos(p.frameCount * 0.02 - rel) * 16;
              p.bezier(a.x, a.y, mx, my, mx, my, b.x, b.y);
              p.pop();
            }
          }
        }

        // draw participants (glyphs)
        for (const id of ids) {
          const part = participants[id];
          if (!part) continue;

          // If merged and still within mergeUntil, freeze them visually (draw at same spot)
          if (part.mergedWith && Date.now() <= part.mergeUntil) {
            // draw with reduced opacity (handled via globalAlpha)
            p.push();
            p.drawingContext.globalAlpha = part._mergedOpacity || 0.4;
            drawGlyphMutated(part);
            p.drawingContext.globalAlpha = 1.0;
            p.pop();

            // draw concentric rings for how many times merged (1 ring per mergeCount)
            if (part.mergeCount && part.mergeCount > 0) {
              p.push();
              p.noFill();
              const hue = (part.metrics && part.metrics.colorSeed) ? part.metrics.colorSeed % 360 : 200;
              p.stroke(hue, 60, 60, 0.18);
              p.strokeWeight(1.2);
              for (let r = 0; r < Math.min(6, part.mergeCount); r++) {
                p.circle(part.x, part.y, (Math.min(p.width, p.height) * 0.08) + r * 10);
              }
              p.pop();
            }

            // if merge expired, clear mergedWith so they can separate next frame
            if (Date.now() > part.mergeUntil) {
              part.mergedWith = null;
              part.mergeUntil = 0;
              // restore opacity
              part._mergedOpacity = 1.0;
            }
          } else {
            // normal draw
            drawGlyphMutated(part);
          }

          // draw name label
          p.push();
          p.fill(0,0,98,0.95);
          p.textAlign(p.CENTER, p.TOP);
          p.textSize(11);
          const label = (part.pdata && (part.pdata.firstName || part.pdata.nativeName)) || 'anon';
          p.text(label, part.x, part.y + Math.min(44, Math.max(28, Math.min(p.width,p.height)*0.06)));
          p.pop();
        }
      };
    };

    return new p5(sketch, container);
  };

})(window);
