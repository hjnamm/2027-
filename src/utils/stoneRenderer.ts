import { StoneTypeId } from '../config/gameConfig';

/**
 * 업로드된 실제 자연석 스튜디오 사진의 흰 배경·바닥 그림자를 깔끔하게 누끼(투명화) 처리하고
 * 돌의 실제 윤곽에 딱 맞게 크롭·색보정하여 캐싱하는 고현실감 돌 렌더러
 */

interface CutoutOptions {
  /** 배경으로 판별할 밝기 기준 (낮출수록 연한 회색 그림자도 함께 제거) */
  bgBrightThreshold: number;
  /** 배경으로 판별할 채도(max-min) 기준 */
  bgSatThreshold: number;
  /** 하단 스튜디오 그림자가 있는 사진인지 여부 */
  trimStudioShadow: boolean;
  /** 어두운 한국 산사 배경에 어우러지는 색감 보정 */
  tint?: { r: number; g: number; b: number; alpha: number };
  /** 전체 밝기 보정 (어두운 산사 톤에 자연스럽게 조화) */
  brightness?: number;
  /** 이끼 오버레이 추가 여부 */
  addMoss?: boolean;
}

const processedPhotoCache = new Map<string, HTMLCanvasElement>();

function createProcessedRockCutout(
  img: HTMLImageElement,
  cacheKey: string,
  opts: CutoutOptions
): HTMLCanvasElement | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  const cached = processedPhotoCache.get(cacheKey);
  if (cached) return cached;

  // 적절한 해상도로 정규화하여 빠르고 선명하게 처리
  const maxDim = 420;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(16, Math.round(img.naturalWidth * scale));
  const h = Math.max(16, Math.round(img.naturalHeight * scale));

  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  if (!wctx) return null;

  wctx.drawImage(img, 0, 0, w, h);
  const imageData = wctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // 1) 테두리 4면에서 시작하는 4방향 BFS로 흰 배경 및 옅은 스튜디오 그림자 제거
  const visited = new Uint8Array(w * h);
  const isBg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const isBackgroundPixel = (idx: number, y: number): boolean => {
    const p = idx * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const a = data[p + 3];
    if (a < 20) return true;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC - minC;
    const bright = (r + g + b) / 3;

    if (bright >= opts.bgBrightThreshold && sat <= opts.bgSatThreshold) {
      return true;
    }

    // 하단 스튜디오 바닥 그림자 영역(무채색 회색 그림자)만 선별 제거
    if (opts.trimStudioShadow && y > h * 0.72) {
      if (bright >= 148 && sat <= 16) return true;
    }
    return false;
  };

  const enqueue = (x: number, y: number) => {
    const idx = y * w + x;
    if (visited[idx]) return;
    if (!isBackgroundPixel(idx, y)) return;
    visited[idx] = 1;
    isBg[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) enqueue(x - 1, y);
    if (x < w - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < h - 1) enqueue(x, y + 1);
  }

  // 2) 스튜디오 바닥 그림자 꼬리 추가 정리 (돌 가장자리 아래에 얇게 남은 중립 회색 띠 제거)
  if (opts.trimStudioShadow) {
    // 돌의 세로 범위 사전 추정
    let roughTop = h;
    let roughBot = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isBg[y * w + x]) {
          if (y < roughTop) roughTop = y;
          if (y > roughBot) roughBot = y;
        }
      }
    }
    const roughH = Math.max(1, roughBot - roughTop);
    const shadowZoneStart = roughBot - Math.floor(roughH * 0.14);

    for (let x = 0; x < w; x++) {
      // 아래에서 위로 올라가며 짙은 돌 아랫면(< 95)을 만나기 전의 옅은 중립 그림자 제거
      for (let y = roughBot; y >= shadowZoneStart; y--) {
        const idx = y * w + x;
        if (isBg[idx]) continue;
        const p = idx * 4;
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        const bright = (r + g + b) / 3;
        if (bright > 92 && sat < 18) {
          isBg[idx] = 1;
        } else {
          break;
        }
      }
    }
  }

  // 3) 알파 적용 + 외곽 1px 흰 테두리(fringe) 제거 및 부드러운 안티앨리어싱
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  const brightScale = opts.brightness ?? 0.9;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const p = idx * 4;
      if (isBg[idx]) {
        data[p + 3] = 0;
        continue;
      }

      // 배경과 맞닿은 경계 픽셀 판별
      let bgNeighbors = 0;
      if (x > 0 && isBg[idx - 1]) bgNeighbors++;
      if (x < w - 1 && isBg[idx + 1]) bgNeighbors++;
      if (y > 0 && isBg[idx - w]) bgNeighbors++;
      if (y < h - 1 && isBg[idx + w]) bgNeighbors++;

      let r = data[p] * brightScale;
      let g = data[p + 1] * brightScale;
      let b = data[p + 2] * brightScale;

      if (opts.tint) {
        const ta = opts.tint.alpha;
        r = r * (1 - ta) + opts.tint.r * ta;
        g = g * (1 - ta) + opts.tint.g * ta;
        b = b * (1 - ta) + opts.tint.b * ta;
      }

      if (bgNeighbors > 0) {
        const origBright = (data[p] + data[p + 1] + data[p + 2]) / 3;
        // 흰 배경이 섞인 1px 경계 프린지를 자연스럽게 어둡히고 반투명 처리
        if (origBright > 175) {
          r *= 0.72;
          g *= 0.72;
          b *= 0.72;
        }
        data[p + 3] = bgNeighbors >= 2 ? 130 : 210;
      }

      data[p] = Math.max(0, Math.min(255, Math.round(r)));
      data[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[p + 2] = Math.max(0, Math.min(255, Math.round(b)));

      if (data[p + 3] > 60) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  wctx.putImageData(imageData, 0, 0);

  if (maxX <= minX || maxY <= minY) return null;

  // 4) 돌의 실제 윤곽에 딱 맞게 크롭 (물리 충돌 면과 1:1 밀착)
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cropW;
  out.height = cropH;
  const octx = out.getContext('2d');
  if (!octx) return null;

  octx.drawImage(work, minX, minY, cropW, cropH, 0, 0, cropW, cropH);

  // 이끼 산돌 변형 시 자연스러운 이끼 패치 합성
  if (opts.addMoss) {
    octx.save();
    octx.globalCompositeOperation = 'source-atop';
    const spots = [
      { x: cropW * 0.22, y: cropH * 0.26, r: cropW * 0.22 },
      { x: cropW * 0.76, y: cropH * 0.32, r: cropW * 0.19 },
      { x: cropW * 0.45, y: cropH * 0.18, r: cropW * 0.16 },
    ];
    for (const sp of spots) {
      const g = octx.createRadialGradient(sp.x, sp.y, 1, sp.x, sp.y, sp.r);
      g.addColorStop(0, 'rgba(64, 92, 52, 0.56)');
      g.addColorStop(0.6, 'rgba(52, 74, 44, 0.3)');
      g.addColorStop(1, 'rgba(52, 74, 44, 0)');
      octx.fillStyle = g;
      octx.beginPath();
      octx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      octx.fill();
    }
    octx.restore();
  }

  // 하단 접지면의 자연스러운 입체 음영 보강 (위 돌이 아래 돌에 묵직하게 얹힌 느낌)
  octx.save();
  octx.globalCompositeOperation = 'source-atop';
  const shade = octx.createLinearGradient(0, 0, 0, cropH);
  shade.addColorStop(0, 'rgba(255, 248, 232, 0.06)');
  shade.addColorStop(0.68, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, 'rgba(8, 12, 16, 0.26)');
  octx.fillStyle = shade;
  octx.fillRect(0, 0, cropW, cropH);
  octx.restore();

  processedPhotoCache.set(cacheKey, out);
  return out;
}

