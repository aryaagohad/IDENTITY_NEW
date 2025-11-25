// relational.js — FINAL FULL VERSION
// Clean real-time 2D glyph control for 6–10 participants
// Using gaze (x-control), proximity (size), and connection lines.

(function (global) {

  window.startModeSketch = function (container, socket) {

    const participantsMap = {};

    // ---------------------------------------------------
    // FETCH PARTICIPANT DATA + METRICS + GLYPH STATE
    // ---------------------------------------------------
    async function fetchParticipantState(participantId) {
      try {
        const res = await fetch("/_archive/participant/" + encodeURIComponent(participantId));
        if (!res.ok) throw new Error("not found");
        const j = await res.json();

        const pdata = (j && j.data) ? j.data : j;
        let metrics = pdata.metrics || null;

        if (!metrics && global.computeMetrics) {
          try { metrics = computeMetrics(pdata, pdata.audio || null); }
          catch (e) { metrics = null; }
        }

        const finalMetrics = metrics || {
          seed: Math.floor(Math.random() * 1e9),
          basePolygonSides: 6,
          rings: 2,
          creases: 2,
          asymmetry: 0.2,
          nameLen: (pdata.firstName || "").length || 5,
          vowelRatio: 0.3,
          highlightClusters: 0.4,
          colorSeed: Math.floor(Math.random() * 360)
        };

        const state = global.glyphEngine
          ? global.glyphEngine.generateGlyphState(finalMetrics)
          : null;

        return { pdata, metrics: finalMetrics, state };

      } catch (err) {
        console.warn("fetchParticipantState error", err);
        return null;
      }
    }

    // ---------------------------------------------------
    // CREATE PARTICIPANT ENTRY
    // ---------------------------------------------------
    async function addParticipant(pid) {
      if (!pid || participantsMap[pid]) return;

      participantsMap[pid] = {
        id: pid,
        pdata: null,
        metrics: null,
        state: null,
        control: { gaze: 0.5, proximity: 0.35 },
        x: container.clientWidth * 0.5,
        y: container.clientHeight * 0.5,
        _smoothProx: 0.35,
        _renderScale: 40
      };

      const fetched = await fetchParticipantState(pid);
      if (fetched) {
        const entry = participantsMap[pid];
        entry.pdata = fetched.pdata;
        entry.metrics = fetched.metrics;
        entry.state = fetched.state;
      }
    }

    function removeParticipant(pid) {
      delete participantsMap[pid];
    }

    // ---------------------------------------------------
    // SOCKET EVENTS
    // ---------------------------------------------------
    socket.on("relational:participant-joined", (data) => {
      if (data && data.participantId) addParticipant(data.participantId);
    });

    socket.on("relational:participant-left", (data) => {
      if (data && data.participantId) removeParticipant(data.participantId);
    });

    socket.on("relational:update", (packet) => {
      const pid = packet.participantId;
      const p = participantsMap[pid];
      if (!p) return;
      p.control.gaze = Math.max(0, Math.min(1, packet.gaze));
      p.control.proximity = Math.max(0, Math.min(1, packet.proximity));
    });

    function clamp01(v) { return Math.max(0, Math.min(1, v)); }


    // ---------------------------------------------------
    // P5 SKETCH
    // ---------------------------------------------------
    const sketch = function (p) {

      p.setup = function () {
        const c = p.createCanvas(container.clientWidth, container.clientHeight);
        c.parent(container);
        p.colorMode(p.HSL);
        p.noStroke();
        p.textFont("ui-monospace, Menlo, Monaco, 'Roboto Mono'");
        p._connections = [];   // persistent connection lines
      };

      p.windowResized = function () {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      // ---------------------------------------------------
      // AVOID GLYPH OVERLAP (small force)
      // ---------------------------------------------------
      function applySeparation(self, list, minDist) {
        let dxSum = 0, dySum = 0, count = 0;

        for (const o of list) {
          if (o.id === self.id) continue;
          const dx = self.x - o.x;
          const dy = self.y - o.y;
          const d = Math.sqrt(dx * dx + dy * dy);

          if (d > 0 && d < minDist) {
            dxSum += dx / d;
            dySum += dy / d;
            count++;
          }
        }

        if (count > 0) {
          self.x += (dxSum / count) * 1.4;   // gentle push (used to be 6)
          self.y += (dySum / count) * 1.4;

        }
      }

      // ---------------------------------------------------
      // DRAW LOOP
      // ---------------------------------------------------
      p.draw = function () {
        p.clear();
        p.background(210, 10, 6);

        const ids = Object.keys(participantsMap);
        if (ids.length === 0) {
          p.fill(0, 0, 90, 0.06);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(14);
          p.text("Waiting for participants…", p.width / 2, p.height / 2);
          return;
        }

        const parts = ids.map(id => participantsMap[id]).filter(Boolean);

        // ---------------------------------------------------
        // UPDATE POSITIONS + SIZE
        // ---------------------------------------------------
        for (const part of parts) {

          /// --- 1. SMOOTH PROXIMITY FOR SIZE ---
if (part._smoothProx == null) part._smoothProx = part.control.proximity;
part._smoothProx = part._smoothProx * 0.75 + part.control.proximity * 0.25;
const prox = clamp01(part._smoothProx);

// compute size
const base = Math.min(p.width, p.height) * 0.10;
const sizeMult = 0.8 + prox * 1.0;
const renderSize = base * sizeMult;
part._renderScale = renderSize;

// --- 2. APPLY SEPARATION FIRST (gentle) ---
applySeparation(part, parts, renderSize * 1.4);

// --- 3. APPLY GAZE CONTROL (this MUST be last) ---
const targetX = p.width * clamp01(part.control.gaze);
part.x += (targetX - part.x) * 0.25;

// keep vertical steady (you can add vertical tracking later)
part.y = p.constrain(part.y, renderSize * 1.2, p.height - renderSize * 1.2);

// --- 4. SCREEN CONSTRAINTS ---
const pad = Math.max(40, renderSize * 0.8);
part.x = p.constrain(part.x, pad, p.width - pad);

        }

        // ---------------------------------------------------
        // CREATE CONNECTIONS WHEN GLYPHS TOUCH
        // ---------------------------------------------------
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            const A = parts[i], B = parts[j];

            const dx = A.x - B.x;
            const dy = A.y - B.y;
            const d = Math.sqrt(dx * dx + dy * dy);

            const touchDist = A._renderScale * 1.0 + B._renderScale * 1.0;

            if (d < touchDist) {
              p._connections.push({
                x1: A.x, y1: A.y,
                x2: B.x, y2: B.y,
                alpha: 1.0
              });
            }
          }
        }

        // ---------------------------------------------------
        // DRAW CONNECTIONS (FADE OUT)
        // ---------------------------------------------------
        for (let i = p._connections.length - 1; i >= 0; i--) {
          const c = p._connections[i];

          p.stroke(40, 90, 70, c.alpha * 0.85);
          p.strokeWeight(Math.max(1, 2 * c.alpha));;
          p.line(c.x1, c.y1, c.x2, c.y2);

          c.alpha = Math.max(c.alpha - 0.01, 0.05);  // fade but never below 0.05

        }
        p.noStroke();

        // ---------------------------------------------------
        // DRAW ALL GLYPHS + NAME LABELS
        // ---------------------------------------------------
        for (const part of parts) {

          p.push();
          p.translate(part.x, part.y);

          // scale glyph to real size
          const engineBase = Math.min(p.width, p.height) * 0.42;
          const scaleFactor = part._renderScale / engineBase;
          p.scale(scaleFactor);

          try {
            if (global.glyphEngine && part.state) {
              global.glyphEngine.drawGlyph(p, part.state, { progress: 1, mode: "preview" });
            } else {
              p.fill(0, 0, 90, 0.06);
              p.circle(0, 0, 30);
            }
          } catch (e) {
            console.warn("[host] drawGlyph error", e);
            p.fill(0, 0, 90, 0.06);
            p.circle(0, 0, 30);
          }

          p.pop();

          // name label
          p.push();
          p.textAlign(p.CENTER, p.TOP);
          p.fill(0, 0, 98, 0.95);
          p.textSize(Math.max(12, part._renderScale * 0.12));
          const name = (part.pdata &&
                        (part.pdata.firstName || part.pdata.nativeName)) || "anon";
          p.text(name, part.x, part.y + part._renderScale * 0.55);
          p.pop();
        }
      };
    };

    return new p5(sketch, container);
  };

})(window);
