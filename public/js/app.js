// app.js — registration logic (uses computeMetrics from metrics.js)
// Updated: only show glyph preview after the user types a first name

(function () {
  const form = document.getElementById("nameForm");
  const recordBtn = document.getElementById("recordBtn");
  const audioStatus = document.getElementById("audioStatus");

  let participantData = {};
  let audioData = null;

  // helper: decide whether we should show any glyph at all
  function shouldShowPreview(data) {
    if (!data) return false;
    const first = (data.firstName || "").toString().trim();
    return first.length > 0; // only show once firstName typed
  }

  // helper: update live preview (calls previewRenderer hook)
  function refreshPreview() {
    try {
      // only compute metrics if we should show preview
      if (!shouldShowPreview(participantData)) {
        // explicitly clear preview
        if (window.updateLivePreview) window.updateLivePreview(null);
        // also remove any stored live snapshot for temp id (optional)
        try {
          if (participantData._tempId) sessionStorage.removeItem('liveMetrics');
        } catch (e) {}
        return;
      }

      const m = computeMetrics(participantData, audioData);
      // compute progress (0..1) from form + audio
      m._progress = progressStageForForm(participantData, audioData);

      // call preview hook if present
      if (window.updateLivePreview) window.updateLivePreview(m);

      // persist a latest live snapshot (so host can fetch if needed)
      if (participantData._tempId) {
        try {
          sessionStorage.setItem('liveMetrics', JSON.stringify({ id: participantData._tempId, data: participantData, metrics: m }));

          // optionally POST to /liveUpdate for server-host mirror (fire-and-forget)
          fetch('/liveUpdate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: participantData._tempId, data: participantData, metrics: m })
          }).catch(()=>{/* silent */});

          // emit socket live-update if socket is available (debounce not implemented here; could be added)
          if (window.socket && window.socket.connected) {
            try {
              window.socket.emit('live-update', { id: participantData._tempId, data: participantData, metrics: m, progress: m._progress });
            } catch(e) {}
          }
        } catch(e) {}
      }
    } catch (err) {
      console.warn('Preview compute error', err);
    }
  }

  // initialize a temp id for live snapshots
  participantData._tempId = `temp-${Date.now().toString(36)}`;

  // capture form input -> update preview
  form.addEventListener("input", () => {
    participantData = { ...participantData, ...Object.fromEntries(new FormData(form).entries()) };
    // call preview only when needed
    refreshPreview();
  });

  // Audio recording (short name clip)
  let mediaRecorder, chunks = [];
  recordBtn.addEventListener("click", async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.start();
      audioStatus.textContent = "Recording...";
      // stop automatically after 1.6s
      setTimeout(() => {
        mediaRecorder.stop();
        mediaRecorder.ondataavailable = e => { if (e.data) chunks.push(e.data); };
        mediaRecorder.onstop = async () => {
          try {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            const ac = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await ac.decodeAudioData(arrayBuffer.slice(0));
            const ch = audioBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
            const rms = Math.sqrt(sum / ch.length) || 0;
            audioData = { duration: audioBuffer.duration || 1.5, rms };
            audioStatus.textContent = "Recorded ✓";
            // update preview only if we should show it
            refreshPreview();
            ac.close();
          } catch (err) {
            // fallback
            audioData = { duration: 1.5, rms: 0.05 };
            audioStatus.textContent = "Recorded ✓";
            refreshPreview();
          }
        };
      }, 1600);
    } catch (e) {
      console.warn(e);
      alert("Microphone blocked or unavailable");
    }
  });

  // submit -> save to server (include metrics computed by computeMetrics)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    participantData = { ...participantData, ...Object.fromEntries(new FormData(form).entries()) };

    // ensure we compute metrics (if firstName present)
    if (!shouldShowPreview(participantData)) {
      alert("Please enter your first name to generate your ID.");
      return;
    }

    const metrics = computeMetrics(participantData, audioData);
    const payload = {
      ...participantData,
      audio: audioData,
      metrics
    };

    // disable submit UI while saving
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
      const res = await fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json && json.success && json.id) {
        // persist id for fingerprint / final page
        sessionStorage.setItem('participantId', json.id);
        // ensure host can fetch latest live snapshot (also stored server-side via /liveUpdate in server)
        try {
          await fetch('/liveUpdate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: json.id, data: payload, metrics })
          });
        } catch (err) { /* ignore */ }

        // final socket broadcast
        if (window.socket && window.socket.connected) {
          try { window.socket.emit('live-update', { id: json.id, data: payload, metrics, progress: 1 }); } catch(e){}
        }

        // redirect to id view (final)
        window.location.href = `/id.html?id=${encodeURIComponent(json.id)}`;
      } else {
        throw new Error(json && json.error ? json.error : 'Save failed');
      }
    } catch (err) {
      console.error('Save error', err);
      alert('Error saving your data. Try again.');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Generate My ID'; }
    }
  });

  // Do NOT call refreshPreview() on load — preview stays empty until user starts typing
})();




