// public/js/modes/misaligned.js
// Host-side Misaligned Mode — "Zones of Legibility"
// - Listens to misaligned:join / misaligned:leave / misaligned:update
// - Swipes on controller push glyphs (vx, vy). When glyph enters a zone it conforms
//   to that zone's shape. Original glyph ghost remains and fades (Q3: C).

(function(global) {
  window.startModeSketch = function(container, socket) {
    const participants = {}; // pid -> { pdata, metrics, state, x,y,vx,vy,ghostAlpha,zone,mergedAt }

    // zone definitions — 6 columns across the width
    // mapping: shapeName -> override sides / properties
    const ZONES = [
      { name: 'Welfare', shape: 'square', sides: 4, colorShift: -10 },
      { name: 'Banking', shape: 'hexagon', sides: 6, colorShift: 0 },
      { name: 'Healthcare', shape: 'circle', sides: 20, colorShift: 20 },
      { name: 'Labor', shape: 'octagon', sides: 8, colorShift: 40 },
      { name: 'Immigration', shape: 'rect', sides: 4, colorShift: 80, stretch: 1.6 },
      { name: 'Telecom', shape: 'triangle', sides: 3, colorShift: 200 }
    ];

    // fetch participant archive + generate glyph state
    async function fetchParticipant(pid) {
      try {
        const res = await fetch('/_archive/participant/' + encodeURIComponent(pid));
        if (!res.ok) throw new Error('not found');
        const j = await res.json();
        const pdata = j.data || j;
        let metrics = pdata.metrics || null;
        if (!metrics && global.computeMetrics) {
          try { metrics = computeMetrics(pdata, pdata.audio || null); } catch(e) { metrics = null; }
        }
        const finalMetrics = metrics || {
          seed: Math.floor(Math.random()*1e9),
          basePolygonSides: 6,
          rings: 2,
          creases: 2,
          asymmetry: 0.2,
          nameLen: (pdata.firstName||'').length || 5,
          vowelRatio: 0.3,
          highlightClusters: 0.4,
          colorSeed: Math.floor(Math.random()*360)
        };
        const state = (global.glyphEngine && typeof global.glyphEngine.generateGlyphState === 'function')
          ? global.glyphEngine.generateGlyphState(finalMetrics) : null;
        return { pdata, metrics: finalMetrics, state };
      } catch(err) {
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
        x: container.clientWidth * (0.2 + Math.random()*0.6),
        y: container.clientHeight * (0.3 + Math.random()*0.4),
        vx: 0, vy: 0,
        ghostAlpha: 0.0,    // ghost alpha (original glyph ghost)
        zone: null,         // current zone index or null
        lastUpdateTs: Date.now()
      };

      const fetched = await fetchParticipant(pid);
      if (fetched) {
        participants[pid].pdata = fetched.pdata;
        participants[pid].metrics = fetched.metrics;
        participants[pid].state = fetched.state;
        participants[pid].ghostAlpha = 0.0;
      }
    }

    function removeParticipant(pid) {
      delete participants[pid];
    }

    // socket listeners
    socket.on('misaligned:participant-joined', (d) => {
      if (d && d.participantId) addParticipant(d.participantId);
    });
    socket.on('misaligned:participant-left', (d) => {
      if (d && d.participantId) removeParticipant(d.participantId);
    });

    // updates contain vx, vy (normalized), or occasional position hints
    socket.on('misaligned:update', (pkt) => {
      if (!pkt || !pkt.participantId) return;
      const p = participants[pkt.participantId];
      if (!p) return;
      // small impulse
      if (typeof pkt.vx === 'number') p.vx += pkt.vx * Math.min(6, (Math.abs(pkt.vx)+1));
      if (typeof pkt.vy === 'number') p.vy += pkt.vy * Math.min(6, (Math.abs(pkt.vy)+1));
      p.lastUpdateTs = pkt.ts || Date.now();
      // optional direct pos hints
      if (typeof pkt.x === 'number') p.x = pkt.x;
      if (typeof pkt.y === 'number') p.y = pkt.y;
    });

    // helper: determine zone index from x coordinate
    function zoneForX(x, width) {
      const cols = ZONES.length;
      const w = width / cols;
      const idx = Math.floor(Math.max(0, Math.min(cols-1, x / w)));
      return idx;
    }

    // returns an override state based on zone (keeps other state fields)
    function stateForZone(origState, zone) {
      if (!origState) return origState;
      // shallow clone
      const s = JSON.parse(JSON.stringify(origState));
      s.sides = zone.sides || s.sides;
      // reduce complexity for legibility in systems
      s.ringCount = Math.max(0, Math.min(2, s.ringCount || 1));
      s.creaseCount = Math.max(1, Math.min(3, s.creaseCount || 2));
      // small color shift
      if (s.palette && typeof zone.colorShift === 'number') {
        s.palette = s.palette || {};
        s.palette.ring = s.palette.ring || { h: 200, s: 30, l: 14 };
        s.palette.accent = s.palette.accent || { h: 40, s: 90, l: 55 };
        s.palette.ring.h = (s.palette.ring.h + zone.colorShift) % 360;
      }
      // mark a special stretch flag for rect-like zones
      s._zoneStretch = zone.stretch || 1;
      return s;
    }

    // p5 sketch
    const sketch = function(p) {
      p.setup = function() {
        const c = p.createCanvas(container.clientWidth, container.clientHeight);
        c.parent(container);
        p.colorMode(p.HSL);
        p.noStroke();
        p.textFont("ui-monospace, Menlo, Monaco");
      };

      p.windowResized = function() {
        p.resizeCanvas(container.clientWidth, container.clientHeight);
      };

      function drawGhost(part) {
        if (!part.state) return;
        if (part.ghostAlpha <= 0) return;
        p.push();
        p.translate(part.x, part.y);
        const baseScale = (Math.min(p.width, p.height) * 0.14) / 300;
        p.scale(baseScale);
        p.fill(0,0,100, part.ghostAlpha * 0.12);
        try {
          // draw original glyph faint (progress slightly lower)
          global.glyphEngine.drawGlyph(p, part.state, { mode: 'host', progress: 0.9 });
        } catch(e) {
          p.fill(0,0,96, part.ghostAlpha * 0.12);
          p.circle(0,0, 18);
        }
        p.pop();
      }

      // draw transformed glyph according to zone; new shape on top
      function drawTransformed(part, zoneIdx) {
        if (!part.state) return;
        const zone = ZONES[zoneIdx];
        if (!zone) return;

        // override state for zone
        const override = stateForZone(part.state, zone);
        // scale and stretch
        const baseScale = Math.min(p.width, p.height) * 0.12;
        p.push();
        p.translate(part.x, part.y);
        // apply rectangular stretch if zone needs it
        if (override._zoneStretch && override._zoneStretch !== 1) {
          p.scale(override._zoneStretch, 1);
        }
        // scale to pixel coords expected by glyphEngine
        p.scale(baseScale / 300);

        // draw transformed glyph (progress = 1)
        try {
          global.glyphEngine.drawGlyph(p, override, { mode: 'host', progress: 1 });
        } catch(e) {
          // fallback marker
          p.fill(0,0,95,0.16);
          p.circle(0,0, 24);
        }
        p.pop();
      }

      function drawZoneGuides() {
        const cols = ZONES.length;
        const w = p.width / cols;
        p.push();
        for (let i=0;i<cols;i++) {
          const theme = ZONES[i];
          p.fill(0,0,12,0.02);
          p.noStroke();
          p.rect(i*w, 0, w, p.height);
          // thin vertical separators
          p.stroke(0,0,96,0.04);
          p.strokeWeight(1);
          p.line(i*w, 0, i*w, p.height);
          // zone labels top-left
          p.noStroke();
          p.fill(0,0,96,0.06);
          p.textSize(11);
          p.textAlign(p.LEFT, p.TOP);
          p.text(`${i+1}. ${theme.name}`, i*w + 8, 8);
        }
        p.pop();
      }

      p.draw = function() {
        p.clear();
        p.background(210, 10, 6);

        const ids = Object.keys(participants);
        if (ids.length === 0) {
          p.push();
          p.fill(0,0,96,0.06);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(14);
          p.text('Waiting for participants to join Misaligned Mode...', p.width/2, p.height/2);
          p.pop();
          return;
        }

        // zone guides behind everything
        drawZoneGuides();

        // physics update
        for (const id of ids) {
          const part = participants[id];
          // basic friction & integrate
          part.vx *= 0.94;
          part.vy *= 0.94;
          part.x += part.vx * Math.min(8, (p.deltaTime||16)/16);
          part.y += part.vy * Math.min(8, (p.deltaTime||16)/16);

          // keep bounds
          const margin = 28;
          part.x = Math.max(margin, Math.min(p.width - margin, part.x));
          part.y = Math.max(margin, Math.min(p.height - margin, part.y));

          // determine zone
          const zIdx = zoneForX(part.x, p.width);
          if (part.zone !== zIdx) {
            // entering new zone: create ghost of previous (fade-in) and set ghostAlpha -> 1
            part.ghostAlpha = 1.0;
            part.zone = zIdx;
            part.zoneEnteredAt = Date.now();
          } else {
            // ghost fade: when staying in zone ghost decays gradually
            part.ghostAlpha = Math.max(0, part.ghostAlpha - 0.006);
          }
        }

        // draw each participant: ghost (original) then transformed glyph
        for (const id of ids) {
          const part = participants[id];
          // ghost original (faint)
          drawGhost(part);
        }

        for (const id of ids) {
          const part = participants[id];
          const zIdx = Math.max(0, Math.min(ZONES.length-1, (part.zone == null ? zoneForX(part.x,p.width) : part.zone)));
          // transformed draw
          drawTransformed(part, zIdx);

          // label
          p.push();
          p.fill(0,0,98,0.95);
          p.textAlign(p.CENTER, p.TOP);
          p.textSize(12);
          const label = (part.pdata && (part.pdata.firstName || part.pdata.nativeName)) || 'anon';
          p.text(label, part.x, part.y + Math.min(52, Math.max(36, Math.min(p.width,p.height)*0.08)));
          p.pop();
        }
      };
    };

    return new p5(sketch, container);
  };
})(window);
