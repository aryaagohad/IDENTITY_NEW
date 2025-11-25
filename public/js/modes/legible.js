// public/js/modes/legible.js
// Mode 06 – System-Legibility / Opacity Mode
// After 20s, system begins randomly altering visibility, clarity,
// stroke weight, scale, blur, and presence of each glyph.
// Users have zero control. UI on phone is fake.

(function (global) {
  window.startModeSketch = function (container, socket) {

    const participants = {}; 
    // pid -> { pdata, metrics, state, x, y, systemState, nextStateAt, birth, opacity, glitch, scale, blur }

    // ---- fetch glyph + data ----
    async function fetchParticipant(pid) {
      try {
        const res = await fetch(
          "/_archive/participant/" + encodeURIComponent(pid)
        );
        if (!res.ok) throw new Error("fetch failed");
        const j = await res.json();

        const pdata = j.data || j;
        let metrics = pdata.metrics || null;

        if (!metrics && global.computeMetrics) {
          try {
            metrics = computeMetrics(pdata, pdata.audio || null);
          } catch (e) {
            metrics = null;
          }
        }

        const finalMetrics = metrics || {
          seed: Math.floor(Math.random() * 999999),
          basePolygonSides: 6,
          rings: 2,
          creases: 2,
          asymmetry: 0.2,
          nameLen: (pdata.firstName || "").length || 4,
          vowelRatio: 0.32,
          highlightClusters: 0.4,
          colorSeed: Math.floor(Math.random() * 360)
        };

        const state =
          global.glyphEngine &&
          global.glyphEngine.generateGlyphState
            ? global.glyphEngine.generateGlyphState(finalMetrics)
            : null;

        return { pdata, metrics: finalMetrics, state };
      } catch (err) {
        console.warn("legible fetchParticipant error", err);
        return null;
      }
    }

    // ---- participant joins ----
    async function addParticipant(pid) {
      if (participants[pid]) return;

      const now = Date.now();

      participants[pid] = {
        id: pid,
        pdata: null,
        metrics: null,
        state: null,
        x: container.clientWidth * (0.25 + Math.random() * 0.5),
        y: container.clientHeight * (0.3 + Math.random() * 0.4),
        birth: now,
        systemState: "normal",
        nextStateAt: now + 20000, // 20s until system takes over
        opacity: 1,
        glitch: 0,
        scale: 1,
        blur: 0
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

    // ---- socket events ----
    socket.on("legible:participant-joined", (d) => {
      if (d && d.participantId) addParticipant(d.participantId);
    });

    socket.on("legible:participant-left", (d) => {
      if (d && d.participantId) removeParticipant(d.participantId);
    });

    // ---- RANDOM SYSTEM EFFECT LOGIC ----

    const EFFECTS = [
      "normal",
      "fade-out",
      "fade-in",
      "glitch",
      "blur",
      "oversharp",
      "vanish",
      "reappear",
      "shrink",
      "inflate",
      "washout",
      "stroke-flash"
    ];

    function chooseEffect() {
      return EFFECTS[Math.floor(Math.random() * EFFECTS.length)];
    }

    function applyState(part, stateName) {
      switch (stateName) {

        case "fade-out":
          part.opacity = Math.max(0, part.opacity - 0.02);
          break;

        case "fade-in":
          part.opacity = Math.min(1, part.opacity + 0.02);
          break;

        case "vanish":
          part.opacity = 0;
          break;

        case "reappear":
          part.opacity = 1;
          break;

        case "glitch":
          part.glitch = Math.random() * 6;
          break;

        case "blur":
          part.blur = Math.min(8, part.blur + 0.3);
          break;

        case "oversharp":
          part.blur = Math.max(0, part.blur - 0.4); 
          break;

        case "shrink":
          part.scale = Math.max(0.4, part.scale - 0.01);
          break;

        case "inflate":
          part.scale = Math.min(1.8, part.scale + 0.01);
          break;

        case "washout":
          part.opacity = Math.max(0.1, part.opacity - 0.01);
          part.blur = Math.min(5, part.blur + 0.05);
          break;

        case "stroke-flash":
          part.glitch = (Math.sin(Date.now() * 0.03) > 0) ? 4 : 0;
          break;

        case "normal":
        default:
          // gentle reset drift
          part.glitch *= 0.9;
          part.blur *= 0.95;
          part.scale += (1 - part.scale) * 0.03;
          part.opacity += (1 - part.opacity) * 0.02;
      }
    }

    // ---- p5 sketch ----
    const sketch = function (p) {
      p.setup = function () {
        const c = p.createCanvas(
          container.clientWidth,
          container.clientHeight
        );
        c.parent(container);
        p.colorMode(p.HSL);
        p.noStroke();
        p.textFont("ui-monospace, Menlo, Monaco");
      };

      p.windowResized = function () {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      p.draw = function () {
        p.clear();
        p.background(210, 10, 6);

        const now = Date.now();
        const ids = Object.keys(participants);

        if (ids.length === 0) {
          p.push();
          p.fill(0, 0, 96, 0.08);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(14);
          p.text("Waiting for participants…", p.width/2, p.height/2);
          p.pop();
          return;
        }

        // Update system effects
        const sync = Math.random() < 0.1; 
        let multicastEffect = null;
        if (sync) multicastEffect = chooseEffect();

        for (const pid of ids) {
          const part = participants[pid];

          // Time to switch effect?
          if (now >= part.nextStateAt) {
            part.systemState = sync ? multicastEffect : chooseEffect();
            part.nextStateAt = now + (5000 + Math.random() * 7000); // 5–12s
          }

          applyState(part, part.systemState);

          // ---- DRAW ----
          if (!part.state) continue;

          p.push();
          p.translate(part.x + part.glitch, part.y + part.glitch);

          // temporary blur effect
          if (part.blur > 0.5) {
            p.drawingContext.filter = `blur(${part.blur}px)`;
          }

          const baseScale = ((Math.min(p.width, p.height) * 0.15) / 300) * part.scale;
          p.scale(baseScale);

          p.push();
          p.globalAlpha = part.opacity;

          try {
            global.glyphEngine.drawGlyph(p, part.state, {
              mode: "host",
              progress: 1
            });
          } catch (err) {
            p.fill(0, 0, 96, 0.2);
            p.circle(0, 0, 20);
          }

          p.pop();

          // reset filter
          p.drawingContext.filter = "none";
          p.pop();

          // label
          p.push();
          p.fill(0, 0, 98, 0.95 * part.opacity);
          p.textAlign(p.CENTER, p.TOP);
          p.textSize(12);
          const label =
            (part.pdata &&
              (part.pdata.firstName || part.pdata.nativeName)) ||
            "anon";
          p.text(label, part.x, part.y + 50);
          p.pop();
        }
      };
    };

    return new p5(sketch, container);
  };
})(window);
