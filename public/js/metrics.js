// metrics.js — unified source of truth for all computed glyph metrics

(function (global) {

  function hashFn(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return Math.abs(h);
  }

  function computeMetrics(data = {}, audio = null) {
    const safe = Object.assign({}, data);

    // Full canonical name
    const fullName =
      `${safe.firstName || ""} ${safe.middleName || ""} ${safe.lastName || ""}`
        .trim() ||
      (safe.nativeName || "").trim() ||
      "anon";

    const seed = hashFn(fullName);
    const nameLen = Math.max(1, fullName.length);

    // Vowel ratio
    const vowels = (fullName.match(/[aeiouyAEIOUY]/g) || []).length;
    const vowelRatio = nameLen ? vowels / nameLen : 0;

    // Consonant clusters
    const clusters = fullName.match(/([bcdfghjklmnpqrstvwxyz]{2,})/gi) || [];
    const clusterIndex = Math.min(1, clusters.length / 4);

    // Audio
    const audioDur = audio?.duration || 0;
    const audioRms = audio?.rms || 0;

    const audioDurationNorm = Math.min(1, audioDur / 3);
    const audioEnergy = Math.min(1, audioRms * 30);

    // Geometry metrics
    const basePolygonSides = 4 + (seed % 6);  
    const rings = 1 + Math.round(vowelRatio * 3 + audioDurationNorm * 2);
    const creases = 2 + (seed % 6);

    const asymmetry = Math.min(
      1,
      Math.abs(((seed >> 4) % 100) / 100 - 0.5) * 2 +
        (1 - vowelRatio) * 0.4
    );

    const highlightClusters = Math.min(1, vowelRatio + clusterIndex * 0.4);

    const colorSeed = seed % 360;

    return {
      seed,
      nameLen,
      vowelRatio,
      clusterIndex,
      audioDurationNorm,
      audioEnergy,
      basePolygonSides,
      rings,
      creases,
      asymmetry,
      highlightClusters,
      colorSeed
    };
  }

  global.computeMetrics = computeMetrics;

})(window);



