// BEEP — short 800 Hz tone via WebAudio, approximating the GW-BASIC console beep.
let ctx = null;
function beep(ms = 150, freq = 800) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch { /* audio not available — silent */ }
}
