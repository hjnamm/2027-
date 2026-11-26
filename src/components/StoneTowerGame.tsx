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
import { drawRealisticPedestal, drawRealisticRock } from '../utils/stoneRenderer';
import { renderTempleParallaxBackground } from '../utils/templeSceneRenderer';

/**
 * 난이도·높이·시간대(오전→오후→노을→저녁)·물리적 흔들림 조정값
 */
const TUNING = {
  /** 처음 낙하 속도 배율 (1 = 원래 속도). 높이가 올라갈수록 천천히 1까지 올라감 */
  fallSpeedStartMult: 0.62,
  /** 후반부까지 천천히 속도가 올라가도록 램프 구간 확장 */
  fallSpeedRampLayers: 30,
  /** 돌을 받아주는 범위 배율 */
  catchWidthBonus: 1.22,
  /** 후반부 기울기 한계가 천천히 줄어들도록 완화 */
  criticalTiltShrinkPerLayer: 0.0016,
  /** 받침대를 빨리 움직일 때 탑이 흔들리는 정도 배율 */
  accelSwayMult: 0.65,
  /** 바람이 나오는 시점을 늦춤 */
  windDelayLayers: 3,
  /** 돌이 떨어지는 좌우 범위: 처음엔 가운데 근처, 서서히 넓어짐 */
  spawnSpreadStart: 0.22,
  spawnSpreadPerLayer: 0.02,
  /** 받침대에서 반대쪽으로 유도하는 규칙 시작 시점 */
  pushAwayFromLayer: 7,
  /** 화면 1px = 몇 cm (소원돌탑 높이 계산용) */
  cmPerPx: 0.5,
  /** 오전→오후→노을→저녁 전체 시간 흐름 완성 기준 */
  fullTimeLayers: 24,
  /** 최고 구역 도달 후 추가로 종소리를 울릴 간격 */
  extraBellIntervalLayers: 6,
};

/** 높이를 항상 m 단위로 표기 */
export const formatHeightMeters = (cm: number) => `${(cm / 100).toFixed(2)}m`;

export interface StoneTowerRunResult {
  layers: number;
  /** 소원돌탑 최고 높이 (cm) */
  heightCm: number;
  /** 화면 표시용 높이 문자열 (예: 0.86m, 1.24m) */
  heightLabel: string;
  zoneName: string;
  endReason: 'collapsed' | 'missed';
}