function getCutoutOptionsForStone(type: StoneTypeId): CutoutOptions {
  switch (type) {
    case 'boulder':
      return {
        bgBrightThreshold: 238,
        bgSatThreshold: 22,
        trimStudioShadow: false,
        brightness: 0.9,
      };
    case 'cobble':
      return {
        bgBrightThreshold: 238,
        bgSatThreshold: 22,
        trimStudioShadow: false,
        brightness: 0.92,
      };
    case 'flat':
      return {
        bgBrightThreshold: 238,
        bgSatThreshold: 22,
        trimStudioShadow: false,
        brightness: 0.92,
      };
    case 'angular':
      return {
        bgBrightThreshold: 214,
        bgSatThreshold: 18,
        trimStudioShadow: true,
        brightness: 0.94,
      };
    case 'ochre':
      return {
        bgBrightThreshold: 224,
        bgSatThreshold: 18,
        trimStudioShadow: true,
        brightness: 0.92,
        tint: { r: 168, g: 122, b: 78, alpha: 0.24 },
      };
    case 'basalt':
      return {
        bgBrightThreshold: 238,
        bgSatThreshold: 22,
        trimStudioShadow: false,
        brightness: 0.56,
        tint: { r: 34, g: 38, b: 44, alpha: 0.34 },
      };
    case 'jade':
      return {
        bgBrightThreshold: 238,
        bgSatThreshold: 22,
        trimStudioShadow: false,
        brightness: 0.88,
        tint: { r: 78, g: 124, b: 108, alpha: 0.28 },
      };
    case 'mossy':
      return {
        bgBrightThreshold: 238,
        bgSatThreshold: 22,
        trimStudioShadow: false,
        brightness: 0.86,
        tint: { r: 92, g: 106, b: 82, alpha: 0.16 },
        addMoss: true,
      };
  }
}

