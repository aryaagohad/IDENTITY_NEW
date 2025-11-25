// idCard.js — populate the TE-inspired identity card on id.html
// Loads participant -> metrics -> glyph state and writes values into the card
// Expected HTML ids: card_fullName, card_voice, card_structure, card_complexity,
// card_asymmetry, card_notes
// Relies on: fetch('/_archive/participant/:id'), window.computeMetrics, window.glyphEngine

(function () {
  // Utilities
  function qs(id) { return document.getElementById(id); }
  function safeTrim(s) { return (s || "").toString().trim(); }
  function pct(v, digits = 0) { return `${Math.round(v * 100)}%`; }
  function fmt(v, digits = 2) { return Number(v).toFixed(digits); }

  // Small speculative note generator — friendly but a bit machine-y
  function generateSystemNotes(metrics, state, participant) {
    if (!metrics) return "No metrics available.";

    const lines = [];

    // Name reading
    /*const name = (participant && (participant.firstName || participant.data?.firstName)) || (participant && participant.data && (participant.data.firstName || "")) || "";
    if (name && name.length) {
      if (metrics.vowelRatio > 0.45) lines.push("SYSTEM: name reads as fluid — higher vowel presence.");
      else lines.push("SYSTEM: name reads as compact — consonant-led structure detected.");
    } else {
      lines.push("SYSTEM: no canonical name supplied.");
    }

    // Structural observation
    lines.push(`STRUCTURE: ${metrics.basePolygonSides || "?"}-sided base · ${metrics.rings || "?"} ring(s).`);

    // Complexity & nodes
    if (state && state.nodes) {
      const nodes = state.nodes.length;
      lines.push(`COMPLEXITY: ${nodes} internal node(s) mapped to name-length.`);
    }

    // Asymmetry note
    lines.push(`ASYMMETRY: ${fmt(metrics.asymmetry || 0, 2)} (0 = symmetric, 1 = high skew).`); */

    // Audio notes
    // --- Voice-based speculative reading ---
const audio = participant?.data?.audio;
if (!audio) {
  lines.push("AUDIO: no vocal imprint detected.");
  lines.push("SYSTEM: absence of voice sample reduces pattern confidence by ≈12%.");
} else {
  const dur = audio.duration || 0;
  const energy = audio.rms || 0;

  // Duration interpretation
  if (dur > 1.8) {
    lines.push("AUDIO: extended utterance — pacing appears controlled, almost rehearsed.");
  } else if (dur < 0.6) {
    lines.push("AUDIO: brief imprint — rapid confirmation behaviour detected.");
  } else {
    lines.push("AUDIO: mid-length sample — consistent with neutral affirmation patterns.");
  }

  // Energy interpretation (RMS)
  if (energy > 0.12) {
    lines.push("SIGNAL: elevated energy — micro-exertion spikes present.");
  } else if (energy < 0.04) {
    lines.push("SIGNAL: low-intensity envelope — subdued tonal dynamics.");
  } else {
    lines.push("SIGNAL: stable amplitude — balanced vocal distribution.");
  }
}
    // Highlight clusters
    if (typeof metrics.highlightClusters === 'number') {
      lines.push(`HIGHLIGHTS: ${pct(metrics.highlightClusters || 0)} of accents emphasized.`);
    }

    return lines.join("\n");
  }

  // Populate card fields
  async function populateCard() {
    try {
      const qsParams = new URLSearchParams(window.location.search);
      const id = qsParams.get('id') || sessionStorage.getItem('participantId');

      const notesEl = qs('card_notes');
      const fullNameEl = qs('card_fullName');
      const voiceEl = qs('card_voice');
      const structureEl = qs('card_structure');
      const complexityEl = qs('card_complexity');
      const asymEl = qs('card_asymmetry');

      if (!notesEl) {
        console.warn('idCard: card elements not found in DOM; skipping card wiring.');
        return;
      }

      notesEl.textContent = 'loading…';

      if (!id) {
        notesEl.textContent = 'No participant id. Go back to registration.';
        return;
      }

      const res = await fetch(`/_archive/participant/${encodeURIComponent(id)}`);
      if (!res.ok) {
        notesEl.textContent = `Could not load participant: ${res.statusText || res.status}`;
        return;
      }

      const participant = await res.json();
      const pdata = (participant && participant.data) ? participant.data : (participant || {});
      // metrics may be stored in participant.data.metrics else compute
      let metrics = (participant && participant.data && participant.data.metrics) ? participant.data.metrics : null;
      if (!metrics && window.computeMetrics) {
        try {
          metrics = window.computeMetrics(pdata, pdata.audio || null);
        } catch (e) { /* ignore */ } 
      }

      // generate glyph state for additional derived values (node count, dots)
      let state = null;
      if (window.glyphEngine && metrics) {
        try { state = window.glyphEngine.generateGlyphState(metrics); } catch (e) { state = null; }
      }

      // Full name
      const nameParts = [];
      if (pdata.firstName) nameParts.push(pdata.firstName);
      if (pdata.middleName) nameParts.push(pdata.middleName);
      if (pdata.lastName) nameParts.push(pdata.lastName);
      const displayName = nameParts.length ? nameParts.join(' ') : (pdata.nativeName || pdata.familyName || '—');
      if (fullNameEl) fullNameEl.textContent = displayName;

      // Voice signature
      if (pdata.audio && typeof pdata.audio.duration !== 'undefined') {
        voiceEl && (voiceEl.textContent = `${fmt(pdata.audio.duration, 2)}s · energy ${fmt(pdata.audio.rms || 0, 3)}`);
      } else {
        voiceEl && (voiceEl.textContent = 'no voice sample');
      }

      // Structure (sides/rings)
      if (metrics) {
        const sides = metrics.basePolygonSides || '?';
        const rings = metrics.rings || '?';
        structureEl && (structureEl.textContent = `${sides}-gon · ${rings} ring(s)`);
      } else {
        structureEl && (structureEl.textContent = '—');
      }

      // Complexity (nodes + dots)
      if (state) {
        const nodes = (state.nodes || []).length;
        const dots = (state.dots || []).length;
        complexityEl && (complexityEl.textContent = `${nodes} nodes · ${dots} accents`);
      } else {
        complexityEl && (complexityEl.textContent = '—');
      }

      // Asymmetry
      asymEl && (asymEl.textContent = metrics ? fmt(metrics.asymmetry || 0, 2) : '—');

      // System notes (multiline)
      const notes = generateSystemNotes(metrics || {}, state || {}, participant);
      notesEl.textContent = notes;

      // Also update the glyph name overlay (if finalRenderer placed one)
      try {
        const overlay = document.querySelector('#rendererContainer .id-name-overlay') ||
                        document.querySelector('.id-name-overlay');
        if (overlay) overlay.textContent = (pdata.firstName || '');
      } catch (e) {}

    } catch (err) {
      console.error('idCard.populateCard error', err);
      const notesEl = qs('card_notes');
      if (notesEl) notesEl.textContent = 'Error populating card. See console.';
    }
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateCard);
  } else {
    populateCard();
  }

})();
