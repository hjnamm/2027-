export type StoneTypeId =
  | 'flat'
  | 'cobble'
  | 'angular'
  | 'boulder'
  | 'basalt'
  | 'ochre'
  | 'jade'
  | 'mossy';

export type TimeOfDayId = 'morning' | 'afternoon' | 'sunset' | 'evening';

export interface AltitudeZone {
  id: string;
  name: string;
  timeLabel: string;
  timeOfDay: TimeOfDayId;
  minLayer: number;
  isDarkText: boolean;
  subtitle: string;
}

export interface StoneTypeConfig {
  label: string;
  widthScale: number;
  heightScale: number;
  baseKg: number;
  color: string;
  stroke: string;
  stability: number;
}

/**
 * 한국 전통 산사 배경 및 실제 자연석 사진 에셋 경로
 */
export const ASSET_URLS = {
  temple: '/src/assets/images/korean_temple_backdrop_1795619389017.jpg',
  pond: '',
  /** 1번: 거친 회색 자연 바위 */
  boulderStone: '/assets/aistudio/image_0183ea91.png',
  /** 2번: 흰 석영맥이 흐르는 매끄러운 강돌 */
  cobbleStone: '/assets/aistudio/image_97728633.png',
  /** 3번: 평탄한 회색 화강암 판석 */
  flatStone: '/assets/aistudio/image_a9d8736b.png',
  /** 4번 & 마지막: 두툼하고 안정적인 평면 자연석 (받침대 돌 + 황갈빛 평석) */
  pedestalStone: '/assets/aistudio/image_4d8aec9d.png',
  /** 5번: 황토 결이 섞인 겹층 점판암 */
  slateStone: '/assets/aistudio/image_b7647b51.png',
} as const;

/**
 * 돌탑 높이에 따라 오르는 한국 산사 고도 구역 (오전 → 오후 → 노을 → 저녁)
 * 각 구역을 통과할 때마다 사찰 범종 소리가 울립니다.
 */
export const ALTITUDE_ZONES: AltitudeZone[] = [
  {
    id: 'morning_pond',
    name: '연못가 돌다리',
    timeLabel: '오전',
    timeOfDay: 'morning',
    minLayer: 0,
    isDarkText: false,
    subtitle: '안개 낀 이른 오전, 첫 소원돌을 올리는 연못가',
  },
  {
    id: 'morning_courtyard',
    name: '산사 앞마당',
    timeLabel: '늦은 오전',
    timeOfDay: 'morning',
    minLayer: 4,
    isDarkText: false,
    subtitle: '고요한 마당 위로 아침 빛이 스미는 높이',
  },
  {
    id: 'afternoon_eaves',
    name: '전각 처마 끝',
    timeLabel: '오후',
    timeOfDay: 'afternoon',
    minLayer: 8,
    isDarkText: false,
    subtitle: '단청과 기와 너머 한낮의 볕이 기우는 오후',
  },
  {
    id: 'sunset_ridge',
    name: '소나무 능선',
    timeLabel: '노을',
    timeOfDay: 'sunset',
    minLayer: 13,
    isDarkText: false,
    subtitle: '붉은 노을이 산등성이를 물들이며 산바람이 부는 곳',
  },
  {
    id: 'evening_lanterns',
    name: '연등 뜨는 하늘',
    timeLabel: '초저녁',
    timeOfDay: 'evening',
    minLayer: 18,
    isDarkText: false,
    subtitle: '어스름한 저녁, 소원 연등이 별빛처럼 떠오르는 높이',
  },
  {
    id: 'night_moon_peak',
    name: '달빛 소원봉',
    timeLabel: '깊은 저녁',
    timeOfDay: 'evening',
    minLayer: 24,
    isDarkText: false,
    subtitle: '달빛과 별빛에 소원이 닿는 고요한 밤의 정상',
  },
];

export function getZoneForLayer(layer: number): AltitudeZone {
  let matched = ALTITUDE_ZONES[0];
  for (const zone of ALTITUDE_ZONES) {
    if (layer >= zone.minLayer) {
      matched = zone;
    }
  }
  return matched;
}

export const GAME_CONFIG = {
  baseRockMaxWidth: 164,
  baseRockWidthRatio: 0.41,
  baseRockHeight: 46,

  /** 후반부에도 너무 급격히 작아지지 않는 완만한 테이퍼링 */
  taper: {
    startWidth: 114,
    minWidth: 62,
    widthStepPerLayer: 0.95,
    startHeight: 36,
    minHeight: 25,
    heightStepPerLayer: 0.22,
  },

  /** 실제 자연석 사진 기반의 8종 한국 자연석 */
  stoneTypes: {
    flat: {
      label: '회색 화강 판석',
      widthScale: 1.08,
      heightScale: 0.94,
      baseKg: 10,
      color: '#99958E',
      stroke: '#322E2A',
      stability: 1.12,
    },
    cobble: {
      label: '석영맥 강돌',
      widthScale: 0.98,
      heightScale: 1.04,
      baseKg: 12,
      color: '#B1A797',
      stroke: '#3C362F',
      stability: 1.04,
    },
    angular: {
      label: '겹층 점판암',
      widthScale: 1.04,
      heightScale: 1.02,
      baseKg: 14,
      color: '#828B94',
      stroke: '#2A3036',
      stability: 0.95,
    },
    boulder: {
      label: '거친 산바위',
      widthScale: 0.98,
      heightScale: 1.18,
      baseKg: 16,
      color: '#BDB5A5',
      stroke: '#3C3730',
      stability: 0.91,
    },
    basalt: {
      label: '검은 현무암',
      widthScale: 0.96,
      heightScale: 1.12,
      baseKg: 15,
      color: '#5F6368',
      stroke: '#1F2226',
      stability: 0.98,
    },
    ochre: {
      label: '황갈 자연 평석',
      widthScale: 1.08,
      heightScale: 0.9,
      baseKg: 12,
      color: '#B58E6A',
      stroke: '#443223',
      stability: 1.07,
    },
    jade: {
      label: '청옥 계곡돌',
      widthScale: 0.98,
      heightScale: 1.02,
      baseKg: 13,
      color: '#7E968C',
      stroke: '#2A3934',
      stability: 1.02,
    },
    mossy: {
      label: '이끼 산돌',
      widthScale: 1.04,
      heightScale: 0.96,
      baseKg: 14,
      color: '#8B8D80',
      stroke: '#2E322A',
      stability: 0.97,
    },
  } satisfies Record<StoneTypeId, StoneTypeConfig>,

  /** 후반부 난이도 상승이 더욱 완만한 낙하·바람 설정 */
  fall: {
    baseSpeedPxPerSec: 172,
    speedIncreasePerLayer: 4.5,
    maxSpeedPxPerSec: 325,
    fastDropMultiplier: 2.35,
    windStartLayer: 8,
    baseWindChance: 0.22,
    maxWindChance: 0.56,
    baseWindPushPxPerSec: 20,
    maxWindPushPxPerSec: 52,
  },

  /** 후반부 흔들림·기울기 한계가 완만하게 증가하도록 조정 */
  balance: {
    baseCriticalTiltRad: 0.38,
    minCriticalTiltRad: 0.24,
    comTorqueStrength: 0.0124,
    baseSpringK: 17.8,
    minSpringK: 10.6,
    damping: 4.5,
    baseAccelSwayFactor: 0.00031,
    catchSupportRatio: 0.51,
    perfectRatio: 0.22,
    subStackOverhangLimit: 0.55,
    edgeTorqueMultiplier: 0.85,
  },
} as const;
