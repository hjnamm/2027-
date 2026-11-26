import React, { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import {
  ALTITUDE_ZONES,
  ASSET_URLS,
  GAME_CONFIG,
  getZoneForLayer,
  StoneTypeId,
} from '../config/gameConfig';
import { soundEngine } from '../utils/sound';
import { renderTempleParallaxBackground } from '../utils/templeSceneRenderer';

/**
 * 난이도·높이·하늘 연출 조정값 (이 파일 안에서만 쓰는 값)
 * 너무 어렵거나 쉬우면 여기 숫자만 바꾸면 됨
 */
const TUNING = {
  /** 처음 낙하 속도 배율 (1 = 원래 속도). 층이 올라갈수록 1까지 올라감 */
  fallSpeedStartMult: 0.75,
  /** 몇 층에 걸쳐 원래 낙하 속도까지 올릴지 */
  fallSpeedRampLayers: 14,
  /** 돌을 받아주는 범위 배율 (1보다 크면 조금 빗겨도 받아줌) */
  catchWidthBonus: 1.15,
  /** 층마다 버틸 수 있는 최대 기울기가 줄어드는 정도 (원래 0.0052) */
  criticalTiltShrinkPerLayer: 0.0035,
  /** 받침대를 빨리 움직일 때 탑이 흔들리는 정도 배율 */
  accelSwayMult: 0.8,
  /** 바람이 나오는 층을 원래보다 몇 층 늦출지 */
  windDelayLayers: 3,
  /** 돌이 떨어지는 좌우 범위: 처음엔 가운데 근처, 층마다 넓어짐 */
  spawnSpreadStart: 0.3,
  spawnSpreadPerLayer: 0.04,
  /** 받침대에서 '반대쪽으로 유도'하는 낙하 위치 규칙을 몇 층부터 쓸지 */
  pushAwayFromLayer: 3,
  /** 화면 1px = 몇 cm (소원돌탑 높이 계산용) */
  cmPerPx: 0.5,
  /** 탑이 이만큼(px) 올라가면 하늘 연출이 최대가 됨 */
  skyFullPx: 2600,
};

const formatHeight = (cm: number) =>
  cm < 100 ? `${cm}cm` : `${(cm / 100).toFixed(2)}m`;

export interface StoneTowerRunResult {
  layers: number;
  /** 소원돌탑 최고 높이 (cm) */
  heightCm: number;
  /** 화면 표시용 높이 문자열 (예: 86cm, 1.24m) */
  heightLabel: string;
  zoneName: string;
  endReason: 'collapsed' | 'missed';
}

interface StoneTowerGameProps {
  mode: 'title' | 'playing' | 'gameover';
  onGameOver: (result: StoneTowerRunResult) => void;
  onZoneChange?: (isDarkText: boolean, zoneName: string) => void;
  /** 리플레이 트리거 키 */
  runKey: number;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

interface RockSpec {
  points: NormalizedPoint[];
  highlight: NormalizedPoint[];
  shadow: NormalizedPoint[];
  speckles: { x: number; y: number; r: number; dark: boolean }[];
}

interface StackedStone {
  id: number;
  type: StoneTypeId;
  kg: number;
  width: number;
  height: number;
  color: string;
  stroke: string;
  stability: number;
  /** 바로 아래 돌 중심 기준 상대 X 오프셋 */
  offsetFromBelow: number;
  /** 받침대 바위 중심 기준 누적 X 오프셋 */
  cumOffsetX: number;
  /** 바위 윗면(=0)으로부터 위로 쌓인 중심 Y (음수) */
  localY: number;
  /** 착지 시 미세 기울기 */
  baseTilt: number;
  settleAnim: number;
  variant: number;
}

interface FallingStone {
  id: number;
  type: StoneTypeId;
  kg: number;
  width: number;
  height: number;
  color: string;
  stroke: string;
  stability: number;
  x: number;
  /** 바위 윗면(=0) 기준 월드 Y */
  worldY: number;
  angle: number;
  variant: number;
}

interface TumblingStone {
  body: Matter.Body;
  type: StoneTypeId;
  width: number;
  height: number;
  color: string;
  stroke: string;
  variant: number;
  countsAsMiss: boolean;
}

interface DustPebble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  color: string;
}

interface WaterSplash {
  x: number;
  y: number;
  age: number;
  droplets: { dx: number; dy: number; r: number }[];
}

interface ScorePopup {
  x: number;
  y: number;
  text: string;
  age: number;
  tone: 'perfect' | 'good' | 'warn' | 'bad';
}

/**
 * 현실적인 자연석 윤곽선·암석 면·화강암 반점 생성기
 */
function buildNaturalRockSpec(type: StoneTypeId, variant: number): RockSpec {
  const flip = variant % 2 === 0 ? 1 : -1;
  const j = ((variant * 19) % 7) * 0.01 - 0.03;

  let raw: [number, number][];
  let hi: [number, number][];
  let sh: [number, number][];

  if (type === 'flat') {
    raw = [
      [-0.45, -0.32],
      [-0.22, -0.48 + j * 0.4],
      [0.16, -0.47],
      [0.44, -0.29],
      [0.5, 0.05],
      [0.46, 0.37],
      [0.24, 0.49],
      [-0.24, 0.49],
      [-0.46, 0.36],
      [-0.5, -0.02],
    ];
    hi = [
      [-0.36, -0.25],
      [-0.18, -0.39],
      [0.16, -0.38],
      [0.34, -0.2],
      [0.06, -0.11],
      [-0.26, -0.12],
    ];
    sh = [
      [-0.43, 0.25],
      [0.12, 0.2],
      [0.44, 0.14],
      [0.43, 0.36],
      [0.23, 0.46],
      [-0.23, 0.47],
    ];
  } else if (type === 'cobble') {
    raw = [
      [-0.4, -0.27],
      [-0.15, -0.49],
      [0.18, -0.44 + j],
      [0.44, -0.16],
      [0.48, 0.2],
      [0.29, 0.47],
      [-0.2, 0.48],
      [-0.46, 0.33],
      [-0.49, 0.02],
    ];
    hi = [
      [-0.3, -0.2],
      [-0.11, -0.38],
      [0.16, -0.32],
      [0.05, -0.06],
      [-0.23, -0.04],
    ];
    sh = [
      [-0.22, 0.28],
      [0.2, 0.22],
      [0.44, 0.17],
      [0.27, 0.44],
      [-0.19, 0.45],
    ];
  } else if (type === 'angular') {
    raw = [
      [-0.24, -0.49],
      [0.15, -0.45],
      [0.44, -0.14 + j],
      [0.49, 0.24],
      [0.32, 0.48],
      [-0.18, 0.49],
      [-0.46, 0.36],
      [-0.48, -0.04],
      [-0.37, -0.34],
    ];
    hi = [
      [-0.21, -0.43],
      [0.11, -0.38],
      [0.22, -0.06],
      [-0.14, -0.04],
      [-0.36, -0.18],
    ];
    sh = [
      [0.15, -0.02],
      [0.46, 0.22],
      [0.3, 0.45],
      [-0.16, 0.46],
      [-0.36, 0.33],
      [0.02, 0.22],
    ];
  } else {
    // 화강암 소원돌 (위가 살짝 좁고 묵직한 자연 바위)
    raw = [
      [-0.31, -0.37],
      [-0.08, -0.5],
      [0.16, -0.47],
      [0.36, -0.31],
      [0.48, -0.03],
      [0.47, 0.25],
      [0.32, 0.44],
      [0.06, 0.49],
      [-0.24, 0.47],
      [-0.44, 0.32],
      [-0.49, 0.05],
      [-0.43, -0.2],
    ];
    hi = [
      [-0.24, -0.3],
      [-0.06, -0.42],
      [0.15, -0.36],
      [0.11, -0.1],
      [-0.19, -0.08],
      [-0.34, -0.15],
    ];
    sh = [
      [-0.18, 0.26],
      [0.22, 0.2],
      [0.44, 0.14],
      [0.3, 0.41],
      [0.05, 0.46],
      [-0.24, 0.44],
    ];
  }

  const mapPt = ([x, y]: [number, number]): NormalizedPoint => ({
    x: x * flip,
    y,
  });

  const speckles = Array.from({ length: type === 'boulder' ? 10 : 6 }, (_, i) => {
    const a = ((variant + 1) * 37 + i * 71) % 100;
    const b = ((variant + 3) * 53 + i * 43) % 100;
    return {
      x: ((a / 100) * 0.62 - 0.31) * flip,
      y: (b / 100) * 0.6 - 0.28,
      r: 1.0 + (i % 3) * 0.55,
      dark: i % 3 !== 0,
    };
  });

  return {
    points: raw.map(mapPt),
    highlight: hi.map(mapPt),
    shadow: sh.map(mapPt),
    speckles,
  };
}

function tracePoly(
  ctx: CanvasRenderingContext2D,
  pts: NormalizedPoint[],
  w: number,
  h: number
) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x * w, pts[0].y * h);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x * w, pts[i].y * h);
  }
  ctx.closePath();
}

