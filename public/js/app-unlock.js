// app-unlock.js — controls the fingerprint hold → navigate to register page

(function() {
  const holdDuration = 2000; // 2s
  const finger = document.getElementById("fingerArea");
  const progressCircle = document.getElementById("progressCircle");
  const countdown = document.getElementById("countdown");
  const fpDot = document.getElementById("fpDot");
  const hum = document.getElementById("humSound");

  let startTime = 0;
  let anim = null;
  const R = 54;
  const C = 2 * Math.PI * R;
  progressCircle.style.strokeDasharray = `${C}`;

  function updateProgress(t) {
    const p = Math.min(1, t / holdDuration);
    progressCircle.style.strokeDashoffset = `${C * (1 - p)}`;
    countdown.textContent = `${Math.ceil((1 - p) * 2)}s`;
  }

  function startHold() {
    startTime = performance.now();
    hum.currentTime = 0;
    hum.play().catch(()=>{});
    anim = requestAnimationFrame(tick);
    finger.setAttribute("aria-pressed", "true");
  }

  function tick() {
    const elapsed = performance.now() - startTime;
    updateProgress(elapsed);
    if (elapsed >= holdDuration) return unlock();
    anim = requestAnimationFrame(tick);
  }

  function cancelHold() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
    progressCircle.style.strokeDashoffset = `${C}`;
    countdown.textContent = "2s";
    finger.setAttribute("aria-pressed", "false");
    hum.pause();
  }

  function unlock() {
    hum.pause();
    finger.setAttribute("aria-pressed", "false");
    fpDot.style.transform = "scale(1.12)";

    setTimeout(() => {
      window.location.href = "register.html";
    }, 300);
  }

  // EVENTS
  finger.addEventListener("touchstart", e => { e.preventDefault(); startHold(); }, {passive:false});
  finger.addEventListener("touchend", () => cancelHold());
  finger.addEventListener("mousedown", e => { e.preventDefault(); startHold(); });
  window.addEventListener("mouseup", () => cancelHold());
})();
