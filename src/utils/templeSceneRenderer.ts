interface RGB {
  r: number;
  g: number;
  b: number;
}

interface TimePalette {
  skyTop: RGB;
  skyMid: RGB;
  skyBot: RGB;
  mist: RGB;
  tint: RGB;
  tintAlpha: number;
  windowGlow: number;
  waterTop: RGB;
  waterBot: RGB;
  moonAlpha: number;
  starAlpha: number;
  lanternAlpha: number;
  sunAlpha: number;
  sunColor: RGB;
}

/**
 * 고풍스럽고 단아하며 차분히 어두운 한국화 색감의 4단계 시간대 팔레트
 * 0.00: 이른 오전 (안개 낀 청회빛 새벽·아침)
 * 0.33: 고요한 오후 (먹빛 청남과 고풍스런 황토빛 햇살)
 * 0.66: 붉은 노을 (자줏빛 하늘과 감빛·단청빛 황혼)
 * 1.00: 고요한 저녁 (깊은 남색 밤하늘, 달빛과 따뜻한 연등)
 */
const TIME_PALETTES: TimePalette[] = [
  // 0: 오전 (차분하고 고풍스러운 어두운 아침 안개)
  {
    skyTop: { r: 34, g: 48, b: 58 },
    skyMid: { r: 62, g: 82, b: 88 },
    skyBot: { r: 108, g: 120, b: 118 },
    mist: { r: 175, g: 186, b: 184 },
    tint: { r: 120, g: 148, b: 152 },
    tintAlpha: 0.14,
    windowGlow: 0.28,
    waterTop: { r: 36, g: 52, b: 56 },
    waterBot: { r: 18, g: 28, b: 32 },
    moonAlpha: 0,
    starAlpha: 0,
    lanternAlpha: 0,
    sunAlpha: 0.55,
    sunColor: { r: 236, g: 226, b: 198 },
  },
  // 1: 오후 (단아하고 깊은 먹청·고동빛 오후)
  {
    skyTop: { r: 32, g: 44, b: 62 },
    skyMid: { r: 68, g: 76, b: 88 },
    skyBot: { r: 132, g: 118, b: 96 },
    mist: { r: 176, g: 162, b: 140 },
    tint: { r: 168, g: 138, b: 94 },
    tintAlpha: 0.15,
    windowGlow: 0.42,
    waterTop: { r: 38, g: 46, b: 52 },
    waterBot: { r: 20, g: 24, b: 29 },
    moonAlpha: 0,
    starAlpha: 0,
    lanternAlpha: 0.08,
    sunAlpha: 0.65,
    sunColor: { r: 244, g: 208, b: 146 },
  },
  // 2: 노을 (고풍스런 자줏빛·감빛 붉은 노을)
  {
    skyTop: { r: 24, g: 22, b: 40 },
    skyMid: { r: 84, g: 44, b: 48 },
    skyBot: { r: 168, g: 92, b: 58 },
    mist: { r: 192, g: 118, b: 84 },
    tint: { r: 174, g: 78, b: 48 },
    tintAlpha: 0.22,
    windowGlow: 0.72,
    waterTop: { r: 54, g: 36, b: 40 },
    waterBot: { r: 22, g: 18, b: 24 },
    moonAlpha: 0.18,
    starAlpha: 0.18,
    lanternAlpha: 0.48,
    sunAlpha: 0.72,
    sunColor: { r: 238, g: 132, b: 78 },
  },
  // 3: 저녁·깊은 밤 (인정전 야경 같은 깊은 남빛 밤하늘과 달빛)
  {
    skyTop: { r: 9, g: 14, b: 24 },
    skyMid: { r: 18, g: 27, b: 44 },
    skyBot: { r: 32, g: 42, b: 58 },
    mist: { r: 86, g: 102, b: 124 },
    tint: { r: 14, g: 22, b: 38 },
    tintAlpha: 0.24,
    windowGlow: 0.96,
    waterTop: { r: 18, g: 27, b: 38 },
    waterBot: { r: 9, g: 14, b: 22 },
    moonAlpha: 1,
    starAlpha: 1,
    lanternAlpha: 1,
    sunAlpha: 0,
    sunColor: { r: 220, g: 140, b: 90 },
  },
];

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(lerpNum(a.r, b.r, t)),
    g: Math.round(lerpNum(a.g, b.g, t)),
    b: Math.round(lerpNum(a.b, b.b, t)),
  };
}

