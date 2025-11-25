// public/js/modes/transitory.js
// Transitory Mode — glyph motion + distortion + merging + memory rings

(function (global) {
  window.startModeSketch = function (container, socket) {

    const participants = {}; 

    const MERGE_DIST = 70;              
    const MERGE_DURATION = 30000;       
    const COOLDOWN_MS = 6000;           
    const PUSH_APART = 40;              
    const CENTER_FORCE_RADIUS = 0.32;   
    const RIPPLE_FACTOR = 0.10;         
    const SPEED_BASE = 1.5;

    let mergeGroups = [];  

    // -----------------------------
    // FETCH PARTICIPANT + GLYPH DATA
    // -----------------------------
    async function fetchParticipant(pid) {
      try {
        const res = await fetch('/_archive/participant/' + encodeURIComponent(pid));
        if (!res.ok) throw new Error('not found');
        const j = await res.json();

        const pdata = j.data || j;
        let metrics = pdata.metrics || null;

        if (!metrics && global.computeMetrics) {
          try { metrics = computeMetrics(pdata, pdata.audio || null); }
          catch (e) { metrics = null; }
        }

        const finalMetrics = metrics || {
          seed: Math.floor(Math.random() * 9999999),
          basePolygonSides: 6,
          rings: 2,
          creases: 2,
          asymmetry: 0.25,
          nameLen: (pdata.firstName || "").length || 4,
          highlightClusters: 0.5,
          vowelRatio: 0.3,
          colorSeed: Math.floor(Math.random() * 360),
        };

        const state = glyphEngine.generateGlyphState(finalMetrics);

        return { pdata, metrics: finalMetrics, state };

      } catch (err) {
        console.warn("fetchParticipant error", err);
        return null;
      }
    }

    // ------------------------------------
    // ADD PARTICIPANT TO HOST VIEW
    // ------------------------------------
    async function addParticipant(pid) {
      if (participants[pid]) return;

      participants[pid] = {
        id: pid,
        pdata: null,
        metrics: null,
        state: null,
        x: container.clientWidth * (0.25 + Math.random() * 0.5),
        y: container.clientHeight * (0.25 + Math.random() * 0.5),
        vx: 0,
        vy: 0,
        distAmt: 0,
        control: { intensity: 0, rot: { alpha: 0, beta: 0, gamma: 0 } },
        mergeCount: 0,
        cooldownUntil: 0
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

    // ----------------------------
    // MERGE GROUP HELPERS
    // ----------------------------
    function currentlyInGroup(pid) {
      return mergeGroups.find(g => g.members.includes(pid));
    }

    function createMergeGroup(pair) {
      const now = Date.now();

      const g = {
        members: pair.slice(),
        createdAt: now,
        expiresAt: now + MERGE_DURATION
      };

      mergeGroups.push(g);
    }

    function dissolveMergeGroup(g) {
      // increment mergeCount + cooldown + push apart
      if (g.members.length === 2) {
        const [aId, bId] = g.members;
        const a = participants[aId];
        const b = participants[bId];

        if (a && b) {
          // mark memory
          a.mergeCount = (a.mergeCount || 0) + 1;
          b.mergeCount = (b.mergeCount || 0) + 1;

          // set cooldown
          const now = Date.now();
          a.cooldownUntil = now + COOLDOWN_MS;
          b.cooldownUntil = now + COOLDOWN_MS;

          // push apart
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx*dx + dy*dy) || 1;

          const ux = dx / d;
          const uy = dy / d;

          a.x -= ux * PUSH_APART;
          a.y -= uy * PUSH_APART;

          b.x += ux * PUSH_APART;
          b.y += uy * PUSH_APART;
        }
      }

      // remove merge group
      mergeGroups = mergeGroups.filter(m => m !== g);
    }

    // ---------------------
    // SOCKET LISTENERS
    // ---------------------
    socket.on("transitory:participant-joined", d => {
      if (d && d.participantId) addParticipant(d.participantId);
    });

    socket.on("transitory:participant-left", d => {
      if (d && d.participantId) removeParticipant(d.participantId);
    });

    socket.on("transitory:update", pkt => {
      const p = participants[pkt.participantId];
      if (!p) return;

      p.control.intensity = Math.min(1, (pkt.intensity || 0) / 6);
      p.control.rot = pkt.rot || p.control.rot;
      p.control.ts = pkt.ts || Date.now();
    });

    // -------------------------
    // DRAW GLYPH WITH DISTORTION + RINGS
    // -------------------------
    function drawDistortedGlyph(p, part) {
      if (!part.state) return;

      const cx = part.x;
      const cy = part.y;

      const dist = part.distAmt;

      const baseScale = Math.min(p.width, p.height) * 0.16;

      p.push();
      p.translate(cx, cy);

      // distortion near edges
      if (dist > 0.05) {
        p.scale(1 + dist * 1.2, 1 + dist * 0.3);
        p.rotate(dist * 0.8 * Math.sin(p.frameCount * 0.1));
      }

      p.scale(baseScale / 300);

      glyphEngine.drawGlyph(p, part.state, { mode: "host", progress: 1 });

      // --- MEMORY RINGS (mergeCount) ---
      if (part.mergeCount > 0) {
        const hue = part.metrics.colorSeed % 360;
        const count = part.mergeCount;
        const maxR = 40;
        const step = maxR / (count + 1);

        p.noFill();
        p.stroke(hue, 80, 60, 0.75);
        p.strokeWeight(2);

        for (let i = 1; i <= count; i++) {
          p.circle(0, 0, step * i);
        }
      }

      p.pop();
    }

    // -------------------------
    // P5 SKETCH
    // -------------------------
    const sketch = function (p) {

      p.setup = function () {
        const c = p.createCanvas(container.clientWidth, container.clientHeight);
        c.parent(container);
        p.colorMode(p.HSL);
        p.noStroke();
      };

      p.windowResized = function () {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      p.draw = function () {
        p.clear();
        p.background(210, 10, 6);

        const ids = Object.keys(participants);
        const now = Date.now();

        if (ids.length === 0) {
          p.fill(0, 0, 98, 0.15);
          p.textAlign(p.CENTER, p.CENTER);
          p.text("waiting for transitory participants…", p.width/2, p.height/2);
          return;
        }

        const cx = p.width / 2;
        const cy = p.height / 2;

        // -----------------------
        // RESOLVE MERGE GROUPS
        // -----------------------
        for (const g of [...mergeGroups]) {
          if (now >= g.expiresAt) {
            dissolveMergeGroup(g);
          }
        }

        // -----------------------
        // PROCESS PARTICIPANTS
        // -----------------------
        for (let pid of ids) {
          const part = participants[pid];

          // in merge group → freeze in place
          const mg = currentlyInGroup(pid);
          if (mg) {
            drawDistortedGlyph(p, part);

            // draw label
            p.push();
            p.fill(0, 0, 98);
            p.textSize(12);
            p.textAlign(p.CENTER, p.TOP);
            const label = (part.pdata && (part.pdata.firstName || part.pdata.nativeName)) || "anon";
            p.text(label, part.x, part.y + 40);
            p.pop();

            continue;
          }

          // MOVEMENT
          const f = part.control.intensity;
          const dx = part.control.rot.gamma * SPEED_BASE;
          const dy = -part.control.rot.beta * SPEED_BASE;

          // ripple
          let rippleX = 0, rippleY = 0;
          for (let other of ids) {
            if (other === pid) continue;
            const o = participants[other];
            rippleX += o.control.rot.gamma * o.control.intensity * RIPPLE_FACTOR;
            rippleY += -o.control.rot.beta * o.control.intensity * RIPPLE_FACTOR;
          }

          part.vx += dx * f * 1.6 + rippleX;
          part.vy += dy * f * 1.6 + rippleY;

          part.vx *= 0.93;
          part.vy *= 0.93;

          part.x += part.vx;
          part.y += part.vy;

          // bounce edges
          const margin = 30;
          if (part.x < margin || part.x > p.width - margin) part.vx *= -0.9;
          if (part.y < margin || part.y > p.height - margin) part.vy *= -0.9;

          part.x = Math.max(margin, Math.min(p.width - margin, part.x));
          part.y = Math.max(margin, Math.min(p.height - margin, part.y));

          // DISTORTION LEVEL
          const dxC = (part.x - cx) / p.width;
          const dyC = (part.y - cy) / p.height;
          const distNorm = Math.sqrt(dxC * dxC + dyC * dyC);
          part.distAmt = Math.max(0, (distNorm - CENTER_FORCE_RADIUS) * 2);

          // DRAW GLYPH
          drawDistortedGlyph(p, part);

          // LABEL
          p.push();
          p.fill(0, 0, 98, 0.95);
          p.textAlign(p.CENTER, p.TOP);
          p.textSize(12);
          const label = (part.pdata && (part.pdata.firstName || part.pdata.nativeName)) || "anon";
          p.text(label, part.x, part.y + 40);
          p.pop();
        }

        // -----------------------------
        // CHECK FOR NEW MERGES
        // -----------------------------
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const aId = ids[i];
            const bId = ids[j];
            const a = participants[aId];
            const b = participants[bId];

            if (!a || !b) continue;

            const now = Date.now();
            if (now < a.cooldownUntil || now < b.cooldownUntil) continue;

            if (currentlyInGroup(aId) || currentlyInGroup(bId)) continue;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.sqrt(dx*dx + dy*dy);

            if (d <= MERGE_DIST) {
              createMergeGroup([aId, bId]);
            }
          }
        }
      };
    };

    return new p5(sketch, container);
  };
})(window);