/**
 * 실제 자연석 사진 기반 렌더링 (로딩 전 짧은 순간에만 깔끔한 폴백 표시)
 */
export function drawRealisticRock(
  ctx: CanvasRenderingContext2D,
  type: StoneTypeId,
  w: number,
  h: number,
  color: string,
  stroke: string,
  variant: number,
  photoImg?: HTMLImageElement
) {
  const cutout = photoImg
    ? createProcessedRockCutout(
        photoImg,
        `rock_${type}_${photoImg.src}`,
        getCutoutOptionsForStone(type)
      )
    : null;

  if (cutout) {
    const flipX = variant % 2 === 0 ? 1 : -1;
    ctx.save();
    // 아래 돌 위에 드리우는 부드러운 접촉 그림자
    ctx.shadowColor = 'rgba(5, 8, 12, 0.52)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3.5;
    ctx.scale(flipX, 1);
    ctx.drawImage(cutout, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  // 사진 프리로드 직전 1~2프레임용 깔끔한 타원형 자연석 폴백
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, w * 0.48, h * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * 맨 밑 받침대 돌: 사용자가 지정한 마지막 사진(image_4d8aec9d.png)으로 현실적으로 렌더링
 */
export function drawRealisticPedestal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  timeSec: number,
  pedestalImg?: HTMLImageElement
) {
  const cutout = pedestalImg
    ? createProcessedRockCutout(pedestalImg, `pedestal_${pedestalImg.src}`, {
        bgBrightThreshold: 224,
        bgSatThreshold: 18,
        trimStudioShadow: true,
        brightness: 0.88,
      })
    : null;

  // 연못 수면 위 잔물결 고리
  const ripplePulse = 0.5 + 0.5 * Math.sin(timeSec * 1.9);
  ctx.save();
  ctx.strokeStyle = `rgba(186, 206, 212, ${0.13 + ripplePulse * 0.08})`;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, h + 1, w * (0.56 + ripplePulse * 0.04), 5.5, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 연못 수면 그림자
  ctx.fillStyle = 'rgba(4, 8, 14, 0.58)';
  ctx.beginPath();
  ctx.ellipse(0, h + 2, w * 0.54, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (cutout) {
    ctx.save();
    ctx.shadowColor = 'rgba(4, 8, 14, 0.55)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    // 받침대 상단(y = 0)이 돌탑 착지 기준면과 정확히 맞물리도록 배치
    ctx.drawImage(cutout, -w / 2, -2, w, h + 6);
    ctx.restore();
    return;
  }

  // 프리로드 직전 임시 폴백
  ctx.save();
  ctx.fillStyle = '#6D6960';
  ctx.beginPath();
  ctx.roundRect(-w / 2, 0, w, h, 8);
  ctx.fill();
  ctx.restore();
}