function drawRock(
  ctx: CanvasRenderingContext2D,
  type: StoneTypeId,
  w: number,
  h: number,
  color: string,
  stroke: string,
  variant: number,
  customImg?: HTMLImageElement
) {
  if (customImg && customImg.complete) {
    ctx.drawImage(customImg, -w / 2, -h / 2, w, h);
    return;
  }

  const spec = buildNaturalRockSpec(type, variant);

  ctx.fillStyle = color;
  ctx.lineJoin = 'round';
  tracePoly(ctx, spec.points, w, h);
  ctx.fill();

  ctx.save();
  tracePoly(ctx, spec.points, w, h);
  ctx.clip();

  ctx.fillStyle = 'rgba(255, 252, 245, 0.24)';
  tracePoly(ctx, spec.highlight, w, h);
  ctx.fill();

  ctx.fillStyle = 'rgba(28, 25, 22, 0.2)';
  tracePoly(ctx, spec.shadow, w, h);
  ctx.fill();

  for (const sp of spec.speckles) {
    ctx.fillStyle = sp.dark
      ? 'rgba(38, 34, 30, 0.25)'
      : 'rgba(255, 250, 240, 0.28)';
    ctx.beginPath();
    ctx.arc(sp.x * w, sp.y * h, sp.r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (type === 'flat' || type === 'angular') {
    ctx.strokeStyle = 'rgba(48, 43, 38, 0.22)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(-w * 0.26, h * 0.05);
    ctx.lineTo(w * 0.2, h * (type === 'flat' ? 0.09 : -0.1));
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  tracePoly(ctx, spec.points, w, h);
  ctx.stroke();
}

/** 층수에 따라 돌 종류 선택 (처음엔 넓고 안정적인 판석 위주 -> 갈수록 각진 돌·화강암 비중 증가) */
function pickStoneTypeForLayer(layerIndex: number): StoneTypeId {
  if (layerIndex <= 2) {
    return Math.random() < 0.68 ? 'flat' : 'cobble';
  }
  if (layerIndex <= 6) {
    const r = Math.random();
    if (r < 0.34) return 'flat';
    if (r < 0.66) return 'cobble';
    if (r < 0.88) return 'angular';
    return 'boulder';
  }
  const r = Math.random();
  if (r < 0.22) return 'flat';
  if (r < 0.46) return 'cobble';
  if (r < 0.74) return 'angular';
  return 'boulder';
}

/** 층수가 높아질수록 처음엔 넓었다가 점진적으로 작아지는 돌 크기 계산 */
function createStoneMetrics(layerIndex: number, type: StoneTypeId) {
  const { taper, stoneTypes } = GAME_CONFIG;
  const def = stoneTypes[type];

  const rawBaseW = Math.max(
    taper.minWidth,
    taper.startWidth - layerIndex * taper.widthStepPerLayer
  );
  const rawBaseH = Math.max(
    taper.minHeight,
    taper.startHeight - layerIndex * taper.heightStepPerLayer
  );

  // 같은 층에서도 자연스러운 ±5% 변화
  const jitter = 0.95 + Math.random() * 0.1;
  const width = Math.max(32, Math.round(rawBaseW * def.widthScale * jitter));
  const height = Math.max(18, Math.round(rawBaseH * def.heightScale * jitter));
  const sizeRatio = width / taper.startWidth;
  const kg = Math.max(3, Math.round(def.baseKg * (0.55 + sizeRatio * 0.65)));

  return {
    type,
    width,
    height,
    kg,
    color: def.color,
    stroke: def.stroke,
    stability: def.stability,
  };
}

export function StoneTowerGame({
  mode,
  onGameOver,
  onZoneChange,
  runKey,
}: StoneTowerGameProps) {
  const [layers, setLayers] = useState(0);
  const [heightCm, setHeightCm] = useState(0);
  const [endReasonUI, setEndReasonUI] = useState<'collapsed' | 'missed' | null>(null);
  const [zoneName, setZoneName] = useState<string>(ALTITUDE_ZONES[0].name);
  const [isDarkText, setIsDarkText] = useState<boolean>(ALTITUDE_ZONES[0].isDarkText);
  const [windDirUI, setWindDirUI] = useState<-1 | 0 | 1>(0);
  const [balanceRatioUI, setBalanceRatioUI] = useState<number>(0); // -1 ~ +1
  const [zoneBanner, setZoneBanner] = useState<string | null>(null);
  const [collapsingUI, setCollapsingUI] = useState<boolean>(false);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  const onZoneChangeRef = useRef(onZoneChange);
  onZoneChangeRef.current = onZoneChange;

  // 커스텀 이미지 프리로드
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    const entries: [string, string][] = [
      ['temple', ASSET_URLS.temple],
      ['pond', ASSET_URLS.pond],
      ['flat', ASSET_URLS.flatStone],
      ['cobble', ASSET_URLS.smallStone],
      ['angular', ASSET_URLS.angularStone],
      ['boulder', ASSET_URLS.roundBigStone],
    ];
    entries.forEach(([key, url]) => {
      if (!url) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onload = () => {
        imagesRef.current[key] = img;
      };
    });
  }, []);

  // 입력 상태 refs
  const pointerDownRef = useRef(false);
  const pointerLastXRef = useRef(0);
  const pointerStartYRef = useRef(0);
  const dragDeltaXRef = useRef(0);
  const fastDropRef = useRef(false);
  const hasMovedRef = useRef(false);
  const keyDirRef = useRef<-1 | 0 | 1>(0);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (modeRef.current !== 'playing') return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    soundEngine.unlock();
    pointerDownRef.current = true;
    pointerLastXRef.current = e.clientX;
    pointerStartYRef.current = e.clientY;
    fastDropRef.current = false;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointerDownRef.current || modeRef.current !== 'playing') return;
    e.preventDefault();
    const dx = e.clientX - pointerLastXRef.current;
    pointerLastXRef.current = e.clientX;
    dragDeltaXRef.current += dx;
    if (Math.abs(dx) > 1.5) hasMovedRef.current = true;

    if (e.clientY - pointerStartYRef.current > 46) {
      fastDropRef.current = true;
    } else if (e.clientY - pointerStartYRef.current < 22) {
      fastDropRef.current = false;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    pointerDownRef.current = false;
    fastDropRef.current = false;
  }, []);

  // 키보드 방향키 지원
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (modeRef.current !== 'playing') return;
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keyDirRef.current = -1;
        hasMovedRef.current = true;
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keyDirRef.current = 1;
        hasMovedRef.current = true;
      } else if (e.key === 'ArrowDown') {
        fastDropRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (
        (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') &&
        keyDirRef.current === -1
      ) {
        keyDirRef.current = 0;
      } else if (
        (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') &&
        keyDirRef.current === 1
      ) {
        keyDirRef.current = 0;
      } else if (e.key === 'ArrowDown') {
        fastDropRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // 메인 게임 루프 (runKey가 바뀔 때마다 깔끔하게 초기화)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const rect = wrapper.getBoundingClientRect();
    const W = Math.max(300, Math.floor(rect.width));
    const H = Math.max(480, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = W * dpr;
    canvas.height = H * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // UI 초기화
    setLayers(0);
    setHeightCm(0);
    setEndReasonUI(null);
    setZoneName(ALTITUDE_ZONES[0].name);
    setIsDarkText(ALTITUDE_ZONES[0].isDarkText);
    setWindDirUI(0);
    setBalanceRatioUI(0);
    setZoneBanner(null);
    setCollapsingUI(false);
    hasMovedRef.current = false;
    onZoneChangeRef.current?.(ALTITUDE_ZONES[0].isDarkText, ALTITUDE_ZONES[0].name);

    const pondSurfaceY = H - 68;
    const baseRockWidth = Math.min(
      GAME_CONFIG.baseRockMaxWidth,
      W * GAME_CONFIG.baseRockWidthRatio
    );
    const baseRockHeight = GAME_CONFIG.baseRockHeight;
    const baseTopScreenY = pondSurfaceY - baseRockHeight + 6;
    const minBaseX = baseRockWidth / 2 + 12;
    const maxBaseX = W - baseRockWidth / 2 - 12;

    // 높이 올라갈수록 지나가는 구름 (탑 기준 고도에 고정, 아래로 흘러감)
    const clouds = Array.from({ length: 16 }, (_, i) => ({
      alt: 700 + i * 340 + ((i * 137) % 120),
      x: ((i * 233) % 100) / 100,
      scale: 0.7 + ((i * 71) % 50) / 100,
      drift: 5 + (i % 4) * 3,
    }));

    // Matter.js 엔진 (쓰러지는 돌탑 & 빗나간 돌의 실제 강체 충돌)
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.35, scale: 0.001 },
    });
    const world = engine.world;

    const baseRockBody = Matter.Bodies.rectangle(
      W / 2,
      baseTopScreenY + baseRockHeight / 2,
      baseRockWidth,
      baseRockHeight,
      {
        isStatic: true,
        friction: 0.85,
        restitution: 0.14,
      }
    );
    Matter.World.add(world, baseRockBody);

    // 게임 런타임 상태
    let baseX = W / 2;
    let baseVx = 0;
    let prevBaseVx = 0;

    // 돌탑 균형 각도(라디안) 및 각속도 (아이스크림 높이 쌓기 물리 핵심)
    let towerTilt = 0;
    let towerTiltVel = 0;
    let cameraOffsetY = 0;

    let stackedStones: StackedStone[] = [];
    let activeFalling: FallingStone | null = null;
    let tumblingStones: TumblingStone[] = [];
    let dustPebbles: DustPebble[] = [];
    let splashes: WaterSplash[] = [];
    let popups: ScorePopup[] = [];

    let nextId = 1;
    let fallRange = { lo: 30, hi: W - 30 };
    let currentZoneId = ALTITUDE_ZONES[0].id;
    let currentDarkText = ALTITUDE_ZONES[0].isDarkText;
    let windDir: -1 | 0 | 1 = 0;
    let windStrength = 0;
    let windOffset = 0;
    let waitSpawnTimer = 0;
    let peakLayers = 0;
    let peakHeightCm = 0;

    let playPhase: 'idle' | 'falling' | 'waitNext' | 'collapsing' | 'ended' =
      modeRef.current === 'playing' ? 'waitNext' : 'idle';
    let collapseTimer = 0;
    let endReason: 'collapsed' | 'missed' = 'collapsed';

    const worldToScreenY = (worldY: number) =>
      baseTopScreenY + worldY + cameraOffsetY;

    const getTowerHeightPx = () => {
      if (stackedStones.length === 0) return 0;
      const top = stackedStones[stackedStones.length - 1];
      return Math.abs(top.localY) + top.height * 0.45;
    };

    /**
     * 돌탑 기울기(towerTilt)를 적용해 i번째 돌의 화면상 (x, y) 좌표를 계산합니다.
     * 아래층일수록 바위에 단단히 붙어 있고, 위로 갈수록 회전 반경에 따라 크게 기웁니다.
     */
    const getStoneScreenTransform = (stone: StackedStone, index: number) => {
      const heightFromBase = Math.abs(stone.localY);
      const localAngle =
        towerTilt * (0.35 + (index / Math.max(1, stackedStones.length)) * 0.95);
      const leanShiftX = Math.sin(towerTilt) * heightFromBase * 1.15;
      const leanDropY = (1 - Math.cos(towerTilt)) * heightFromBase * 0.45;
      return {
        x: baseX + stone.cumOffsetX + leanShiftX,
        y: worldToScreenY(stone.localY) + leanDropY,
        angle: stone.baseTilt + localAngle,
      };
    };

    const getCriticalTiltRad = (count: number) => {
      const { baseCriticalTiltRad, minCriticalTiltRad } = GAME_CONFIG.balance;
      return Math.max(
        minCriticalTiltRad,
        baseCriticalTiltRad - count * TUNING.criticalTiltShrinkPerLayer
      );
    };

    const getTowerHeightCm = () => Math.round(getTowerHeightPx() * TUNING.cmPerPx);

    /**
     * 받침대를 끝까지 옮겼을 때 맨 위 돌이 닿을 수 있는 범위 안에서만 돌이 떨어지게 함.
     * 화면 밖으로 삐져나오지 않게 돌 폭의 절반만큼 안쪽으로 둠.
     */
    const getReachableRange = (stoneWidth: number) => {
      const top = stackedStones.length > 0 ? stackedStones[stackedStones.length - 1] : null;
      const topCum = top ? top.cumOffsetX : 0;
      const pad = 10;
      const screenMin = stoneWidth / 2 + pad;
      const screenMax = W - stoneWidth / 2 - pad;
      const reachMin = minBaseX + topCum + 10;
      const reachMax = maxBaseX + topCum - 10;
      let lo = Math.max(screenMin, reachMin);
      let hi = Math.min(screenMax, reachMax);
      if (lo > hi) {
        lo = screenMin;
        hi = screenMax;
      }
      return { lo, hi };
    };

    /** 돌을 놓치면 바로 게임 끝 */
    const endByMiss = (x: number, y: number) => {
      if (playPhase === 'collapsing' || playPhase === 'ended') return;
      addPopup(x, y - 20, '돌을 놓쳤어요!', 'bad');
      endReason = 'missed';
      playPhase = 'collapsing';
      collapseTimer = 1.2;
      setEndReasonUI('missed');
      setCollapsingUI(true);
    };

    const spawnDust = (x: number, y: number, count: number, color: string) => {
      for (let i = 0; i < count; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 25 + Math.random() * 65;
        dustPebbles.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd - 20,
          r: 1.5 + Math.random() * 2.2,
          age: 0,
          color,
        });
      }
    };

    const addSplash = (x: number) => {
      const droplets = Array.from({ length: 9 }, (_, i) => {
        const ang = -Math.PI * (0.14 + (i / 8) * 0.72);
        const spd = 2.4 + Math.random() * 2.6;
        return {
          dx: Math.cos(ang) * spd,
          dy: Math.sin(ang) * spd,
          r: 2.3 + Math.random() * 2.4,
        };
      });
      splashes.push({ x, y: pondSurfaceY, age: 0, droplets });
    };

    const addPopup = (
      x: number,
      y: number,
      text: string,
      tone: ScorePopup['tone']
    ) => {
      popups.push({ x, y, text, age: 0, tone });
    };

    const pushToMatter = (
      x: number,
      screenY: number,
      width: number,
      height: number,
      type: StoneTypeId,
      color: string,
      stroke: string,
      variant: number,
      vx: number,
      vy: number,
      angVel: number,
      countsAsMiss: boolean
    ) => {
      const body = Matter.Bodies.rectangle(x, screenY, width * 0.85, height * 0.82, {
        friction: 0.6,
        restitution: 0.16,
        chamfer: { radius: 6 },
        density: 0.0028,
      });
      Matter.Body.setVelocity(body, { x: vx, y: vy });
      Matter.Body.setAngularVelocity(body, angVel);
      Matter.World.add(world, body);
      tumblingStones.push({
        body,
        type,
        width,
        height,
        color,
        stroke,
        variant,
        countsAsMiss,
      });
    };

    /**
     * 돌탑 붕괴! collapseFromIndex 이상의 모든 돌을 Matter.js 동적 물체로 전환해 와르르 무너뜨림
     */
    const triggerTowerCollapse = (collapseFromIndex: number, leanDir: number) => {
      if (playPhase === 'collapsing' || playPhase === 'ended') return;

      const dir = leanDir >= 0 ? 1 : -1;
      const fallen = stackedStones.slice(collapseFromIndex);
      stackedStones = stackedStones.slice(0, collapseFromIndex);

      soundEngine.playTowerCollapse(fallen.length);

      fallen.forEach((st, idx) => {
        const tf = getStoneScreenTransform(st, collapseFromIndex + idx);
        const speedSpread = 1.6 + idx * 0.55 + Math.random() * 1.1;
        pushToMatter(
          tf.x,
          tf.y,
          st.width,
          st.height,
          st.type,
          st.color,
          st.stroke,
          st.variant,
          dir * speedSpread,
          -0.6 - Math.random() * 1.4,
          dir * (0.08 + Math.random() * 0.14),
          false
        );
        spawnDust(tf.x, tf.y, 4, st.color);
      });

      if (activeFalling) {
        const sy = worldToScreenY(activeFalling.worldY);
        pushToMatter(
          activeFalling.x,
          sy,
          activeFalling.width,
          activeFalling.height,
          activeFalling.type,
          activeFalling.color,
          activeFalling.stroke,
          activeFalling.variant,
          dir * 1.2,
          1.5,
          dir * 0.08,
          false
        );
        activeFalling = null;
      }

      addPopup(W / 2, H * 0.36, '돌탑이 무너졌어요!', 'bad');
      endReason = 'collapsed';
      playPhase = 'collapsing';
      collapseTimer = 1.65;
      setEndReasonUI('collapsed');
      setCollapsingUI(true);
    };

    const spawnNextStone = () => {
      if (modeRef.current !== 'playing') return;

      const layerIdx = stackedStones.length;
      const type = pickStoneTypeForLayer(layerIdx);
      const metrics = createStoneMetrics(layerIdx, type);

      // 받침대로 받을 수 있고 화면 안에 다 보이는 범위에서만 낙하
      fallRange = getReachableRange(metrics.width);
      const minX = fallRange.lo;
      const maxX = fallRange.hi;
      const rangeCenter = (minX + maxX) / 2;

      let spawnX: number;
      if (layerIdx === 0) {
        spawnX = rangeCenter + (Math.random() - 0.5) * 60;
      } else {
        // 처음엔 가운데 근처, 층이 올라갈수록 좌우로 넓게
        const spreadFactor = Math.min(
          1,
          TUNING.spawnSpreadStart + layerIdx * TUNING.spawnSpreadPerLayer
        );
        const halfSpread = ((maxX - minX) / 2) * spreadFactor;
        let candidate = rangeCenter + (Math.random() * 2 - 1) * halfSpread;

        if (layerIdx >= TUNING.pushAwayFromLayer && Math.abs(candidate - baseX) < 42) {
          const push = 62 + Math.random() * 58;
          candidate =
            baseX < W / 2
              ? Math.min(maxX, baseX + push)
              : Math.max(minX, baseX - push);
        }
        spawnX = candidate;
      }
      spawnX = Math.max(minX, Math.min(maxX, spawnX));

      // 바람 (원래 시작 층보다 TUNING.windDelayLayers만큼 늦게 등장, 고층일수록 강하고 잦아짐)
      const { fall } = GAME_CONFIG;
      const windStart = fall.windStartLayer + TUNING.windDelayLayers;
      const windProgress = Math.min(1, Math.max(0, (layerIdx - windStart) / 16));
      const windChance =
        fall.baseWindChance +
        (fall.maxWindChance - fall.baseWindChance) * windProgress;

      if (layerIdx >= windStart && Math.random() < windChance) {
        windDir = Math.random() < 0.5 ? -1 : 1;
        windStrength =
          fall.baseWindPushPxPerSec +
          (fall.maxWindPushPxPerSec - fall.baseWindPushPxPerSec) * windProgress;
      } else {
        windDir = 0;
        windStrength = 0;
      }
      setWindDirUI(windDir);

      const spawnWorldY = -(baseTopScreenY + cameraOffsetY) + 32;

      activeFalling = {
        id: nextId++,
        ...metrics,
        x: spawnX,
        worldY: spawnWorldY,
        angle: (Math.random() - 0.5) * 0.08,
        variant: nextId,
      };
      fastDropRef.current = false;
      playPhase = 'falling';
    };

    let lastTime = performance.now();
    const startTime = lastTime;
    let rafId = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - lastTime) / 1000);
      lastTime = now;
      const timeSec = (now - startTime) / 1000;

      if (modeRef.current === 'playing' && playPhase === 'idle') {
        playPhase = 'waitNext';
        waitSpawnTimer = 0.25;
      }

      // 1) 받침대 바위 좌우 이동 (조작)
      const prevBaseX = baseX;

      if (
        modeRef.current === 'playing' &&
        (playPhase === 'falling' || playPhase === 'waitNext')
      ) {
        const dragDx = dragDeltaXRef.current;
        dragDeltaXRef.current = 0;
        const keyDx = keyDirRef.current * 285 * dt;
        baseX = Math.max(minBaseX, Math.min(maxBaseX, baseX + dragDx + keyDx));
      } else {
        dragDeltaXRef.current = 0;
      }

      baseVx = (baseX - prevBaseX) / Math.max(0.001, dt);
      const baseAx = (baseVx - prevBaseVx) / Math.max(0.001, dt);
      prevBaseVx = baseVx;

      // 2) 돌탑 균형 물리 시뮬레이션 (정적 무게중심 토크 + 받침대 이동 관성)
      if (
        modeRef.current === 'playing' &&
        stackedStones.length >= 1 &&
        (playPhase === 'falling' || playPhase === 'waitNext')
      ) {
        const bal = GAME_CONFIG.balance;
        const count = stackedStones.length;

        let weightedOffset = 0;
        let totalWeight = 0;
        for (let i = 0; i < count; i++) {
          const st = stackedStones[i];
          const lever = 0.65 + (i / Math.max(1, count)) * 1.15;
          const w = (st.kg * lever) / st.stability;
          weightedOffset += st.cumOffsetX * w;
          totalWeight += w;
        }
        const avgComOffset = totalWeight > 0 ? weightedOffset / totalWeight : 0;

        const heightScale = 1 + count * 0.14;
        const springK = Math.max(
          bal.minSpringK,
          bal.baseSpringK - count * 0.42
        );

        const comTorque = avgComOffset * bal.comTorqueStrength * heightScale;
        const accelTorque =
          -Math.max(-2400, Math.min(2400, baseAx)) *
          bal.baseAccelSwayFactor *
          TUNING.accelSwayMult *
          Math.min(2.6, 0.5 + count * 0.16);
        const windTorque =
          windDir * (count >= 6 ? 0.065 * Math.min(2.2, count / 10) : 0);

        const gravityTip = Math.sin(towerTilt) * (1.8 + count * 0.32);

        const angularAccel =
          comTorque +
          accelTorque +
          windTorque +
          gravityTip -
          towerTilt * springK -
          towerTiltVel * bal.damping;

        towerTiltVel += angularAccel * dt;
        towerTilt += towerTiltVel * dt;

        const critRad = getCriticalTiltRad(count);
        const normBalance = Math.max(-1, Math.min(1, towerTilt / critRad));
        setBalanceRatioUI(normBalance);

        if (Math.abs(normBalance) > 0.68 && count >= 2) {
          soundEngine.playStoneCreak();
          if (Math.random() < 0.25) {
            const topSt = stackedStones[count - 1];
            const tf = getStoneScreenTransform(topSt, count - 1);
            spawnDust(tf.x, tf.y + topSt.height * 0.4, 1, topSt.color);
          }
        }

        if (Math.abs(towerTilt) >= critRad && count >= 2) {
          const breakIdx = Math.max(0, Math.floor(count * 0.2));
          triggerTowerCollapse(breakIdx, Math.sign(towerTilt));
        }
      } else if (stackedStones.length === 0) {
        towerTilt *= 0.9;
        towerTiltVel *= 0.9;
        setBalanceRatioUI(0);
      }

      // 3) 카메라 부드러운 상승
      const towerH = getTowerHeightPx();
      const targetCamY = Math.max(0, towerH - H * 0.26);
      cameraOffsetY += (targetCamY - cameraOffsetY) * Math.min(1, dt * 4.2);

      Matter.Body.setPosition(baseRockBody, {
        x: baseX,
        y: baseTopScreenY + cameraOffsetY + baseRockHeight / 2,
      });

      for (const st of stackedStones) {
        if (st.settleAnim > 0) {
          st.settleAnim = Math.max(0, st.settleAnim - dt * 5.2);
        }
      }

      // 4) 떨어지는 돌 이동 및 착지/균형 판정
      if (playPhase === 'waitNext') {
        waitSpawnTimer -= dt;
        if (waitSpawnTimer <= 0) {
          spawnNextStone();
        }
      } else if (playPhase === 'falling' && activeFalling) {
        const { fall, balance } = GAME_CONFIG;
        const layerIdx = stackedStones.length;
        const speedRamp = Math.min(1, layerIdx / TUNING.fallSpeedRampLayers);
        const speedMult =
          TUNING.fallSpeedStartMult + (1 - TUNING.fallSpeedStartMult) * speedRamp;
        const baseSpeed =
          Math.min(
            fall.maxSpeedPxPerSec,
            fall.baseSpeedPxPerSec + layerIdx * fall.speedIncreasePerLayer
          ) * speedMult;
        const vy = fastDropRef.current
          ? baseSpeed * fall.fastDropMultiplier
          : baseSpeed;

        activeFalling.worldY += vy * dt;

        if (windDir !== 0) {
          // 바람에 밀려도 받침대로 받을 수 있는 범위·화면 안에서만 움직임
          activeFalling.x = Math.max(
            fallRange.lo,
            Math.min(fallRange.hi, activeFalling.x + windDir * windStrength * dt)
          );
        }

        const hasStack = stackedStones.length > 0;
        const topStone = hasStack
          ? stackedStones[stackedStones.length - 1]
          : null;
        const topTransform = topStone
          ? getStoneScreenTransform(topStone, stackedStones.length - 1)
          : { x: baseX, y: baseTopScreenY + cameraOffsetY, angle: 0 };

        const supportTopWorldY = topStone
          ? topStone.localY - topStone.height * 0.43
          : 0;
        const supportCenterX = topTransform.x;
        const supportWidth = topStone ? topStone.width : baseRockWidth;
        const supportHalfW = supportWidth * balance.catchSupportRatio;

        const fallingBottomWorldY =
          activeFalling.worldY + activeFalling.height * 0.44;

        if (fallingBottomWorldY >= supportTopWorldY) {
          const offsetX = activeFalling.x - supportCenterX;
          const absOffset = Math.abs(offsetX);
          const catchHalfLimit =
            (supportHalfW * (topStone ? topStone.stability : 1.0) +
              activeFalling.width * 0.18) *
            TUNING.catchWidthBonus;

          if (absOffset <= catchHalfLimit) {
            const offsetRatio = absOffset / Math.max(18, supportWidth * 0.5);
            const isPerfect = offsetRatio <= balance.perfectRatio;

            const prevCumOffset = topStone ? topStone.cumOffsetX : 0;
            const nextCumOffset = prevCumOffset + offsetX;
            const newLocalY = supportTopWorldY - activeFalling.height * 0.43;

            const newStone: StackedStone = {
              id: activeFalling.id,
              type: activeFalling.type,
              kg: activeFalling.kg,
              width: activeFalling.width,
              height: activeFalling.height,
              color: activeFalling.color,
              stroke: activeFalling.stroke,
              stability: activeFalling.stability,
              offsetFromBelow: offsetX,
              cumOffsetX: nextCumOffset,
              localY: newLocalY,
              baseTilt:
                (offsetX / Math.max(20, supportWidth * 0.5)) *
                (activeFalling.type === 'boulder' ? 0.09 : 0.045),
              settleAnim: 1,
              variant: activeFalling.variant,
            };

            const candidateStack = [...stackedStones, newStone];

            // 서브스택 무게중심 붕괴 검사
            let failPivotIdx = -1;
            let failDir = Math.sign(offsetX || 1);

            for (let k = candidateStack.length - 2; k >= 0; k--) {
              const supportSt = candidateStack[k];
              let subWeightedX = 0;
              let subTotalKg = 0;
              for (let j = k + 1; j < candidateStack.length; j++) {
                subWeightedX += candidateStack[j].cumOffsetX * candidateStack[j].kg;
                subTotalKg += candidateStack[j].kg;
              }
              const subComX = subWeightedX / Math.max(1, subTotalKg);
              const overhangFromK = subComX - supportSt.cumOffsetX;
              const limit =
                supportSt.width *
                balance.subStackOverhangLimit *
                supportSt.stability;

              if (Math.abs(overhangFromK) > limit) {
                failPivotIdx = k + 1;
                failDir = Math.sign(overhangFromK);
                break;
              }
            }

            if (failPivotIdx === -1 && candidateStack.length >= 2) {
              let allX = 0;
              let allKg = 0;
              for (const s of candidateStack) {
                allX += s.cumOffsetX * s.kg;
                allKg += s.kg;
              }
              const totalComX = allX / Math.max(1, allKg);
              if (Math.abs(totalComX) > baseRockWidth * 0.46) {
                failPivotIdx = 0;
                failDir = Math.sign(totalComX);
              }
            }

            const sizeRatio = activeFalling.width / GAME_CONFIG.taper.startWidth;
            soundEngine.playStoneClack(sizeRatio, isPerfect);

            if (failPivotIdx !== -1) {
              const fallingCount = candidateStack.length - failPivotIdx;
              if (fallingCount >= 2 || stackedStones.length >= 3) {
                // 2개 이상(또는 고층 균형 붕괴) -> 돌탑 전체 와르르 붕괴!
                stackedStones = candidateStack;
                activeFalling = null;
                triggerTowerCollapse(Math.min(failPivotIdx, Math.max(0, stackedStones.length - 3)), failDir);
              } else {
                // 방금 올린 맨 위 돌 1개만 모서리에서 미끄러짐 -> 놓친 것으로 보고 바로 게임 끝
                const sy = worldToScreenY(activeFalling.worldY);
                pushToMatter(
                  activeFalling.x,
                  sy,
                  activeFalling.width,
                  activeFalling.height,
                  activeFalling.type,
                  activeFalling.color,
                  activeFalling.stroke,
                  activeFalling.variant,
                  failDir * 2.8,
                  -0.6,
                  failDir * 0.14,
                  true
                );
                towerTiltVel += failDir * 0.24;
                const slipX = activeFalling.x;
                activeFalling = null;
                endByMiss(slipX, sy);
              }
            } else {
              const prevHeightCm = getTowerHeightCm();
              stackedStones = candidateStack;
              activeFalling = null;

              const newLayers = stackedStones.length;
              const newHeightCm = getTowerHeightCm();
              const gainCm = Math.max(1, newHeightCm - prevHeightCm);
              peakLayers = Math.max(peakLayers, newLayers);
              peakHeightCm = Math.max(peakHeightCm, newHeightCm);
              setLayers(newLayers);
              setHeightCm(newHeightCm);

              if (isPerfect) {
                towerTiltVel *= 0.45;
                towerTilt *= 0.72;
                spawnDust(
                  topTransform.x,
                  worldToScreenY(supportTopWorldY),
                  7,
                  '#F8DC88'
                );
                addPopup(
                  topTransform.x,
                  worldToScreenY(newLocalY) - 24,
                  `완벽! +${gainCm}cm`,
                  'perfect'
                );
              } else {
                const kick =
                  (offsetX / Math.max(22, supportWidth * 0.5)) *
                  0.22 *
                  balance.edgeTorqueMultiplier *
                  (1 + newLayers * 0.05);
                towerTiltVel += kick;
                spawnDust(
                  newStone.cumOffsetX + baseX,
                  worldToScreenY(supportTopWorldY),
                  5,
                  newStone.color
                );
                addPopup(
                  topTransform.x + offsetX * 0.5,
                  worldToScreenY(newLocalY) - 22,
                  offsetRatio > 0.65 ? `아슬아슬 +${gainCm}cm` : `+${gainCm}cm`,
                  offsetRatio > 0.65 ? 'warn' : 'good'
                );
              }

              const nextZone = getZoneForLayer(newLayers);
              if (nextZone.id !== currentZoneId) {
                currentZoneId = nextZone.id;
                currentDarkText = nextZone.isDarkText;
                setZoneName(nextZone.name);
                setIsDarkText(nextZone.isDarkText);
                onZoneChangeRef.current?.(nextZone.isDarkText, nextZone.name);
                soundEngine.playTempleBell();
                setZoneBanner(nextZone.name);
                window.setTimeout(() => setZoneBanner(null), 1700);
              }

              playPhase = 'waitNext';
              waitSpawnTimer = 0.32;
            }
          } else if (fallingBottomWorldY >= supportTopWorldY + 10) {
            const dir = Math.sign(offsetX || 1);
            const sy = worldToScreenY(activeFalling.worldY);
            pushToMatter(
              activeFalling.x,
              sy,
              activeFalling.width,
              activeFalling.height,
              activeFalling.type,
              activeFalling.color,
              activeFalling.stroke,
              activeFalling.variant,
              dir * 1.1,
              2.6,
              dir * 0.08,
              true
            );
            const missX = activeFalling.x;
            activeFalling = null;
            endByMiss(missX, sy);
          }
        }
      } else if (playPhase === 'collapsing') {
        collapseTimer -= dt;
        if (collapseTimer <= 0) {
          playPhase = 'ended';
          const finalZone = getZoneForLayer(peakLayers);
          onGameOverRef.current({
            layers: peakLayers,
            heightCm: peakHeightCm,
            heightLabel: formatHeight(peakHeightCm),
            zoneName: finalZone.name,
            endReason,
          });
        }
      }

      // 5) Matter.js 물리 업데이트
      Matter.Engine.update(engine, dt * 1000);

      const pondWaterScreenY = pondSurfaceY + cameraOffsetY;
      const splashLineY = Math.min(H + 10, pondWaterScreenY + 8);

      const aliveTumblers: TumblingStone[] = [];
      for (const t of tumblingStones) {
        if (t.body.position.y > splashLineY) {
          Matter.World.remove(world, t.body);
          if (pondWaterScreenY < H + 30) {
            addSplash(t.body.position.x);
          }
          soundEngine.playWaterSplash();
        } else {
          aliveTumblers.push(t);
        }
      }
      tumblingStones = aliveTumblers;

      // 6) 전체 화면 렌더링
      ctx.save();
      ctx.scale(dpr, dpr);

      renderTempleParallaxBackground(
        ctx,
        W,
        H,
        cameraOffsetY,
        pondSurfaceY,
        timeSec,
        imagesRef.current.temple,
        imagesRef.current.pond
      );

      // A-2. 탑이 높아질수록 하늘로 올라가는 연출
      //  - 절·연못은 카메라가 올라가며 아래로 사라지고
      //  - 화면이 점점 높은 하늘색 → 짙은 하늘로 바뀌며
      //  - 구름이 아래로 지나가고, 아주 높이 오르면 별이 보임
      const skyP = Math.min(1, Math.max(0, cameraOffsetY / TUNING.skyFullPx));
      if (skyP > 0) {
        const ease = skyP * skyP * (3 - 2 * skyP);
        const lerp = (a: number, b: number) => Math.round(a + (b - a) * skyP);
        const topR = lerp(120, 22);
        const topG = lerp(185, 38);
        const topB = lerp(240, 92);
        const botR = lerp(200, 70);
        const botG = lerp(230, 110);
        const botB = lerp(250, 190);
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, `rgba(${topR}, ${topG}, ${topB}, ${0.92 * ease})`);
        sky.addColorStop(1, `rgba(${botR}, ${botG}, ${botB}, ${0.55 * ease})`);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        if (skyP > 0.65) {
          const starA = (skyP - 0.65) / 0.35;
          ctx.fillStyle = `rgba(255, 250, 230, ${0.85 * starA})`;
          for (let i = 0; i < 40; i++) {
            const sx = ((i * 97) % 100) / 100 * W;
            const sy = (((i * 53) % 100) / 100) * H * 0.85;
            const tw = 0.6 + 0.4 * Math.sin(timeSec * 2 + i);
            ctx.beginPath();
            ctx.arc(sx, sy, (1 + (i % 3) * 0.5) * tw, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      for (const c of clouds) {
        const cy = baseTopScreenY - c.alt + cameraOffsetY * 0.9;
        if (cy < -90 || cy > H + 90) continue;
        const span = W + 220;
        const cx = (((c.x * span + timeSec * c.drift) % span) + span) % span - 110;
        const s = c.scale;
        ctx.save();
        ctx.fillStyle = `rgba(255, 255, 255, ${0.78 - skyP * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 46 * s, 18 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 30 * s, cy + 4 * s, 28 * s, 14 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 32 * s, cy + 3 * s, 30 * s, 15 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 6 * s, cy - 12 * s, 26 * s, 16 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // B. 바람 줄기
      if (windDir !== 0 && playPhase === 'falling') {
        windOffset += windDir * dt * 250;
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.58)';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const wy = 95 + i * 68;
          const wx =
            (((windOffset + i * 95) % (W + 120)) + (W + 120)) % (W + 120) - 60;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.quadraticCurveTo(wx + 26 * windDir, wy - 6, wx + 54 * windDir, wy);
          ctx.stroke();
        }
        ctx.restore();
      }

      // C. 떨어지는 돌 아래 은은한 가이드선
      if (playPhase === 'falling' && activeFalling) {
        const sy = worldToScreenY(activeFalling.worldY);
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = currentDarkText
          ? 'rgba(42, 38, 34, 0.2)'
          : 'rgba(255, 245, 214, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(activeFalling.x, sy + activeFalling.height * 0.46);
        ctx.lineTo(activeFalling.x, Math.min(H, pondWaterScreenY));
        ctx.stroke();
        ctx.restore();
      }

      // D. 움직이는 화강암 평석 받침대
      const baseScreenY = baseTopScreenY + cameraOffsetY;
      if (baseScreenY < H + 48) {
        ctx.save();
        ctx.translate(baseX, baseScreenY);

        ctx.fillStyle = 'rgba(24, 34, 48, 0.24)';
        ctx.beginPath();
        ctx.ellipse(0, baseRockHeight + 2, baseRockWidth * 0.56, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        const hw = baseRockWidth / 2;
        ctx.fillStyle = '#6B7177';
        ctx.strokeStyle = '#44494E';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(-hw + 10, 0);
        ctx.lineTo(hw - 10, 0);
        ctx.lineTo(hw + 4, 12);
        ctx.lineTo(hw + 1, baseRockHeight + 4);
        ctx.lineTo(-hw - 1, baseRockHeight + 4);
        ctx.lineTo(-hw - 4, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 윗면 평석 하이라이트
        ctx.fillStyle = '#899096';
        ctx.beginPath();
        ctx.moveTo(-hw + 12, 2);
        ctx.lineTo(hw - 12, 2);
        ctx.lineTo(hw - 4, 10);
        ctx.lineTo(-hw + 4, 10);
        ctx.closePath();
        ctx.fill();

        // 화강암 반점
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        for (let i = -3; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(i * 15, 16 + ((i * 7) % 6), 1.3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(28, 32, 36, 0.26)';
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(i * 21 + 6, 21 - ((i * 5) % 5), 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        if (
          modeRef.current === 'playing' &&
          !hasMovedRef.current &&
          playPhase === 'falling'
        ) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '13px "Jua", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('◀ 좌우로 드래그 ▶', 0, baseRockHeight + 19);
        }

        ctx.restore();
      }

      // E. 누적해서 위로 쌓인 돌탑
      for (let i = 0; i < stackedStones.length; i++) {
        const st = stackedStones[i];
        const tf = getStoneScreenTransform(st, i);
        if (tf.y > H + 90 || tf.y < -120) continue;

        const squashX = 1 + st.settleAnim * 0.055;
        const squashY = 1 - st.settleAnim * 0.065;

        ctx.save();
        ctx.translate(tf.x, tf.y);
        ctx.rotate(tf.angle);
        ctx.scale(squashX, squashY);
        drawRock(
          ctx,
          st.type,
          st.width,
          st.height,
          st.color,
          st.stroke,
          st.variant,
          imagesRef.current[st.type]
        );
        ctx.restore();
      }

      // F. 위에서 떨어지는 현재 돌
      if (activeFalling) {
        const sy = worldToScreenY(activeFalling.worldY);
        ctx.save();
        ctx.translate(activeFalling.x, sy);
        ctx.rotate(activeFalling.angle);
        drawRock(
          ctx,
          activeFalling.type,
          activeFalling.width,
          activeFalling.height,
          activeFalling.color,
          activeFalling.stroke,
          activeFalling.variant,
          imagesRef.current[activeFalling.type]
        );
        ctx.restore();
      }

      // G. 무너지거나 빗나가서 굴러 떨어지는 Matter.js 돌
      for (const t of tumblingStones) {
        ctx.save();
        ctx.translate(t.body.position.x, t.body.position.y);
        ctx.rotate(t.body.angle);
        drawRock(
          ctx,
          t.type,
          t.width,
          t.height,
          t.color,
          t.stroke,
          t.variant,
          imagesRef.current[t.type]
        );
        ctx.restore();
      }

      // H. 돌가루/조약돌 먼지 파티클
      const aliveDust: DustPebble[] = [];
      for (const d of dustPebbles) {
        d.age += dt;
        if (d.age < 0.55) {
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.vy += 180 * dt;
          ctx.globalAlpha = 1 - d.age / 0.55;
          ctx.fillStyle = d.color;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fill();
          aliveDust.push(d);
        }
      }
      ctx.globalAlpha = 1;
      dustPebbles = aliveDust;

      // I. 연못 물보라
      const aliveSplashes: WaterSplash[] = [];
      for (const sp of splashes) {
        sp.age += dt;
        if (sp.age < 0.65) {
          const alpha = 1 - sp.age / 0.65;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.92})`;
          for (const d of sp.droplets) {
            const px = sp.x + d.dx * sp.age * 42;
            const py =
              pondWaterScreenY +
              d.dy * sp.age * 42 +
              0.5 * 145 * sp.age * sp.age;
            ctx.beginPath();
            ctx.arc(px, py, d.r, 0, Math.PI * 2);
            ctx.fill();
          }
          aliveSplashes.push(sp);
        }
      }
      splashes = aliveSplashes;

      // J. 착지 피드백 팝업
      const alivePopups: ScorePopup[] = [];
      for (const p of popups) {
        p.age += dt;
        if (p.age < 0.9) {
          const alpha = 1 - p.age / 0.9;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font = p.tone === 'perfect' ? '17px "Jua", sans-serif' : '15px "Jua", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle =
            p.tone === 'bad'
              ? '#E04B4B'
              : p.tone === 'warn'
              ? '#D97B29'
              : p.tone === 'perfect'
              ? '#D48A1C'
              : currentDarkText
              ? '#245E52'
              : '#FFE082';
          ctx.fillText(p.text, p.x, p.y - p.age * 30);
          ctx.restore();
          alivePopups.push(p);
        }
      }
      popups = alivePopups;

      ctx.restore();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
    };
  }, [runKey]);

  const absBalance = Math.abs(balanceRatioUI);
  const balanceColor =
    absBalance > 0.72
      ? '#DF4C4C'
      : absBalance > 0.45
      ? '#E09236'
      : '#3A8F76';
  const balanceLabel =
    collapsingUI
      ? endReasonUI === 'missed'
        ? '놓쳤어요!'
        : '붕괴!'
      : absBalance > 0.72
      ? '위험!'
      : absBalance > 0.45
      ? '기울어짐'
      : '균형 안정';

  const hudBg = isDarkText
    ? 'rgba(255, 253, 248, 0.86)'
    : 'rgba(22, 32, 60, 0.78)';
  const hudBorder = isDarkText
    ? 'rgba(84, 72, 58, 0.14)'
    : 'rgba(255, 232, 178, 0.22)';
  const hudTextMain = isDarkText ? '#2A2520' : '#F7F4EA';
  const hudTextSub = isDarkText ? '#5C544B' : '#CBD3E8';

  return (
    <div ref={wrapperRef} className="game-touch-surface relative w-full h-full">
      {/* 풀스크린 한국 사찰 돌탑 캔버스 */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="game-touch-surface absolute inset-0 w-full h-full block cursor-grab active:cursor-grabbing"
      />

      {/* 플레이 중 상단 HUD */}
      {mode === 'playing' && (
        <div className="absolute top-3 left-3 right-16 z-20 pointer-events-none space-y-2">
          <div
            className="rounded-2xl px-3.5 py-2.5 flex items-center justify-between backdrop-blur-md transition-colors duration-500"
            style={{
              backgroundColor: hudBg,
              border: `1px solid ${hudBorder}`,
            }}
          >
            {/* 소원돌탑 높이 (메인 기록) & 층수 */}
            <div className="text-left">
              <p
                className="font-display text-lg tabular-nums leading-tight"
                style={{ color: hudTextMain }}
              >
                {formatHeight(heightCm)}{' '}
                <span className="text-sm font-body" style={{ color: hudTextSub }}>
                  · {layers}층
                </span>
              </p>
              <p className="text-[11px] leading-tight" style={{ color: hudTextSub }}>
                {zoneName}
                {windDirUI !== 0 && (
                  <span> · 바람 {windDirUI === -1 ? '←' : '→'}</span>
                )}
              </p>
            </div>

            {/* 균형계 */}
            <div className="w-[74px] flex flex-col items-end">
              <span
                className="text-[11px] font-display leading-none mb-1"
                style={{ color: balanceColor }}
              >
                {balanceLabel}
              </span>
              <div
                className="w-full h-2 rounded-full relative overflow-hidden"
                style={{
                  backgroundColor: isDarkText
                    ? 'rgba(50, 44, 38, 0.14)'
                    : 'rgba(255, 255, 255, 0.18)',
                }}
              >
                {/* 중앙선 */}
                <div
                  className="absolute top-0 bottom-0 left-1/2 w-[1.5px] -translate-x-1/2 opacity-40"
                  style={{ backgroundColor: hudTextMain }}
                />
                {/* 기울기 마커 */}
                <div
                  className="absolute top-0 bottom-0 w-3 rounded-full transition-colors duration-150"
                  style={{
                    left: `calc(${50 + balanceRatioUI * 42}% - 6px)`,
                    backgroundColor: balanceColor,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 한국 절 고도 구역 도달 알림 */}
      {mode === 'playing' && zoneBanner && (
        <div className="absolute inset-x-0 top-24 flex justify-center pointer-events-none z-20">
          <div
            className="px-4 py-1.5 rounded-2xl font-display text-base shadow-sm animate-float-up-fade backdrop-blur-md"
            style={{
              backgroundColor: hudBg,
              color: hudTextMain,
              border: `1px solid ${hudBorder}`,
            }}
          >
            {zoneBanner}에 올랐어요
          </div>
        </div>
      )}
    </div>
  );
}
