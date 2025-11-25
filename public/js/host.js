// host.js — host wall logic: fetch archive, listen to socket new-entry, spawn p5 tiles
(function () {
  const grid = document.getElementById("hostGrid");
  const refreshBtn = document.getElementById("refreshBtn");
  const maxInput = document.getElementById("maxTiles");

  // keep track of spawned tiles by participant id
  const tiles = new Map(); // id -> { el, p5Instance }

  // convenience q
  function qs(sel, parent) { return (parent || document).querySelector(sel); }

  // create a tile DOM + p5 renderer
  function createTile(entry) {
    const id = entry.id || (entry.id = `p-${Date.now().toString(36)}`);
    if (tiles.has(id)) return; // already shown

    // measure max tiles setting
    const maxTiles = parseInt(maxInput.value || "12", 10);

    // If we have more than max, optionally remove oldest
    if (tiles.size >= maxTiles) {
      // remove first inserted
      const firstKey = tiles.keys().next().value;
      removeTile(firstKey);
    }

    // DOM
    const tile = document.createElement("div");
    tile.className = "host-tile";
    tile.dataset.pid = id;

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "host-canvas-wrap";
    canvasWrap.id = `glyph-${id}`;

    const caption = document.createElement("div");
    caption.className = "host-caption";
    const firstName = (entry.data && (entry.data.firstName || entry.data.givenName)) || entry.data?.firstName || "—";
    caption.textContent = firstName;

    tile.appendChild(canvasWrap);
    tile.appendChild(caption);
    grid.prepend(tile); // newest first

    // compute metrics (use stored or compute)
    let metrics = entry.data && entry.data.metrics ? entry.data.metrics : null;
    try {
      if (!metrics && window.computeMetrics) {
        metrics = window.computeMetrics(entry.data || {}, entry.data ? entry.data.audio : null);
      }
    } catch (e) {
      console.warn("computeMetrics error", e);
    }

    // generate glyph engine state
    let state = null;
    try {
      if (window.glyphEngine && metrics) state = window.glyphEngine.generateGlyphState(metrics);
    } catch (e) {
      console.warn("glyphEngine.generateGlyphState failed", e);
    }

    // instantiate p5 for this tile
    const sketch = (p) => {
      let c;
      p.setup = () => {
        const w = canvasWrap.clientWidth || 180;
        const h = canvasWrap.clientHeight || w;
        c = p.createCanvas(w, h, p.WEBGL);
        c.parent(canvasWrap);
        p.colorMode(p.HSL);
        p.noStroke();
      };

      p.windowResized = () => {
        const w = canvasWrap.clientWidth || 180;
        const h = canvasWrap.clientHeight || w;
        p.resizeCanvas(w, h);
      };

      p.draw = () => {
        p.clear();
        // draw with glyphEngine; fallback to simple placeholder if state missing
        if (window.glyphEngine && state) {
          window.glyphEngine.drawGlyph(p, state, { progress: 1, mode: "preview" });
        } else {
          // placeholder
          p.push();
          p.fill(220, 10, 20, 0.06);
          p.textAlign(p.CENTER, p.CENTER);
          p.textSize(12);
          p.text("no glyph", p.width / 2, p.height / 2);
          p.pop();
        }
      };
    };

    const p5Inst = new p5(sketch, canvasWrap);

    // store
    tiles.set(id, { el: tile, p5: p5Inst, entry });

    // return element
    return tile;
  }

  function removeTile(id) {
    const rec = tiles.get(id);
    if (!rec) return;
    try {
      // remove p5 instance
      if (rec.p5 && typeof rec.p5.remove === "function") rec.p5.remove();
    } catch (e) { /* ignore */ }
    // remove DOM
    if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    tiles.delete(id);
  }

  // fetch current archive and render last N
  async function loadInitial() {
    try {
      const res = await fetch("/_archive/list");
      if (!res.ok) return console.warn("Could not fetch archive list", res.status);
      const arr = await res.json();
      // sort by timestamp (newest last) then take last N
      const max = parseInt(maxInput.value || "12", 10);
      arr.sort((a,b)=> new Date(a.timestamp) - new Date(b.timestamp));
      const last = arr.slice(Math.max(0, arr.length - max));
      // render in order (old -> new)
      last.forEach(e => createTile(e));
    } catch (e) {
      console.error("Failed to load initial archive", e);
    }
  }

  // listen for new entries via socket.io
  function setupSocket() {
    if (!window.io) {
      console.warn("socket.io client not found — real-time updates disabled");
      return;
    }
    const socket = io();

    socket.on("connect", () => {
      console.log("host: socket connected", socket.id);
    });

    socket.on("new-entry", (entry) => {
      try {
        // server sends full entry object; ensure it has data field
        if (!entry) return;
        // create tile for this new entry
        createTile(entry);
      } catch (e) {
        console.error("new-entry handler error", e);
      }
    });

    socket.on("live-update", (payload) => {
      // optional: live-update handling if you want to update a tile's state in real-time
      // payload expects { id, data, metrics, timestamp }
      try {
        const rec = tiles.get(payload.id);
        if (rec && payload.metrics) {
          const newState = window.glyphEngine.generateGlyphState(payload.metrics);
          // replace state by removing and re-creating tile (for simplicity) or update stored entry
          rec.entry.data = payload.data || rec.entry.data;
          // update p5 by replacing instance:
          removeTile(payload.id);
          createTile({ id: payload.id, data: payload.data, timestamp: payload.timestamp });
        }
      } catch (e) { console.warn("live-update handling", e); }
    });
  }

  // wire controls
  refreshBtn && refreshBtn.addEventListener("click", async () => {
    // clear existing tiles
    for (const k of Array.from(tiles.keys())) removeTile(k);
    await loadInitial();
  });

  maxInput && maxInput.addEventListener("change", () => {
    // trim if there are too many tiles
    const max = parseInt(maxInput.value || "12", 10);
    while (tiles.size > max) {
      const first = tiles.keys().next().value;
      removeTile(first);
    }
  });

  // start
  (async function init() {
    await loadInitial();
    setupSocket();
  })();

})();