interface StoneTowerGameProps {
  mode: 'title' | 'playing' | 'gameover';
  onGameOver: (result: StoneTowerRunResult) => void;
  onZoneChange?: (isDarkText: boolean, zoneName: string, timeLabel?: string) => void;
  /** 리플레이 트리거 키 */
  runKey: number;
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
  offsetFromBelow: number;
  cumOffsetX: number;
  localY: number;
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
 * 8종의 다양한 돌 중에서 선택하되, 같은 디자인이 3번 연속 나오지 않도록 보장합니다.
 */
function pickStoneTypeForLayer(
  layerIndex: number,
  recentTypes: StoneTypeId[]
): StoneTypeId {
  let weightedPool: [StoneTypeId, number][];

  if (layerIndex <= 3) {
    weightedPool = [
      ['flat', 28],
      ['cobble', 24],
      ['ochre', 20],
      ['angular', 16],
      ['jade', 12],
    ];
  } else if (layerIndex <= 10) {
    weightedPool = [
      ['flat', 16],
      ['cobble', 16],
      ['angular', 15],
      ['boulder', 13],
      ['ochre', 13],
      ['jade', 11],
      ['basalt', 9],
      ['mossy', 7],
    ];
  } else {
    weightedPool = [
      ['flat', 13],
      ['cobble', 13],
      ['angular', 13],
      ['boulder', 13],
      ['ochre', 12],
      ['jade', 12],
      ['basalt', 12],
      ['mossy', 12],
    ];
  }

  const blockedType =
    recentTypes.length >= 2 &&
    recentTypes[recentTypes.length - 1] === recentTypes[recentTypes.length - 2]
      ? recentTypes[recentTypes.length - 1]
      : null;

  const lastType =
    recentTypes.length >= 1 ? recentTypes[recentTypes.length - 1] : null;

  const adjustedPool = weightedPool
    .filter(([type]) => type !== blockedType)
    .map(([type, weight]): [StoneTypeId, number] => [
      type,
      type === lastType ? weight * 0.35 : weight,
    ]);

  const totalWeight = adjustedPool.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * totalWeight;
  for (const [type, weight] of adjustedPool) {
    r -= weight;
    if (r <= 0) return type;
  }
  return adjustedPool[0][0];
}

/** 높아질수록 천천히 작아지는 돌 크기 계산 */
function createStoneMetrics(layerIndex: number, type: StoneTypeId) {
  const { taper, stoneTypes } = GAME_CONFIG;
  const def = stoneTypes[type];

  const effectiveIndex =
    layerIndex <= 12 ? layerIndex : 12 + (layerIndex - 12) * 0.55;

  const rawBaseW = Math.max(
    taper.minWidth,
    taper.startWidth - effectiveIndex * taper.widthStepPerLayer
  );
  const rawBaseH = Math.max(
    taper.minHeight,
    taper.startHeight - effectiveIndex * taper.heightStepPerLayer
  );

  const jitter = 0.96 + Math.random() * 0.08;
  const width = Math.max(44, Math.round(rawBaseW * def.widthScale * jitter));
  const height = Math.max(22, Math.round(rawBaseH * def.heightScale * jitter));
  const sizeRatio = width / taper.startWidth;
  const kg = Math.max(4, Math.round(def.baseKg * (0.58 + sizeRatio * 0.62)));

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
  const [heightCm, setHeightCm] = useState(0);
  const [endReasonUI, setEndReasonUI] = useState<'collapsed' | 'missed' | null>(null);
  const [zoneName, setZoneName] = useState<string>(ALTITUDE_ZONES[0].name);
  const [timeLabel, setTimeLabel] = useState<string>(ALTITUDE_ZONES[0].timeLabel);
  const [isDarkText, setIsDarkText] = useState<boolean>(ALTITUDE_ZONES[0].isDarkText);
  const [windDirUI, setWindDirUI] = useState<-1 | 0 | 1>(0);
  const [balanceRatioUI, setBalanceRatioUI] = useState<number>(0);
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

  // 배경 일러스트 + 실제 자연석 5종 사진 + 받침대 돌 사진 프리로드
  const imagesRef = useRef<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    const entries: [string, string][] = [
      ['temple', ASSET_URLS.temple],
      ['pond', ASSET_URLS.pond],
      ['pedestal', ASSET_URLS.pedestalStone],
      ['flat', ASSET_URLS.flatStone],
      ['cobble', ASSET_URLS.cobbleStone],
      ['angular', ASSET_URLS.slateStone],
      ['boulder', ASSET_URLS.boulderStone],
      ['basalt', ASSET_URLS.boulderStone],
      ['ochre', ASSET_URLS.pedestalStone],
      ['jade', ASSET_URLS.cobbleStone],
      ['mossy', ASSET_URLS.flatStone],
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

  // 메인 게임 루프
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const rect = wrapper.getBoundingClientRect();
    const W = Math.max(300, Math.floor(rect.width));
    const H = Math.max(520, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = W * dpr;
    canvas.height = H * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setHeightCm(0);
    setEndReasonUI(null);
    setZoneName(ALTITUDE_ZONES[0].name);
    setTimeLabel(ALTITUDE_ZONES[0].timeLabel);
    setIsDarkText(ALTITUDE_ZONES[0].isDarkText);
    setWindDirUI(0);
    setBalanceRatioUI(0);
    setZoneBanner(null);
    setCollapsingUI(false);
    hasMovedRef.current = false;
    onZoneChangeRef.current?.(
      ALTITUDE_ZONES[0].isDarkText,
      ALTITUDE_ZONES[0].name,
      ALTITUDE_ZONES[0].timeLabel
    );

    const pondSurfaceY = H - 86;
    const baseRockWidth = Math.min(
      GAME_CONFIG.baseRockMaxWidth,
      W * GAME_CONFIG.baseRockWidthRatio
    );
    const baseRockHeight = GAME_CONFIG.baseRockHeight;
    const baseTopScreenY = pondSurfaceY - baseRockHeight + 12;
    const minBaseX = baseRockWidth / 2 + 12;
    const maxBaseX = W - baseRockWidth / 2 - 12;

    const clouds = Array.from({ length: 14 }, (_, i) => ({
      alt: 580 + i * 310 + ((i * 137) % 110),
      x: ((i * 233) % 100) / 100,
      scale: 0.72 + ((i * 71) % 48) / 100,
      drift: 4 + (i % 4) * 2.5,
    }));

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

    let baseX = W / 2;
    let baseVx = 0;
    let prevBaseVx = 0;

    let towerTilt = 0;
    let towerTiltVel = 0;
    let cameraOffsetY = 0;
    let smoothTimeProgress = 0;
    /** 착지 시 탑 전체로 전해지는 짧은 물리적 미세 진동 파동 */
    let impactTremor = 0;
    /** 높이와 기울기에 비례하는 현재 불안정성 계수 (0 ~ 1) */
    let currentInstability = 0;

    let stackedStones: StackedStone[] = [];
    let recentStoneTypes: StoneTypeId[] = [];
    let activeFalling: FallingStone | null = null;
    let tumblingStones: TumblingStone[] = [];
    let dustPebbles: DustPebble[] = [];
    let splashes: WaterSplash[] = [];
    let popups: ScorePopup[] = [];

    let nextId = 1;
    let fallRange = { lo: 30, hi: W - 30 };
    let currentZoneId = ALTITUDE_ZONES[0].id;
    let windDir: -1 | 0 | 1 = 0;
    let windStrength = 0;
    let windOffset = 0;
    let waitSpawnTimer = 0;
    let peakLayers = 0;
    let peakHeightCm = 0;
    const maxZoneLayer = ALTITUDE_ZONES[ALTITUDE_ZONES.length - 1].minLayer;
    let nextExtraBellLayer = maxZoneLayer + TUNING.extraBellIntervalLayers;
    let bannerTimerId: number | null = null;

    let playPhase: 'idle' | 'falling' | 'waitNext' | 'collapsing' | 'ended' =
      modeRef.current === 'playing' ? 'waitNext' : 'idle';
    let collapseTimer = 0;
    let endReason: 'collapsed' | 'missed' = 'collapsed';

    const showZoneBanner = (label: string) => {
      setZoneBanner(label);
      if (bannerTimerId !== null) window.clearTimeout(bannerTimerId);
      bannerTimerId = window.setTimeout(() => setZoneBanner(null), 1900);
    };

    const worldToScreenY = (worldY: number) =>
      baseTopScreenY + worldY + cameraOffsetY;

    const getTowerHeightPx = () => {
      if (stackedStones.length === 0) return 0;
      const top = stackedStones[stackedStones.length - 1];
      return Math.abs(top.localY) + top.height * 0.45;
    };

    /**
     * 돌탑이 높아질수록 위쪽 돌이 탄성 있게 휘며 미세하게 흔들리는 물리적 불안정성 시각화
     */
    const getStoneScreenTransform = (
      stone: StackedStone,
      index: number,
      timeSec: number
    ) => {
      const count = Math.max(1, stackedStones.length);
      const heightFromBase = Math.abs(stone.localY);
      const heightFrac = (index + 1) / count;
      const flexCurve = Math.pow(heightFrac, 1.32);

      // 높이가 쌓일수록(3층 이상부터) 서서히 살아나는 자연스러운 미세 흔들림 파동
      const heightInstab = Math.max(0, Math.min(1, (count - 2) / 18));
      const microSwayWave =
        (Math.sin(timeSec * 2.15 - heightFrac * 1.4) * 0.65 +
          Math.sin(timeSec * 4.35 + index * 0.55) * 0.35) *
        heightInstab;

      // 기울기 위험 + 착지 충격에 따른 상단부 미세 떨림(tremor)
      const dangerTremorAmp =
        (currentInstability * 1.65 + impactTremor * 2.2) * flexCurve;
      const tremorX =
        Math.sin(timeSec * 19.5 + index * 2.3) * dangerTremorAmp * 0.65;
      const tremorAngle =
        Math.cos(timeSec * 17.0 + index * 1.9) * dangerTremorAmp * 0.0085;

      const swayOffsetX = microSwayWave * (1.2 + heightInstab * 4.2) * flexCurve;
      const swayAngle = microSwayWave * (0.006 + heightInstab * 0.018) * flexCurve;

      const localAngle =
        towerTilt * (0.32 + flexCurve * 1.02) + swayAngle + tremorAngle;
      const leanShiftX =
        Math.sin(towerTilt) * heightFromBase * (1.06 + flexCurve * 0.14) +
        swayOffsetX +
        tremorX;
      const leanDropY = (1 - Math.cos(towerTilt)) * heightFromBase * 0.42;

      return {
        x: baseX + stone.cumOffsetX + leanShiftX,
        y: worldToScreenY(stone.localY) + leanDropY,
        angle: stone.baseTilt + localAngle,
      };
    };

    const getCriticalTiltRad = (count: number) => {
      const { baseCriticalTiltRad, minCriticalTiltRad } = GAME_CONFIG.balance;
      const effectiveCount = count <= 12 ? count : 12 + (count - 12) * 0.55;
      return Math.max(
        minCriticalTiltRad,
        baseCriticalTiltRad - effectiveCount * TUNING.criticalTiltShrinkPerLayer
      );
    };

    const getTowerHeightCm = () => Math.round(getTowerHeightPx() * TUNING.cmPerPx);

    const getReachableRange = (stoneWidth: number) => {
      const top =
        stackedStones.length > 0 ? stackedStones[stackedStones.length - 1] : null;
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

    const triggerTowerCollapse = (
      collapseFromIndex: number,
      leanDir: number,
      timeSec: number
    ) => {
      if (playPhase === 'collapsing' || playPhase === 'ended') return;

      const dir = leanDir >= 0 ? 1 : -1;
      const fallen = stackedStones.slice(collapseFromIndex);
      stackedStones = stackedStones.slice(0, collapseFromIndex);

      soundEngine.playTowerCollapse(fallen.length);

      fallen.forEach((st, idx) => {
        const tf = getStoneScreenTransform(st, collapseFromIndex + idx, timeSec);
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
      const type = pickStoneTypeForLayer(layerIdx, recentStoneTypes);
      recentStoneTypes = [...recentStoneTypes.slice(-1), type];
      const metrics = createStoneMetrics(layerIdx, type);

      fallRange = getReachableRange(metrics.width);
      const minX = fallRange.lo;
      const maxX = fallRange.hi;
      const rangeCenter = (minX + maxX) / 2;

      let spawnX: number;
      if (layerIdx === 0) {
        spawnX = rangeCenter + (Math.random() - 0.5) * 44;
      } else {
        const spreadFactor = Math.min(
          0.92,
          TUNING.spawnSpreadStart + layerIdx * TUNING.spawnSpreadPerLayer
        );
        const halfSpread = ((maxX - minX) / 2) * spreadFactor;
        let candidate = rangeCenter + (Math.random() * 2 - 1) * halfSpread;

        if (layerIdx >= TUNING.pushAwayFromLayer && Math.abs(candidate - baseX) < 36) {
          const push = 48 + Math.random() * 44;
          candidate =
            baseX < W / 2
              ? Math.min(maxX, baseX + push)
              : Math.max(minX, baseX - push);
        }
        spawnX = candidate;
      }
      spawnX = Math.max(minX, Math.min(maxX, spawnX));

      const { fall } = GAME_CONFIG;
      const windStart = fall.windStartLayer + TUNING.windDelayLayers;
      const windProgress = Math.min(1, Math.max(0, (layerIdx - windStart) / 32));
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

      const spawnWorldY = -(baseTopScreenY + cameraOffsetY) + 34;

      activeFalling = {
        id: nextId++,
        ...metrics,
        x: spawnX,
        worldY: spawnWorldY,
        angle: (Math.random() - 0.5) * 0.05,
        variant: nextId * 13 + Math.floor(Math.random() * 97),
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

      if (impactTremor > 0) {
        impactTremor = Math.max(0, impactTremor - dt * 2.8);
      }

      // 1) 받침대 바위 좌우 이동
      const prevBaseX = baseX;

      if (
        modeRef.current === 'playing' &&
        (playPhase === 'falling' || playPhase === 'waitNext')
      ) {
        const dragDx = dragDeltaXRef.current;
        dragDeltaXRef.current = 0;
        const keyDx = keyDirRef.current * 275 * dt;
        baseX = Math.max(minBaseX, Math.min(maxBaseX, baseX + dragDx + keyDx));
      } else {
        dragDeltaXRef.current = 0;
      }

      baseVx = (baseX - prevBaseX) / Math.max(0.001, dt);
      const baseAx = (baseVx - prevBaseVx) / Math.max(0.001, dt);
      prevBaseVx = baseVx;

      // 2) 돌탑 균형 + 높이에 비례하는 물리적 미세 흔들림 시뮬레이션
      if (
        modeRef.current === 'playing' &&
        stackedStones.length >= 1 &&
        (playPhase === 'falling' || playPhase === 'waitNext')
      ) {
        const bal = GAME_CONFIG.balance;
        const count = stackedStones.length;
        const softCount = count <= 12 ? count : 12 + (count - 12) * 0.52;

        let weightedOffset = 0;
        let totalWeight = 0;
        for (let i = 0; i < count; i++) {
          const st = stackedStones[i];
          const lever = 0.65 + (i / Math.max(1, count)) * 0.95;
          const w = (st.kg * lever) / st.stability;
          weightedOffset += st.cumOffsetX * w;
          totalWeight += w;
        }
        const avgComOffset = totalWeight > 0 ? weightedOffset / totalWeight : 0;

        const heightScale = 1 + Math.min(softCount, 26) * 0.062;
        const springK = Math.max(
          bal.minSpringK,
          bal.baseSpringK - softCount * 0.18
        );

        // 탑이 높아질수록 살아나는 미세한 자연 흔들림 토크 (난이도 체감 시각화)
        const heightInstab = Math.max(0, Math.min(1, (count - 2) / 18));
        const ambientSwayTorque =
          (Math.sin(timeSec * 1.55) * 0.65 + Math.sin(timeSec * 2.83 + 1.1) * 0.35) *
          heightInstab *
          0.19;

        const comTorque = avgComOffset * bal.comTorqueStrength * heightScale;
        const accelTorque =
          -Math.max(-2100, Math.min(2100, baseAx)) *
          bal.baseAccelSwayFactor *
          TUNING.accelSwayMult *
          Math.min(1.95, 0.45 + softCount * 0.085);
        const windTorque =
          windDir * (count >= 11 ? 0.032 * Math.min(1.65, (count - 8) / 18) : 0);

        const gravityTip = Math.sin(towerTilt) * (1.3 + Math.min(softCount, 26) * 0.145);

        const angularAccel =
          comTorque +
          accelTorque +
          windTorque +
          ambientSwayTorque +
          gravityTip -
          towerTilt * springK -
          towerTiltVel * bal.damping;

        towerTiltVel += angularAccel * dt;
        towerTilt += towerTiltVel * dt;

        const critRad = getCriticalTiltRad(count);
        const normBalance = Math.max(-1, Math.min(1, towerTilt / critRad));
        setBalanceRatioUI(normBalance);

        // 높이 기반 + 현재 기울기 기반 불안정성 수치 갱신
        const absTilt = Math.abs(normBalance);
        currentInstability = Math.min(
          1,
          heightInstab * 0.36 + Math.max(0, absTilt - 0.3) * 0.95
        );

        // 불안정할수록 상단 돌 틈에서 돌가루가 미세하게 떨어지며 긴장감 시각화
        if (absTilt > 0.48 && count >= 4 && Math.random() < 0.06 + absTilt * 0.18) {
          const sampleIdx = Math.max(
            1,
            count - 1 - Math.floor(Math.random() * Math.min(3, count - 1))
          );
          const st = stackedStones[sampleIdx];
          const tf = getStoneScreenTransform(st, sampleIdx, timeSec);
          spawnDust(
            tf.x + (Math.random() - 0.5) * st.width * 0.55,
            tf.y + st.height * 0.42,
            1,
            st.color
          );
        }

        if (absTilt > 0.72 && count >= 3) {
          soundEngine.playStoneCreak();
        }

        if (Math.abs(towerTilt) >= critRad && count >= 2) {
          const breakIdx = Math.max(0, Math.floor(count * 0.2));
          triggerTowerCollapse(breakIdx, Math.sign(towerTilt), timeSec);
        }
      } else if (stackedStones.length === 0) {
        towerTilt *= 0.9;
        towerTiltVel *= 0.9;
        currentInstability *= 0.85;
        setBalanceRatioUI(0);
      }

      // 3) 카메라 상승 & 시간대(오전→오후→노을→저녁) 전환
      const towerH = getTowerHeightPx();
      const targetCamY = Math.max(0, towerH - H * 0.27);
      cameraOffsetY += (targetCamY - cameraOffsetY) * Math.min(1, dt * 4.0);

      const targetTimeProgress =
        modeRef.current === 'title'
          ? 0.88
          : Math.min(1, stackedStones.length / TUNING.fullTimeLayers);
      smoothTimeProgress +=
        (targetTimeProgress - smoothTimeProgress) * Math.min(1, dt * 1.4);

      Matter.Body.setPosition(baseRockBody, {
        x: baseX,
        y: baseTopScreenY + cameraOffsetY + baseRockHeight / 2,
      });

      for (const st of stackedStones) {
        if (st.settleAnim > 0) {
          st.settleAnim = Math.max(0, st.settleAnim - dt * 5.2);
        }
      }

      // 4) 떨어지는 돌 이동 및 착지 판정
      if (playPhase === 'waitNext') {
        waitSpawnTimer -= dt;
        if (waitSpawnTimer <= 0) {
          spawnNextStone();
        }
      } else if (playPhase === 'falling' && activeFalling) {
        const { fall, balance } = GAME_CONFIG;
        const layerIdx = stackedStones.length;
        const softLayer = layerIdx <= 12 ? layerIdx : 12 + (layerIdx - 12) * 0.55;
        const speedRamp = Math.min(1, softLayer / TUNING.fallSpeedRampLayers);
        const speedMult =
          TUNING.fallSpeedStartMult + (1 - TUNING.fallSpeedStartMult) * speedRamp;
        const baseSpeed =
          Math.min(
            fall.maxSpeedPxPerSec,
            fall.baseSpeedPxPerSec + softLayer * fall.speedIncreasePerLayer
          ) * speedMult;
        const vy = fastDropRef.current
          ? baseSpeed * fall.fastDropMultiplier
          : baseSpeed;

        activeFalling.worldY += vy * dt;

        if (windDir !== 0) {
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
          ? getStoneScreenTransform(topStone, stackedStones.length - 1, timeSec)
          : { x: baseX, y: baseTopScreenY + cameraOffsetY, angle: 0 };

        const supportTopWorldY = topStone
          ? topStone.localY - topStone.height * 0.42
          : 0;
        const supportCenterX = topTransform.x;
        const supportWidth = topStone ? topStone.width : baseRockWidth;
        const supportHalfW = supportWidth * balance.catchSupportRatio;

        const fallingBottomWorldY =
          activeFalling.worldY + activeFalling.height * 0.42;

        if (fallingBottomWorldY >= supportTopWorldY) {
          const offsetX = activeFalling.x - supportCenterX;
          const absOffset = Math.abs(offsetX);
          const catchHalfLimit =
            (supportHalfW * (topStone ? topStone.stability : 1.0) +
              activeFalling.width * 0.2) *
            TUNING.catchWidthBonus;

          if (absOffset <= catchHalfLimit) {
            const offsetRatio = absOffset / Math.max(18, supportWidth * 0.5);
            const isPerfect = offsetRatio <= balance.perfectRatio;

            const prevCumOffset = topStone ? topStone.cumOffsetX : 0;
            const nextCumOffset = prevCumOffset + offsetX;
            const newLocalY = supportTopWorldY - activeFalling.height * 0.41;

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
                (activeFalling.type === 'boulder' ? 0.068 : 0.034),
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
              if (Math.abs(totalComX) > baseRockWidth * 0.5) {
                failPivotIdx = 0;
                failDir = Math.sign(totalComX);
              }
            }

            const sizeRatio = activeFalling.width / GAME_CONFIG.taper.startWidth;
            soundEngine.playStoneClack(sizeRatio, isPerfect);

            if (failPivotIdx !== -1) {
              const fallingCount = candidateStack.length - failPivotIdx;
              if (fallingCount >= 2 || stackedStones.length >= 3) {
                stackedStones = candidateStack;
                activeFalling = null;
                triggerTowerCollapse(
                  Math.min(failPivotIdx, Math.max(0, stackedStones.length - 3)),
                  failDir,
                  timeSec
                );
              } else {
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
                towerTiltVel += failDir * 0.2;
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
              const gainLabel = `+${formatHeightMeters(gainCm)}`;
              peakLayers = Math.max(peakLayers, newLayers);
              peakHeightCm = Math.max(peakHeightCm, newHeightCm);
              setHeightCm(newHeightCm);

              // 높이가 높을수록 착지 충격 미세 진동이 강하게 전달됨
              impactTremor = Math.min(
                1,
                (isPerfect ? 0.25 : 0.55) * (0.35 + Math.min(newLayers, 20) / 20)
              );

              if (isPerfect) {
                towerTiltVel *= 0.4;
                towerTilt *= 0.68;
                spawnDust(
                  topTransform.x,
                  worldToScreenY(supportTopWorldY),
                  7,
                  '#F3D287'
                );
                addPopup(
                  topTransform.x,
                  worldToScreenY(newLocalY) - 24,
                  `완벽! ${gainLabel}`,
                  'perfect'
                );
              } else {
                const kick =
                  (offsetX / Math.max(22, supportWidth * 0.5)) *
                  0.18 *
                  balance.edgeTorqueMultiplier *
                  (1 + Math.min(newLayers, 24) * 0.024);
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
                  offsetRatio > 0.68 ? `아슬아슬 ${gainLabel}` : gainLabel,
                  offsetRatio > 0.68 ? 'warn' : 'good'
                );
              }

              // 고도 구역 통과 시마다 사찰 범종 소리 울림
              const nextZone = getZoneForLayer(newLayers);
              if (nextZone.id !== currentZoneId) {
                currentZoneId = nextZone.id;
                setZoneName(nextZone.name);
                setTimeLabel(nextZone.timeLabel);
                setIsDarkText(nextZone.isDarkText);
                onZoneChangeRef.current?.(
                  nextZone.isDarkText,
                  nextZone.name,
                  nextZone.timeLabel
                );
                soundEngine.playTempleBell();
                showZoneBanner(`${nextZone.timeLabel} · ${nextZone.name}`);
              } else if (newLayers >= nextExtraBellLayer) {
                nextExtraBellLayer += TUNING.extraBellIntervalLayers;
                soundEngine.playTempleBell();
                showZoneBanner(`${formatHeightMeters(newHeightCm)} 돌파 · 달빛 너머`);
              }

              playPhase = 'waitNext';
              waitSpawnTimer = 0.34;
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
            heightLabel: formatHeightMeters(peakHeightCm),
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
        imagesRef.current.pond,
        smoothTimeProgress
      );

      // 고도가 높아질수록 지나가는 은은한 구름
      for (const c of clouds) {
        const cy = baseTopScreenY - c.alt + cameraOffsetY * 0.88;
        if (cy < -90 || cy > H + 90) continue;
        const span = W + 220;
        const cx = (((c.x * span + timeSec * c.drift) % span) + span) % span - 110;
        const s = c.scale;
        const isSunset = smoothTimeProgress > 0.45 && smoothTimeProgress < 0.82;
        const cloudColor = isSunset
          ? 'rgba(218, 138, 102, 0.24)'
          : smoothTimeProgress >= 0.82
          ? 'rgba(130, 150, 184, 0.16)'
          : 'rgba(214, 222, 224, 0.24)';
        ctx.save();
        ctx.fillStyle = cloudColor;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 48 * s, 16 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - 32 * s, cy + 4 * s, 28 * s, 12 * s, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 34 * s, cy + 3 * s, 30 * s, 13 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 바람 줄기
      if (windDir !== 0 && playPhase === 'falling') {
        windOffset += windDir * dt * 235;
        ctx.save();
        ctx.strokeStyle = 'rgba(246, 236, 214, 0.42)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let i = 0; i < 6; i++) {
          const wy = 98 + i * 72;
          const wx =
            (((windOffset + i * 95) % (W + 120)) + (W + 120)) % (W + 120) - 60;
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.quadraticCurveTo(wx + 26 * windDir, wy - 6, wx + 54 * windDir, wy);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 떨어지는 돌 아래 은은한 가이드선
      if (playPhase === 'falling' && activeFalling) {
        const sy = worldToScreenY(activeFalling.worldY);
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(248, 236, 208, 0.24)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(activeFalling.x, sy + activeFalling.height * 0.44);
        ctx.lineTo(activeFalling.x, Math.min(H, pondWaterScreenY));
        ctx.stroke();
        ctx.restore();
      }

      // 맨 밑 받침대 돌 (마지막 업로드 이미지 image_4d8aec9d.png)
      const baseScreenY = baseTopScreenY + cameraOffsetY;
      if (baseScreenY < H + 54) {
        ctx.save();
        ctx.translate(baseX, baseScreenY);
        drawRealisticPedestal(
          ctx,
          baseRockWidth,
          baseRockHeight,
          timeSec,
          imagesRef.current.pedestal
        );

        if (
          modeRef.current === 'playing' &&
          !hasMovedRef.current &&
          playPhase === 'falling'
        ) {
          ctx.fillStyle = '#F7F1E2';
          ctx.font = '13px "Jua", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('◀ 좌우로 드래그 ▶', 0, baseRockHeight + 20);
        }

        ctx.restore();
      }

      // 쌓인 돌탑 (높아질수록 미세 흔들림 + 실제 자연석 질감)
      for (let i = 0; i < stackedStones.length; i++) {
        const st = stackedStones[i];
        const tf = getStoneScreenTransform(st, i, timeSec);
        if (tf.y > H + 90 || tf.y < -120) continue;

        const squashX = 1 + st.settleAnim * 0.055;
        const squashY = 1 - st.settleAnim * 0.065;

        ctx.save();
        ctx.translate(tf.x, tf.y);
        ctx.rotate(tf.angle);
        ctx.scale(squashX, squashY);
        drawRealisticRock(
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

      // 떨어지는 현재 돌
      if (activeFalling) {
        const sy = worldToScreenY(activeFalling.worldY);
        ctx.save();
        ctx.translate(activeFalling.x, sy);
        ctx.rotate(activeFalling.angle);
        drawRealisticRock(
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

      // 굴러 떨어지는 돌
      for (const t of tumblingStones) {
        ctx.save();
        ctx.translate(t.body.position.x, t.body.position.y);
        ctx.rotate(t.body.angle);
        drawRealisticRock(
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

      // 돌가루 파티클
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

      // 연못 물보라
      const aliveSplashes: WaterSplash[] = [];
      for (const sp of splashes) {
        sp.age += dt;
        if (sp.age < 0.65) {
          const alpha = 1 - sp.age / 0.65;
          ctx.fillStyle = `rgba(235, 240, 244, ${alpha * 0.85})`;
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

      // 착지 피드백 팝업
      const alivePopups: ScorePopup[] = [];
      for (const p of popups) {
        p.age += dt;
        if (p.age < 0.92) {
          const alpha = 1 - p.age / 0.92;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.font =
            p.tone === 'perfect'
              ? '17px "Jua", sans-serif'
              : '15px "Jua", sans-serif';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(10, 12, 16, 0.72)';
          ctx.shadowBlur = 4;
          ctx.fillStyle =
            p.tone === 'bad'
              ? '#F06A6A'
              : p.tone === 'warn'
              ? '#F0A454'
              : p.tone === 'perfect'
              ? '#F5D076'
              : '#E7E3D7';
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
      if (bannerTimerId !== null) window.clearTimeout(bannerTimerId);
      Matter.World.clear(world, false);
      Matter.Engine.clear(engine);
    };
  }, [runKey]);

  const absBalance = Math.abs(balanceRatioUI);
  const balanceColor =
    absBalance > 0.72
      ? '#E86862'
      : absBalance > 0.45
      ? '#E5A353'
      : '#6FB89D';
  const balanceLabel = collapsingUI
    ? endReasonUI === 'missed'
      ? '놓쳤어요!'
      : '붕괴!'
    : absBalance > 0.72
    ? '위험!'
    : absBalance > 0.45
    ? '흔들림'
    : '균형 안정';

  const hudBg = isDarkText
    ? 'rgba(255, 253, 248, 0.86)'
    : 'rgba(15, 20, 27, 0.74)';
  const hudBorder = isDarkText
    ? 'rgba(84, 72, 58, 0.14)'
    : absBalance > 0.72
    ? 'rgba(232, 104, 98, 0.45)'
    : 'rgba(232, 206, 158, 0.22)';
  const hudTextMain = isDarkText ? '#2A2520' : '#F6F1E5';
  const hudTextSub = isDarkText ? '#5C544B' : '#C7C1B4';

  return (
    <div ref={wrapperRef} className="game-touch-surface relative w-full h-full">
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
            className="rounded-2xl px-3.5 py-2.5 flex items-center justify-between backdrop-blur-md transition-colors duration-300"
            style={{
              backgroundColor: hudBg,
              border: `1px solid ${hudBorder}`,
            }}
          >
            <div className="text-left min-w-0">
              <p
                className="font-display text-lg tabular-nums leading-tight"
                style={{ color: hudTextMain }}
              >
                {formatHeightMeters(heightCm)}
              </p>
              <p
                className="mt-0.5 text-[11px] leading-tight truncate"
                style={{ color: hudTextSub }}
              >
                {timeLabel} · {zoneName}
                {windDirUI !== 0 && (
                  <span> · 산바람 {windDirUI === -1 ? '←' : '→'}</span>
                )}
              </p>
            </div>

            <div className="w-[74px] flex flex-col items-end shrink-0">
              <span
                className="text-[11px] font-display leading-none mb-1"
                style={{ color: balanceColor }}
              >
                {balanceLabel}
              </span>
              <div
                className="w-full h-2 rounded-full relative overflow-hidden"
                style={{
                  backgroundColor: 'rgba(255, 250, 240, 0.16)',
                }}
              >
                <div
                  className="absolute top-0 bottom-0 left-1/2 w-[1.5px] -translate-x-1/2 opacity-40"
                  style={{ backgroundColor: hudTextMain }}
                />
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

      {/* 고도·시간대 구역 통과 알림 */}
      {mode === 'playing' && zoneBanner && (
        <div className="absolute inset-x-0 top-24 flex justify-center pointer-events-none z-20">
          <div
            className="px-4 py-1.5 rounded-2xl font-display text-base shadow-sm animate-float-up-fade backdrop-blur-md"
            style={{
              backgroundColor: hudBg,
              color: '#F5DFB0',
              border: `1px solid ${hudBorder}`,
            }}
          >
            {zoneBanner}
          </div>
        </div>
      )}
    </div>
  );
}