function rgba(c: RGB, alpha = 1): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function sampleTimePalette(progress: number): TimePalette {
  const clamped = Math.max(0, Math.min(1, progress));
  const scaled = clamped * (TIME_PALETTES.length - 1);
  const idx = Math.min(TIME_PALETTES.length - 2, Math.floor(scaled));
  const localT = scaled - idx;
  const smoothT = localT * localT * (3 - 2 * localT);
  const a = TIME_PALETTES[idx];
  const b = TIME_PALETTES[idx + 1];

  return {
    skyTop: lerpRgb(a.skyTop, b.skyTop, smoothT),
    skyMid: lerpRgb(a.skyMid, b.skyMid, smoothT),
    skyBot: lerpRgb(a.skyBot, b.skyBot, smoothT),
    mist: lerpRgb(a.mist, b.mist, smoothT),
    tint: lerpRgb(a.tint, b.tint, smoothT),
    tintAlpha: lerpNum(a.tintAlpha, b.tintAlpha, smoothT),
    windowGlow: lerpNum(a.windowGlow, b.windowGlow, smoothT),
    waterTop: lerpRgb(a.waterTop, b.waterTop, smoothT),
    waterBot: lerpRgb(a.waterBot, b.waterBot, smoothT),
    moonAlpha: lerpNum(a.moonAlpha, b.moonAlpha, smoothT),
    starAlpha: lerpNum(a.starAlpha, b.starAlpha, smoothT),
    lanternAlpha: lerpNum(a.lanternAlpha, b.lanternAlpha, smoothT),
    sunAlpha: lerpNum(a.sunAlpha, b.sunAlpha, smoothT),
    sunColor: lerpRgb(a.sunColor, b.sunColor, smoothT),
  };
}

// 일러스트 상단 하늘을 부드럽게 투명 처리한 오프스크린 캐시 (동적 하늘과 자연스럽게 합성)
let cachedImgSrc = '';
let featheredCanvas: HTMLCanvasElement | null = null;

function getFeatheredTempleCanvas(img: HTMLImageElement): HTMLCanvasElement | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  if (featheredCanvas && cachedImgSrc === img.src) return featheredCanvas;

  const off = document.createElement('canvas');
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const octx = off.getContext('2d');
  if (!octx) return null;

  octx.drawImage(img, 0, 0);
  octx.globalCompositeOperation = 'destination-in';
  const mask = octx.createLinearGradient(0, 0, 0, off.height);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.22, 'rgba(0,0,0,0.06)');
  mask.addColorStop(0.38, 'rgba(0,0,0,0.78)');
  mask.addColorStop(0.5, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,1)');
  octx.fillStyle = mask;
  octx.fillRect(0, 0, off.width, off.height);

  cachedImgSrc = img.src;
  featheredCanvas = off;
  return off;
}

/**
 * 고풍스럽고 단아한 한국 산사·전각 배경 렌더러
 * timeProgress (0~1)에 따라 오전 → 오후 → 노을 → 저녁으로 하늘·빛·달·연등이 변화합니다.
 */
