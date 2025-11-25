// server.js — express + socket.io + archive + live mirror cache
// Usage: node server.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");

const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  // CORS here if you test via ngrok / across hosts
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

// Middleware + Static
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ensure data file exists
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");

// live cache for quick host fetch: { id: { id, data, metrics, timestamp } }
let liveCache = {};

// -------------------------
// SAVE ENTRY (registration)
// -------------------------
app.post("/save", (req, res) => {
  try {
    const all = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
    const body = req.body || {};

    // make a reasonable slug from name (fallback to p-<ts36>)
    const slugBase =
      (((body.firstName || "") + "-" + (body.familyName || "")).toLowerCase()
        .replace(/[^a-z0-9\-]+/g, "-")
        .replace(/\-+/g, "-")
        .replace(/^\-|\-$/g, "")) || `p-${Date.now().toString(36)}`;

    const id = `${slugBase}-${Date.now().toString(36)}`;

    const entry = {
      id,
      timestamp: new Date().toISOString(),
      data: body
    };

    all.push(entry);
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), "utf8");

    // broadcast new entry to hosts (host UI can listen)
    io.emit("new-entry", entry);

    // also store liveCache snapshot so host can fetch immediately
    liveCache[id] = { id, data: body, metrics: body.metrics || null, timestamp: Date.now() };

    res.json({ success: true, id });
  } catch (err) {
    console.error("Save error", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// -------------------------
// ARCHIVE ROUTES
// -------------------------
app.get("/_archive/participant/:id", (req, res) => {
  try {
    const id = req.params.id;
    const all = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
    const match = all.find(e => e.id === id);
    if (!match) return res.status(404).json({ error: "Not found" });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/_archive/list", (req, res) => {
  try {
    const all = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------
// LIVE UPDATE ROUTES
// -------------------------
app.post("/liveUpdate", (req, res) => {
  try {
    const { id, data, metrics } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: "Missing id" });

    liveCache[id] = {
      id,
      data: data || {},
      metrics: metrics || null,
      timestamp: Date.now()
    };

    // notify hosts in real-time
    io.emit("live-update", liveCache[id]);
    res.json({ success: true });
  } catch (err) {
    console.error("liveUpdate error:", err);
    res.status(500).json({ success: false });
  }
});

app.get("/live/:id", (req, res) => {
  const id = req.params.id;
  if (!liveCache[id]) return res.status(404).json({ error: "No live data yet" });
  res.json(liveCache[id]);
});

// DEBUG: log any request that touches /socket.io
app.use((req, res, next) => {
  if (req.url && req.url.startsWith('/socket.io')) {
    console.log('[HTTP] incoming socket path request ->', req.method, req.url, 'host:', req.headers.host);
  }
  next();
});


// -------------------------
// SOCKET.IO — CORE + MODES
// -------------------------
let activeMode = null; // currently selected mode (broadcast to hosts)
let participants = {}; // socketId → { id, name, metrics }

io.on("connection", (socket) => {
  console.log("[socket] connected:", socket.id);

  // Participant registers after /save
  socket.on("register-participant", (pdata) => {
    participants[socket.id] = {
      id: pdata.id,
      name: pdata.name,
      metrics: pdata.metrics || null
    };
    console.log("[register] participant:", pdata);
  });

  // -------------------------
  // MODES: user selects a mode from modes.html (controller)
  // Broadcast to host(s)
  // -------------------------
  socket.on("change-mode", (modeName) => {
    try {
      console.log("[mode] active:", modeName);
      activeMode = modeName;
      io.emit("active-mode", modeName);
    } catch (e) {
      console.error("change-mode error", e);
    }
  });

  socket.on("request-current-mode", () => {
    socket.emit("active-mode", activeMode || "none");
  });

  // -------------------------
  // GENERIC CONTROL UPDATES (controllers -> host)
  // -------------------------
  socket.on("control-update", (packet) => {
    if (!packet) return;
    packet.socketId = socket.id;
    io.emit("control-update", packet);
  });

  // -------------------------
  // RELATIONAL MODE SPECIFIC
  // (join / leave / update)
  // -------------------------
  socket.on("relational:join", (data) => {
    const pid = data && data.participantId;
    if (!pid) return;
    console.log("[relational] join:", pid);
    io.emit("relational:participant-joined", { participantId: pid });
  });

  socket.on("relational:leave", (data) => {
    const pid = data && data.participantId;
    if (!pid) return;
    console.log("[relational] leave:", pid);
    io.emit("relational:participant-left", { participantId: pid });
  });

  // preferred new API for updates
  socket.on("relational:update", (packet) => {
    if (!packet || !packet.participantId) return;
    packet.ts = Date.now();
    io.emit("relational:update", packet);
  });

  // backward compatibility with older controllers that used "relational:gaze"
  socket.on("relational:gaze", (pkt) => {
    if (!pkt || !pkt.participantId) return;

    const packet = {
      participantId: pkt.participantId,
      gaze: typeof pkt.gaze === "number"
        ? pkt.gaze
        : (typeof pkt.gazeX === "number" ? (pkt.gazeX + 1) / 2 : 0.5),
      proximity: typeof pkt.proximity === "number"
        ? pkt.proximity
        : (pkt.p || 0.35),
      ts: Date.now()
    };

    io.emit("relational:update", packet);
  });

  // -------------------------
  // TRANSITORY MODE SPECIFIC
  // (join / leave / update)
  // -------------------------
  // NOTE: Added so controller-transitory.html events reach hostMode.js (transitory.js)
  socket.on("transitory:join", (data) => {
    const pid = data && data.participantId;
    if (!pid) return;
    console.log("[transitory] join:", pid);
    io.emit("transitory:participant-joined", { participantId: pid });
  });

  socket.on("transitory:leave", (data) => {
    const pid = data && data.participantId;
    if (!pid) return;
    console.log("[transitory] leave:", pid);
    io.emit("transitory:participant-left", { participantId: pid });
  });

  // preferred API for transitory updates
  socket.on("transitory:update", (packet) => {
    if (!packet || !packet.participantId) return;
    packet.ts = packet.ts || Date.now();
    // normalize / sanitize a bit (cap intensity)
    if (typeof packet.intensity === "number") {
      packet.intensity = Math.max(0, Math.min(packet.intensity, 8));
    }
    io.emit("transitory:update", packet);
  });

    // -------------------------
  // INTEROPERABLE MODE SPECIFIC
  // (join / leave / update)
  // -------------------------
  socket.on("interoperable:join", (data) => {
    const pid = data && data.participantId;
    if (!pid) return;
    console.log("[interoperable] join:", pid);
    io.emit("interoperable:participant-joined", { participantId: pid });
  });

  socket.on("interoperable:leave", (data) => {
    const pid = data && data.participantId;
    if (!pid) return;
    console.log("[interoperable] leave:", pid);
    io.emit("interoperable:participant-left", { participantId: pid });
  });

  socket.on("interoperable:update", (packet) => {
    if (!packet || !packet.participantId) return;
    packet.ts = packet.ts || Date.now();
    // sanitize / cap intensity
    if (typeof packet.intensity === "number") {
      packet.intensity = Math.max(0, Math.min(packet.intensity, 1.0));
    }
    // sanitize pitch
    if (typeof packet.pitch === "number") {
      packet.pitch = Math.max(0, Math.min(packet.pitch, 22050)); // cap to Nyquist-ish
    }
    io.emit("interoperable:update", packet);
  });

  // -------------------------
// MULTIPLE MODE (roles → branches)
// -------------------------
socket.on("multiple:join", (data) => {
  const pid = data && data.participantId;
  if (!pid) return;
  console.log("[multiple] join:", pid);
  io.emit("multiple:participant-joined", { participantId: pid });
});

socket.on("multiple:leave", (data) => {
  const pid = data && data.participantId;
  if (!pid) return;
  console.log("[multiple] leave:", pid);
  io.emit("multiple:participant-left", { participantId: pid });
});

socket.on("multiple:add-role", (packet) => {
  if (!packet || !packet.participantId || !packet.role) return;
  console.log("[multiple] add-role:", packet.participantId, packet.role);
  io.emit("multiple:add-role", packet);
});


  socket.on("multiple:update", (packet) => {
    if (!packet || !packet.participantId) return;
    packet.ts = packet.ts || Date.now();
    io.emit("multiple:update", packet);
  });

   // -------------------------
// MISALIGNED MODE
 // (join / leave / update)
// -------------------------
socket.on("misaligned:join", (data) => {
  const pid = data && data.participantId;
  if (!pid) return;
  console.log("[misaligned] join:", pid);
  io.emit("misaligned:participant-joined", { participantId: pid });
});

socket.on("misaligned:leave", (data) => {
  const pid = data && data.participantId;
  if (!pid) return;
  console.log("[misaligned] leave:", pid);
  io.emit("misaligned:participant-left", { participantId: pid });
});

socket.on("misaligned:update", (packet) => {
  if (!packet || !packet.participantId) return;
  packet.ts = packet.ts || Date.now();
  if (typeof packet.vx === "number") packet.vx = Math.max(-6, Math.min(6, packet.vx));
  if (typeof packet.vy === "number") packet.vy = Math.max(-6, Math.min(6, packet.vy));
  io.emit("misaligned:update", packet);
});

  // -------------------------
// LEGIBLE MODE
// -------------------------
socket.on("legible:join", (data) => {
  const pid = data && data.participantId;
  if (!pid) return;
  console.log("[legible] join:", pid);
  io.emit("legible:participant-joined", { participantId: pid });
});

socket.on("legible:leave", (data) => {
  const pid = data && data.participantId;
  if (!pid) return;
  console.log("[legible] leave:", pid);
  io.emit("legible:participant-left", { participantId: pid });
});


  // -------------------------
  // generic socket diagnostics (optional)
  // -------------------------
  socket.on("whoami", (_, cb) => {
    // optional ack
    if (typeof cb === "function") cb({ socketId: socket.id });
  });

  // -------------------------
  // Disconnect cleanup
  // -------------------------
  socket.on("disconnect", () => {
    console.log("[socket] disconnected:", socket.id);
    delete participants[socket.id];
  });
});

// -------------------------
// START SERVER
// -------------------------
server.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
