// progress.js — computes staged "progress" (0..1) for the glyph reveal
// Used by app.js and previewRenderer.js

(function (global) {

  // clamp utility
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // This determines how much of the glyph should be revealed based on form completion + audio
  global.progressStageForForm = function (data, audio) {
    if (!data) return 0;

    let p = 0;

    // --- Stage 1: first name typed (0 → 0.25)
    if (data.firstName && data.firstName.trim().length > 0) p = 0.25;

    // --- Stage 2: additional text fields filled (0.25 → 0.55)
    const textFields = ["middleName", "lastName", "nativeName"];
    let count = 0;
    textFields.forEach(f => {
      if (data[f] && data[f].trim().length > 0) count++;
    });
    
    if (count > 0) {
      p = 0.25 + (count / textFields.length) * 0.30;  
      // max: 0.25 + 0.3 = 0.55
    }

    // --- Stage 3: audio recorded (0.55 → 0.85)
    if (audio && audio.duration) {
      const norm = clamp01(audio.duration / 3);
      p = 0.55 + norm * 0.30;  
      // max: 0.55 + 0.30 = 0.85
    }

    // --- Stage 4: final submit (0.85 → 1) happens in final page
    return clamp01(p);
  };

})(window);