export function renderTempleParallaxBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  cameraOffsetY: number,
  pondSurfaceY: number,
  timeSec: number,
  templeImg?: HTMLImageElement,
  pondImg?: HTMLImageElement,
  timeProgress = 0
) {
  const p = sampleTimePalette(timeProgress);

  // 1) 시간대에 따라 깊어지는 고풍스런 하늘 그라데이션
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H);
  skyGrad.addColorStop(0, rgba(p.skyTop));
  skyGrad.addColorStop(0.52, rgba(p.skyMid));
  skyGrad.addColorStop(1, rgba(p.skyBot));
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // 2) 별빛 (노을 끝자락부터 깊은 저녁까지 은은하게 반짝임)
  if (p.starAlpha > 0.02) {
    for (let i = 0; i < 46; i++) {
      const sx = (((i * 97 + 13) % 100) / 100) * W;
      const sy = (((i * 53 + 7) % 100) / 100) * H * 0.72;
      const twinkle = 0.45 + 0.55 * Math.sin(timeSec * (1.4 + (i % 4) * 0.5) + i);
      const r = 0.7 + (i % 3) * 0.45;
      ctx.fillStyle = `rgba(255, 246, 224, ${p.starAlpha * twinkle * 0.82})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3) 오전·오후·노을의 해(낮아지며 붉어짐) & 저녁의 보름달
  if (p.sunAlpha > 0.02) {
    const sunX = W * (0.24 + timeProgress * 0.55);
    const sunY = H * (0.24 + Math.pow(timeProgress, 1.35) * 0.24);
    const sunHalo = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 128);
    sunHalo.addColorStop(0, rgba(p.sunColor, 0.72 * p.sunAlpha));
    sunHalo.addColorStop(0.35, rgba(p.sunColor, 0.24 * p.sunAlpha));
    sunHalo.addColorStop(1, rgba(p.sunColor, 0));
    ctx.fillStyle = sunHalo;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 128, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = rgba(p.sunColor, 0.82 * p.sunAlpha);
    ctx.beginPath();
    ctx.arc(sunX, sunY, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  if (p.moonAlpha > 0.02) {
    const moonX = W * 0.78;
    const moonY = H * 0.19;
    const moonHalo = ctx.createRadialGradient(moonX, moonY, 8, moonX, moonY, 92);
    moonHalo.addColorStop(0, `rgba(255, 246, 218, ${0.42 * p.moonAlpha})`);
    moonHalo.addColorStop(0.45, `rgba(218, 224, 240, ${0.14 * p.moonAlpha})`);
    moonHalo.addColorStop(1, 'rgba(218, 224, 240, 0)');
    ctx.fillStyle = moonHalo;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 92, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(252, 244, 222, ${0.92 * p.moonAlpha})`;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4) 높은 고도에서도 이어지는 원경 수묵 산맥 (패럴랙스 0.12)
  const farMountainY = pondSurfaceY - 210 + cameraOffsetY * 0.12;
  if (farMountainY < H + 180) {
    ctx.fillStyle = rgba(
      lerpRgb(p.skyTop, { r: 16, g: 22, b: 30 }, 0.58),
      0.72
    );
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, farMountainY + 34);
    ctx.bezierCurveTo(
      W * 0.2,
      farMountainY - 62,
      W * 0.38,
      farMountainY - 34,
      W * 0.54,
      farMountainY - 76
    );
    ctx.bezierCurveTo(
      W * 0.72,
      farMountainY - 22,
      W * 0.86,
      farMountainY - 48,
      W,
      farMountainY + 8
    );
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  // 5) 고풍스런 한국 전통 전각(인정전·대웅전) 일러스트 합성 (패럴랙스 0.56)
  const parallaxShift = cameraOffsetY * 0.56;
  const feathered = templeImg ? getFeatheredTempleCanvas(templeImg) : null;

  if (feathered) {
    const imgAspect = feathered.width / feathered.height;
    const drawW = Math.max(W, H * imgAspect * 0.98);
    const drawH = drawW / imgAspect;
    const drawX = (W - drawW) / 2;
    // 연못 윗경계에 일러스트 하단 연못이 자연스럽게 맞물리도록 배치
    const drawY = pondSurfaceY + 76 - drawH + parallaxShift;

    if (drawY < H + 60) {
      ctx.save();
      ctx.drawImage(feathered, drawX, drawY, drawW, drawH);

      // 시간대 색감 조화 (오전 안개 / 오후 고동빛 / 노을 붉은 빛 / 저녁 깊은 남빛)
      ctx.fillStyle = rgba(p.tint, p.tintAlpha);
      ctx.fillRect(0, Math.max(0, drawY), W, H - Math.max(0, drawY));

      // 전각 중앙 한지 창호에서 새어 나오는 은은한 불빛 (노을·저녁일수록 깊어짐)
      const hallGlowY = drawY + drawH * 0.72;
      if (hallGlowY < H + 80 && p.windowGlow > 0.1) {
        const flicker = 0.92 + Math.sin(timeSec * 2.6) * 0.08;
        const glowR = W * 0.36;
        const glow = ctx.createRadialGradient(
          W * 0.5,
          hallGlowY,
          4,
          W * 0.5,
          hallGlowY,
          glowR
        );
        glow.addColorStop(
          0,
          `rgba(255, 206, 126, ${0.34 * p.windowGlow * flicker})`
        );
        glow.addColorStop(
          0.55,
          `rgba(232, 152, 74, ${0.12 * p.windowGlow * flicker})`
        );
        glow.addColorStop(1, 'rgba(232, 152, 74, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(W * 0.5, hallGlowY, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  } else {
    // 이미지 로딩 중 폴백: 고풍스런 어두운 한국 중층 전각 실루엣
    drawFallbackPalaceHall(ctx, W, H, pondSurfaceY - 12 + parallaxShift, p, timeSec);
  }

  // 6) 산허리를 감도는 은은한 수묵 운무(안개)
  const mistBandY = pondSurfaceY - 165 + cameraOffsetY * 0.32;
  if (mistBandY < H + 90) {
    const drift = Math.sin(timeSec * 0.28) * 18;
    const mistGrad = ctx.createLinearGradient(0, mistBandY - 40, 0, mistBandY + 46);
    mistGrad.addColorStop(0, rgba(p.mist, 0));
    mistGrad.addColorStop(0.5, rgba(p.mist, 0.16));
    mistGrad.addColorStop(1, rgba(p.mist, 0));
    ctx.fillStyle = mistGrad;
    ctx.fillRect(drift - 24, mistBandY - 40, W + 48, 86);
  }

  // 7) 노을·저녁에 천천히 떠오르는 소원 연등 (은은하고 단아한 배경 연출)
  if (p.lanternAlpha > 0.04) {
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const lxBase = (((i * 173 + 37) % 100) / 100) * W;
      const sway = Math.sin(timeSec * 0.7 + i * 2.1) * 9;
      const riseSpan = H + 120;
      const ly =
        H +
        40 -
        ((((timeSec * (8 + (i % 3) * 3) + i * 115 + cameraOffsetY * 0.22) % riseSpan) +
          riseSpan) %
          riseSpan);
      const scale = 0.55 + (i % 3) * 0.22;
      const alpha = p.lanternAlpha * (0.45 + 0.3 * Math.sin(timeSec * 2 + i));

      const glow = ctx.createRadialGradient(
        lxBase + sway,
        ly,
        1,
        lxBase + sway,
        ly,
        18 * scale
      );
      glow.addColorStop(0, `rgba(255, 212, 134, ${alpha * 0.85})`);
      glow.addColorStop(1, 'rgba(255, 162, 74, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(lxBase + sway, ly, 18 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255, 224, 158, ${alpha})`;
      ctx.beginPath();
      ctx.ellipse(lxBase + sway, ly, 3.2 * scale, 4.4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 8) 고요하고 깊은 어두운 연못 수면 (패럴랙스 1.0 — 받침대 화강암과 같은 높이)
  const waterY = pondSurfaceY + cameraOffsetY;
  if (waterY < H + 90) {
    if (pondImg && pondImg.complete) {
      ctx.drawImage(pondImg, 0, waterY, W, Math.max(96, H - waterY + 20));
    } else {
      const pondGrad = ctx.createLinearGradient(0, waterY, 0, Math.max(H, waterY + 100));
      pondGrad.addColorStop(0, rgba(p.waterTop, 0.82));
      pondGrad.addColorStop(0.45, rgba(p.waterBot, 0.94));
      pondGrad.addColorStop(1, 'rgba(8, 12, 18, 0.98)');
      ctx.fillStyle = pondGrad;
      ctx.fillRect(0, waterY, W, Math.max(140, H - waterY + 50));

      // 은은한 수면 경계선
      ctx.fillStyle = rgba(p.mist, 0.24);
      ctx.fillRect(0, waterY, W, 1.5);

      // 전각 한지 불빛의 잔잔한 수면 반사
      const reflGrad = ctx.createRadialGradient(
        W * 0.5,
        waterY + 14,
        4,
        W * 0.5,
        waterY + 26,
        W * 0.34
      );
      reflGrad.addColorStop(0, `rgba(246, 198, 124, ${0.22 * p.windowGlow})`);
      reflGrad.addColorStop(1, 'rgba(246, 198, 124, 0)');
      ctx.fillStyle = reflGrad;
      ctx.fillRect(0, waterY, W, 80);

      // 잔물결
      ctx.strokeStyle = rgba(p.mist, 0.16);
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const ry = waterY + 14 + i * 10;
        const phase = timeSec * (0.6 + (i % 3) * 0.2) + i * 1.7;
        const rx = ((i * 71) % Math.max(120, W - 80)) + Math.sin(phase) * 8 + 16;
        const rw = 24 + (i % 4) * 14;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + rw, ry);
        ctx.stroke();
      }
    }
  }
}

function drawFallbackPalaceHall(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  groundY: number,
  p: TimePalette,
  timeSec: number
) {
  if (groundY > H + 200) return;

  const cx = W * 0.5;
  const tw = Math.min(280, W * 0.78);
  const wallW = tw * 0.74;
  const wallH = 56;

  // 월대 돌기단
  ctx.fillStyle = '#39393B';
  ctx.fillRect(0, groundY - 20, W, 42);

  // 전각 벽과 주홍 기둥
  ctx.fillStyle = '#53352D';
  ctx.fillRect(cx - wallW / 2, groundY - 20 - wallH, wallW, wallH);

  // 은은한 한지 창호 불빛
  const flicker = 0.9 + Math.sin(timeSec * 3) * 0.1;
  ctx.fillStyle = `rgba(245, 206, 134, ${0.45 + 0.45 * p.windowGlow * flicker})`;
  ctx.fillRect(cx - wallW * 0.12, groundY - 20 - wallH + 14, wallW * 0.24, wallH - 16);
  ctx.fillStyle = `rgba(232, 188, 118, ${0.28 + 0.35 * p.windowGlow})`;
  ctx.fillRect(cx - wallW * 0.36, groundY - 20 - wallH + 16, wallW * 0.16, wallH - 18);
  ctx.fillRect(cx + wallW * 0.2, groundY - 20 - wallH + 16, wallW * 0.16, wallH - 18);

  // 단청 띠
  ctx.fillStyle = '#2E4C46';
  ctx.fillRect(cx - wallW * 0.54, groundY - 20 - wallH - 7, wallW * 1.08, 7);

  // 1·2층 기와지붕
  const drawRoof = (rx: number, ry: number, rw: number, rh: number) => {
    const hw = rw / 2;
    ctx.fillStyle = '#23282E';
    ctx.beginPath();
    ctx.moveTo(rx - hw - 10, ry);
    ctx.quadraticCurveTo(rx - hw * 0.5, ry - rh * 0.35, rx - rw * 0.26, ry - rh);
    ctx.lineTo(rx + rw * 0.26, ry - rh);
    ctx.quadraticCurveTo(rx + hw * 0.5, ry - rh * 0.35, rx + hw + 10, ry);
    ctx.quadraticCurveTo(rx, ry + 6, rx - hw - 10, ry);
    ctx.closePath();
    ctx.fill();
  };

  drawRoof(cx, groundY - 20 - wallH - 4, tw, 36);
  ctx.fillStyle = '#4B332C';
  ctx.fillRect(cx - wallW * 0.36, groundY - 20 - wallH - 44, wallW * 0.72, 14);
  drawRoof(cx, groundY - 20 - wallH - 44, tw * 0.74, 30);
}
