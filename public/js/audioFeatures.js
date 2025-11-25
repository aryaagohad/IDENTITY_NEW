// audioFeatures.js — record short clip, compute RMS + estimate pitch (naive)
// returns { duration, rms } or null if recording not available/blocked
(function(global){
  async function recordShort(durationMs = 2000){
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("No microphone access API");
      return null;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const source = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const data = new Float32Array(analyser.fftSize);
      const start = performance.now();
      let buf = [];
      function sample(){
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i=0;i<data.length;i++) sum += data[i]*data[i];
        buf.push(Math.sqrt(sum/data.length));
      }
      const interval = setInterval(sample, 80);
      await new Promise(r => setTimeout(r, durationMs));
      clearInterval(interval);
      // take mean RMS
      const avg = buf.length ? (buf.reduce((s,x)=>s+x,0)/buf.length) : 0;
      stream.getTracks().forEach(t=>t.stop());
      if (ac && ac.state !== "closed") ac.close();
      return { duration: durationMs/1000, rms: avg };
    } catch (err) {
      console.warn("Audio record failed/denied:", err);
      return null;
    }
  }

  global.audioFeatures = { recordShort };
})(window);

