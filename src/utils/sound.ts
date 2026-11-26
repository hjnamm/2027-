/**
 * Web Audio API 기반 한국 산사 돌탑 사운드 엔진
 * 묵직한 화강암 충돌음, 돌탑 붕괴, 연못 물보라, 사찰 범종(맥놀이 울림)을 합성합니다.
 */
class TempleSoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;
  private lastCreakAt = 0;

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock() {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted() {
    return this.muted;
  }

  private createNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * 묵직하고 단단한 돌 부딪힘 ("툭! 덜컥")
   * 1) 저음 화강암 무게감(sub-bass thud)
   * 2) 딱딱한 광물 충돌 파열음(stone clack)
   * 3) 살짝 뒤따르는 안착 소리(micro settle knock)
   */
  public playStoneClack(sizeRatio: number, isPerfect: boolean) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const clamped = Math.max(0.4, Math.min(1.25, sizeRatio));
    // 돌이 클수록 더 묵직하고 낮은 음역
    const weightFactor = 0.72 + clamped * 0.42;
    const thudStartFreq = 152 - clamped * 38;
    const thudEndFreq = 46 - clamped * 10;

    // 1) 묵직한 저음 바위 울림 (돌 무게감의 핵심)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(thudStartFreq, now);
    subOsc.frequency.exponentialRampToValueAtTime(Math.max(30, thudEndFreq), now + 0.125);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.46 * weightFactor, now + 0.005);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.155);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.165);

    // 2) 단단한 돌 표면 충돌음 (저중역 바디 + 고역 화강암 딱! 소리)
    const bodyNoise = ctx.createBufferSource();
    bodyNoise.buffer = this.createNoiseBuffer(ctx, 0.11);

    const lowFilter = ctx.createBiquadFilter();
    lowFilter.type = 'bandpass';
    lowFilter.frequency.setValueAtTime(340 + (1.2 - clamped) * 140, now);
    lowFilter.Q.setValueAtTime(1.6, now);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.44, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    bodyNoise.connect(lowFilter);
    lowFilter.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    bodyNoise.start(now);
    bodyNoise.stop(now + 0.11);

    const crackNoise = ctx.createBufferSource();
    crackNoise.buffer = this.createNoiseBuffer(ctx, 0.045);

    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(1450 + (1.2 - clamped) * 650, now);
    crackFilter.Q.setValueAtTime(2.8, now);

    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.32, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    crackNoise.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(ctx.destination);
    crackNoise.start(now);
    crackNoise.stop(now + 0.045);

    // 3) 무거운 돌이 자리 잡는 미세한 2차 안착음 ("덜컥")
    const settleAt = now + 0.036 + Math.random() * 0.014;
    const settleOsc = ctx.createOscillator();
    settleOsc.type = 'triangle';
    settleOsc.frequency.setValueAtTime(thudStartFreq * 1.35, settleAt);
    settleOsc.frequency.exponentialRampToValueAtTime(64, settleAt + 0.055);

    const settleGain = ctx.createGain();
    settleGain.gain.setValueAtTime(0.14 * weightFactor, settleAt);
    settleGain.gain.exponentialRampToValueAtTime(0.001, settleAt + 0.06);

    settleOsc.connect(settleGain);
    settleGain.connect(ctx.destination);
    settleOsc.start(settleAt);
    settleOsc.stop(settleAt + 0.065);

    // 4) 완벽 착지 시 절제된 목탁·옥돌 공명음 (가볍지 않고 단아한 중저역)
    if (isPerfect) {
      const moktak = ctx.createOscillator();
      moktak.type = 'sine';
      moktak.frequency.setValueAtTime(392, now + 0.01); // G4
      moktak.frequency.exponentialRampToValueAtTime(386, now + 0.34);

      const mGain = ctx.createGain();
      mGain.gain.setValueAtTime(0.0001, now + 0.01);
      mGain.gain.linearRampToValueAtTime(0.12, now + 0.025);
      mGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.38);

      moktak.connect(mGain);
      mGain.connect(ctx.destination);
      moktak.start(now + 0.01);
      moktak.stop(now + 0.4);
    }
  }

  /** 균형이 크게 기울 때 돌이 미세하게 마찰하며 긁히는 소리 (쓰로틀 적용) */
  public playStoneCreak() {
    const nowMs = performance.now();
    if (nowMs - this.lastCreakAt < 500) return;
    this.lastCreakAt = nowMs;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.16);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.linearRampToValueAtTime(360, now + 0.15);
    filter.Q.setValueAtTime(4.8, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.165);
  }

  /** 돌탑이 와르르 무너지는 묵직한 연쇄 화강암 붕괴음 */
  public playTowerCollapse(fallenCount: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const hits = Math.max(4, Math.min(11, fallenCount));
    const now = ctx.currentTime;

    for (let i = 0; i < hits; i++) {
      const delay = i * 0.062 + Math.random() * 0.035;
      const t = now + delay;
      const freq = 95 + Math.random() * 115;

      const noise = ctx.createBufferSource();
      noise.buffer = this.createNoiseBuffer(ctx, 0.13);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * 3.8, t);
      filter.Q.setValueAtTime(1.8, t);

      const g = ctx.createGain();
      const vol = Math.max(0.11, 0.34 - i * 0.02);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      noise.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.13);

      const thud = ctx.createOscillator();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(freq, t);
      thud.frequency.exponentialRampToValueAtTime(34, t + 0.11);

      const tg = ctx.createGain();
      tg.gain.setValueAtTime(vol * 1.05, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.125);

      thud.connect(tg);
      tg.connect(ctx.destination);
      thud.start(t);
      thud.stop(t + 0.13);
    }
  }

  /** 연못에 돌이 빠지는 묵직한 물보라 소리 */
  public playWaterSplash() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    const plop = ctx.createOscillator();
    plop.type = 'sine';
    plop.frequency.setValueAtTime(240, now);
    plop.frequency.exponentialRampToValueAtTime(98, now + 0.06);
    plop.frequency.exponentialRampToValueAtTime(360, now + 0.17);

    const plopGain = ctx.createGain();
    plopGain.gain.setValueAtTime(0.2, now);
    plopGain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);

    plop.connect(plopGain);
    plopGain.connect(ctx.destination);
    plop.start(now);
    plop.stop(now + 0.22);

    const noise = ctx.createBufferSource();
    noise.buffer = this.createNoiseBuffer(ctx, 0.26);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1150, now);
    bandpass.Q.setValueAtTime(0.85, now);

    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.15, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    noise.connect(bandpass);
    bandpass.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.26);
  }

  /**
   * 레벨(고도 구역) 통과 시 울려 퍼지는 한국 사찰 범종 소리
   * 당목(나무채)의 묵직한 타격음 + 청동 범종 특유의 깊은 맥놀이(느린 진동 여운)
   */
  public playTempleBell() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1) 당목이 종을 치는 첫 순간의 묵직한 울림
    const striker = ctx.createOscillator();
    striker.type = 'sine';
    striker.frequency.setValueAtTime(112, now);
    striker.frequency.exponentialRampToValueAtTime(52, now + 0.14);

    const strikerGain = ctx.createGain();
    strikerGain.gain.setValueAtTime(0.28, now);
    strikerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    striker.connect(strikerGain);
    strikerGain.connect(ctx.destination);
    striker.start(now);
    striker.stop(now + 0.17);

    // 2) 범종 기본음 + 맥놀이 쌍(146.8Hz / 148.4Hz) + 장엄한 배음
    const partials = [
      { freq: 146.83, amp: 0.21, decay: 3.4 }, // D3 기본음
      { freq: 148.45, amp: 0.17, decay: 3.2 }, // 맥놀이(1.6Hz 은은한 파동)
      { freq: 293.66, amp: 0.11, decay: 2.3 }, // 옥타브 배음
      { freq: 442.5, amp: 0.065, decay: 1.55 }, // 5도 청동 배음
      { freq: 589.0, amp: 0.035, decay: 1.0 }, // 은은한 쇠울림
    ];

    partials.forEach(({ freq, amp, decay }) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(amp, now + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0006, now + decay);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + decay + 0.08);
    });
  }
}

export const soundEngine = new TempleSoundEngine();
