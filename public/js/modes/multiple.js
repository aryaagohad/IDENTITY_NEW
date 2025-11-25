// public/js/modes/multiple.js
// Host-side Multiple Mode — grid layout, roles branches + branch-to-branch connections
// Design reference image (uploaded): /mnt/data/75f870c1-c5e0-4912-8bd6-4bc560dc40ff.jpg

(function(global) {
  window.startModeSketch = function(container, socket) {
    const participants = {}; // pid -> { pdata, metrics, state, x,y, w,h, roles:[], joinedAt }
    const connectionsRemnants = {}; // roleKey -> { createdAt, intensity, rings } (visual remnant data)

    // CONFIG (tweak here)
    const GRID_PADDING = 0.06;           // fraction of cell reserved as padding (0..0.3)
    const BRANCH_LENGTH_RATIO = 0.32;    // fraction of min(cellW,cellH) used for branch length
    const GLYPH_CELL_SCALE = 0.08;       // glyph scale relative to min(canvas) before glyphEngine scaling factor
    const MAX_ROLE_TEXT_WIDTH = 140;     // px clamp for role label wrapping (best-effort)
    const REMNANT_RING_FADE_MS = 25000;  // how long the remnant rings linger (ms)
    const CONNECTION_ALPHA_BASE = 0.9;   // line alpha when newly created
    const MAX_PARTICIPANTS_TO_SHOW_CLEAR = 12; // just informational

    // --- Helpers ----
    function roleKeyFor(role) {
      return (role || '').trim().toLowerCase();
    }

    // fetch participant archive + glyph state (same pattern used elsewhere)
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
      } catch (err) {
        console.warn('fetchParticipant error', err);
        return null;
      }
    }

    // Layout: compute grid rows/cols based on N, and assign each participant a cell center and cell size.
    function layoutParticipants() {
      const ids = Object.keys(participants);
      const N = ids.length;
      if (N === 0) return;

      // compute rows/cols to fill screen as squarely as possible
      const rows = Math.ceil(Math.sqrt(N));
      const cols = Math.ceil(N / rows);

      const cw = container.clientWidth;
      const ch = container.clientHeight;

      const cellW = cw / cols;
      const cellH = ch / rows;

      // assign positions based on stable order (joinedAt)
      ids.sort((a,b) => (participants[a].joinedAt || 0) - (participants[b].joinedAt || 0));

      ids.forEach((pid, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const cx = (c * cellW) + cellW * 0.5;
        const cy = (r * cellH) + cellH * 0.5;

        // store cell geometry on participant
        const p = participants[pid];
        p.cell = { row: r, col: c, cellW, cellH, cx, cy };
        // compute drawable bounds inside cell (respect padding)
        const padX = cellW * GRID_PADDING;
        const padY = cellH * GRID_PADDING;
        p.x = cx;
        p.y = cy;
        p.w = Math.max(48, cellW - padX*2);
        p.h = Math.max(48, cellH - padY*2);
      });
    }

    // add participant + fetch data, then layout
    async function addParticipant(pid) {
      if (!pid || participants[pid]) return;
      participants[pid] = {
        id: pid,
        pdata: null,
        metrics: null,
        state: null,
        roles: [],
        joinedAt: Date.now(),
        x: 0, y: 0, w: 0, h: 0, cell: null
      };
      const fetched = await fetchParticipant(pid);
      if (fetched) {
        participants[pid].pdata = fetched.pdata;
        participants[pid].metrics = fetched.metrics;
        participants[pid].state = fetched.state;
      }
      layoutParticipants();
    }

    function removeParticipant(pid) {
      if (!participants[pid]) return;
      // clean any role references for remnant visuals (we keep remnants separately)
      delete participants[pid];
      layoutParticipants();
    }

    // When controller sends add-role: update participant.roles and record connection remnant info
    socket.on('multiple:add-role', async (pkt) => {
      if (!pkt || !pkt.participantId || !pkt.role) return;
      const pid = pkt.participantId;
      const role = (pkt.role || '').trim();
      if (!role) return;

      if (!participants[pid]) {
        await addParticipant(pid);
      }
      const p = participants[pid];
      if (!p) return;

      // avoid duplicates (case-insensitive)
      const key = roleKeyFor(role);
      if (!p.roles.find(r => roleKeyFor(r) === key)) {
        p.roles.push(role);
        p.lastRoleAt = Date.now();

        // create or bump a remnant connection visual for this role
        connectionsRemnants[key] = connectionsRemnants[key] || { createdAt: Date.now(), intensity: 1.0, rings: 0 };
        connectionsRemnants[key].createdAt = Date.now();
        connectionsRemnants[key].intensity = Math.min(1, (connectionsRemnants[key].intensity || 0) + 0.35);
        connectionsRemnants[key].rings = (connectionsRemnants[key].rings || 0) + 1;
      }
    });

    // join / leave events
    socket.on('multiple:participant-joined', (d) => { if (d && d.participantId) addParticipant(d.participantId); });
    socket.on('multiple:participant-left', (d) => { if (d && d.participantId) removeParticipant(d.participantId); });

    // respond to any container size change (re-layout)
    window.addEventListener('resize', () => layoutParticipants());

    // --- p5 sketch
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
        layoutParticipants();
      };

      // draw actual exact glyph centered at (x,y) scaled to fit cell
      function drawParticipantGlyph(part) {
        if (!part.state) return;
        const minDim = Math.min(part.w, part.h);
        // glyphEngine expects center at origin; scale so glyph fits visually
        const glyphScale = (minDim * GLYPH_CELL_SCALE) / 300; // 300 approx glyph logical size
        p.push();
        p.translate(part.x, part.y);
        p.scale(glyphScale);
        try {
          global.glyphEngine.drawGlyph(p, part.state, { mode: 'host', progress: 1 });
        } catch (e) {
          // fallback
          p.fill(0,0,95,0.12);
          p.circle(0,0, Math.min(36, minDim*0.18));
        }
        p.pop();
      }

      // compute branch node positions for a participant (returns array of { x,y, role, roleKey })
      function computeRoleNodesFor(part) {
        const out = [];
        const roles = part.roles || [];
        if (!roles.length) return out;
        const minDim = Math.min(part.w, part.h);
        const branchLen = Math.max(18, minDim * BRANCH_LENGTH_RATIO);
        for (let i = 0; i < roles.length; i++) {
          const role = roles[i];
          const rk = roleKeyFor(role);
          // evenly space roles around 360 degrees but keep them visually readable (start at -90deg)
          const ang = (Math.PI * 2 * i) / roles.length - Math.PI/2;
          const rx = part.x + Math.cos(ang) * branchLen;
          const ry = part.y + Math.sin(ang) * branchLen;
          out.push({ x: rx, y: ry, role, roleKey: rk, ang, idx: i });
        }
        return out;
      }

      // draw branches for one participant (and collect nodes into a map)
      function drawRoleBranches(part, nodeMap) {
        const nodes = computeRoleNodesFor(part);
        if (!nodes.length) return;
        const hue = (part.metrics && part.metrics.colorSeed) ? (part.metrics.colorSeed % 360) : 210;

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];

          // draw branch line
          p.push();
          p.strokeWeight(1.2);
          p.stroke(hue, 62, 60, 0.95);
          p.line(part.x, part.y, n.x, n.y);
          p.pop();

          // node (TE-style rounded rect)
          p.push();
          p.translate(n.x, n.y);
          p.noStroke();
          p.fill(hue, 62, 60, 0.98);
          p.rectMode(p.CENTER);
          p.rotate(-0.01 + Math.sin((i * 73) + p.frameCount * 0.01) * 0.02);
          p.rect(0, 0, 20, 10, 6);
          p.pop();

          // add to nodeMap for connections (grouped by roleKey)
          nodeMap[n.roleKey] = nodeMap[n.roleKey] || [];
          nodeMap[n.roleKey].push({ x: n.x, y: n.y, pid: part.id, role: n.role });
          
          // role label (tiny)
          p.push();
          p.fill(0,0,98,0.96);
          p.textSize(10);
          p.textAlign(p.LEFT, p.CENTER);
          const tx = n.x + 12 * Math.cos(n.ang);
          const ty = n.y + 12 * Math.sin(n.ang);
          p.text(n.role, tx, ty);
          p.pop();
        }
      }

      // draw role-to-role connections (connecting node positions for same roleKey)
      function drawConnections(nodeMap) {
        for (const rk of Object.keys(nodeMap)) {
          const nodes = nodeMap[rk];
          if (!nodes || nodes.length < 2) {
            // if only one node but remnant exists, draw a faint marker
            if (nodes && nodes.length === 1 && connectionsRemnants[rk]) {
              const rinfo = connectionsRemnants[rk];
              const n = nodes[0];
              p.push();
              p.noFill();
              p.strokeWeight(1);
              const a = Math.max(0, Math.min(1, 1 - ((Date.now() - rinfo.createdAt) / REMNANT_RING_FADE_MS)));
              p.stroke(200, 40, 60, 0.06 * a);
              p.circle(n.x + 12, n.y + 6, 8 + (rinfo.rings || 0) * 6);
              p.pop();
            }
            continue;
          }

          // pairwise connect node positions (or draw minimal spanning like a star) - we'll draw pairwise lines but keep them thin
          for (let i = 0; i < nodes.length; i++) {
            for (let j = i+1; j < nodes.length; j++) {
              const a = nodes[i], b = nodes[j];
              p.push();
              p.strokeWeight(1.2);
              // alpha fades based on remnant; if recently created keep strong
              let alpha = 0.18;
              if (connectionsRemnants[rk]) {
                const rinfo = connectionsRemnants[rk];
                const age = Date.now() - rinfo.createdAt;
                const lifeFrac = Math.max(0, Math.min(1, 1 - age/REMNANT_RING_FADE_MS));
                alpha = 0.06 + (CONNECTION_ALPHA_BASE * lifeFrac * rinfo.intensity);
              } else {
                alpha = 0.18;
              }
              // draw subtle bright-ish line
              p.stroke(0,0,100, alpha);
              p.line(a.x, a.y, b.x, b.y);
              p.pop();

              // midpoint tiny ring / remnant indicator
              const mx = (a.x + b.x)/2;
              const my = (a.y + b.y)/2;
              p.push();
              p.noFill();
              p.strokeWeight(1.0);
              const hue = (participants[a.pid] && participants[a.pid].metrics) ? (participants[a.pid].metrics.colorSeed % 360) : 200;
              p.stroke(hue, 50, 60, 0.06 + 0.5 * (connectionsRemnants[rk] ? (connectionsRemnants[rk].intensity || 0.2) : 0.12));
              // size of ring influenced by number of times this connection appeared (rings)
              const ringCount = (connectionsRemnants[rk] && connectionsRemnants[rk].rings) ? Math.min(6, connectionsRemnants[rk].rings) : 1;
              p.circle(mx, my, 6 + ringCount*3 + Math.sin(p.frameCount * 0.02)*1.2);
              p.pop();
            }
          }
        }
      }

      // decay remnants over time (reduce intensity and rings)
      function decayRemnants() {
        const now = Date.now();
        for (const rk of Object.keys(connectionsRemnants)) {
          const info = connectionsRemnants[rk];
          const age = now - info.createdAt;
          if (age > REMNANT_RING_FADE_MS * 1.5) {
            delete connectionsRemnants[rk];
          } else {
            // gently decay intensity
            info.intensity = Math.max(0.05, info.intensity * 0.995);
          }
        }
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
          p.text('Waiting for participants to join Multiple Mode...', p.width/2, p.height/2);
          p.pop();
          return;
        }

        // ensure layout up-to-date (in case of joins/leaves)
        layoutParticipants();

        // Build nodeMap by iterating participants first (so we can draw connections beneath glyphs or above as needed)
        const nodeMap = {}; // roleKey -> [ {x,y,pid,role} ]

        // Draw connections first (thin lines). For that we need node positions, so compute nodes first (without drawing branches)
        // We'll compute nodes by gathering computeRoleNodesFor for each participant
        for (const pid of ids) {
          const part = participants[pid];
          const nodes = computeRoleNodesFor(part);
          nodes.forEach(n => {
            nodeMap[n.roleKey] = nodeMap[n.roleKey] || [];
            nodeMap[n.roleKey].push({ x: n.x, y: n.y, pid: pid, role: n.role });
          });
        }

        // draw connections (lines between branch nodes)
        drawConnections(nodeMap);

        // Draw glyphs and branches on top of connection lines
        for (const pid of ids) {
          const part = participants[pid];
          // glyph
          drawParticipantGlyph(part);
          // branches (and nodes), will also populate nodeMap (but we already built nodeMap earlier for connections)
          drawRoleBranches(part, nodeMap);

          // name label
          p.push();
          p.fill(0,0,98,0.95);
          p.textAlign(p.CENTER, p.TOP);
          p.textSize(11);
          const label = (part.pdata && (part.pdata.firstName || part.pdata.nativeName)) || 'anon';
          p.text(label, part.x, part.y + Math.min(44, Math.max(28, Math.min(p.width,p.height)*0.06)));
          p.pop();
        }

        // remnants decay
        decayRemnants();
      };
    };

    return new p5(sketch, container);
  };
})(window);
