// SOUND + PLAY backend — GW-BASIC audio via Web Audio. SOUND plays one tone; PLAY interprets
// an MML (Music Macro Language) string. Both block the interpreter for the note duration so a
// program's timing/sequence is preserved (the interpreter awaits these).
//
// MML subset (covers the common GW-BASIC PLAY usage):
//   A–G [#/+/-] [len]   note (sharp/flat), optional length override
//   N n                 note by number 0–84 (0 = rest)
//   O n                 octave 0–6        > / <  octave up / down
//   L n                 default length (1=whole … 64)
//   T n                 tempo (quarter notes per minute, 32–255)
//   P n / R n           pause/rest of length n
//   . (after a note)    dotted (×1.5)
//   MS / ML / MN        staccato / legato / normal articulation
const NOTE_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

class SoundEngine {
  constructor() { this.ctx = null; this.o = 4; this.len = 4; this.tempo = 120; this.artic = 7 / 8; }
  _ctx() { return this.ctx || (this.ctx = new (window.AudioContext || window.webkitAudioContext)()); }

  // One tone for ms milliseconds (gap = silence for staccato/legato spacing).
  _tone(freq, ms, gap = 0) {
    return new Promise((resolve) => {
      try {
        const ctx = this._ctx(), t0 = ctx.currentTime, dur = Math.max(0, ms - gap) / 1000;
        if (freq > 0) {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = 'square'; osc.frequency.value = freq; g.gain.value = 0.12;
          osc.connect(g).connect(ctx.destination); osc.start(t0); osc.stop(t0 + dur);
        }
      } catch { /* audio unavailable → just wait */ }
      setTimeout(resolve, ms);
    });
  }

  // SOUND freq, duration  — duration is in clock ticks (18.2/sec).
  async sound(freq, ticks) { await this._tone(freq <= 0 ? 0 : freq, (ticks / 18.2) * 1000); }

  _noteFreq(semitoneFromC0) { return 440 * Math.pow(2, (semitoneFromC0 - 57) / 12); } // A4=57 semis above C0
  _lenMs(len, dots) { let ms = (240000 / this.tempo) / len; let add = ms, d = dots; while (d-- > 0) { add /= 2; ms += add; } return ms; }

  async play(str) {
    const s = String(str).toUpperCase(); let i = 0;
    const numAt = () => { let n = ''; while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++]; return n === '' ? null : parseInt(n, 10); };
    while (i < s.length) {
      const c = s[i++];
      if (c === ' ') continue;
      if (c === 'O') { const n = numAt(); if (n != null) this.o = n; }
      else if (c === '>') this.o = Math.min(6, this.o + 1);
      else if (c === '<') this.o = Math.max(0, this.o - 1);
      else if (c === 'L') { const n = numAt(); if (n) this.len = n; }
      else if (c === 'T') { const n = numAt(); if (n) this.tempo = n; }
      else if (c === 'M') { const a = s[i++]; this.artic = a === 'S' ? 3 / 4 : a === 'L' ? 1 : 7 / 8; }
      else if (c === 'P' || c === 'R') { const n = numAt() || this.len; await this._tone(0, this._lenMs(n, 0)); }
      else if (c === 'N') { const n = numAt() || 0; if (n === 0) await this._tone(0, this._lenMs(this.len, 0)); else { const ms = this._lenMs(this.len, 0); await this._tone(this._noteFreq(n - 1), ms, ms * (1 - this.artic)); } }
      else if (c in NOTE_SEMI) {
        let semi = NOTE_SEMI[c];
        while (s[i] === '#' || s[i] === '+' || s[i] === '-') { semi += (s[i] === '-' ? -1 : 1); i++; }
        let len = numAt() || this.len, dots = 0; while (s[i] === '.') { dots++; i++; }
        const ms = this._lenMs(len, dots);
        await this._tone(this._noteFreq(this.o * 12 + semi), ms, ms * (1 - this.artic));
      }
    }
  }
}
