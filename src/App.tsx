import { useCallback, useEffect, useState } from 'react';
import { RotateCcw, Volume2, VolumeX } from 'lucide-react';
import {
  formatHeightMeters,
  StoneTowerGame,
  StoneTowerRunResult,
} from './components/StoneTowerGame';
import { ALTITUDE_ZONES } from './config/gameConfig';
import { soundEngine } from './utils/sound';

type GameMode = 'title' | 'playing' | 'gameover';

const TITLE_LETTERING_IMG = '/assets/aistudio/______72a53e81.png';
const START_LETTERING_IMG = '/assets/aistudio/______9078c188.png';

interface StoredRecord {
  bestHeightCm: number;
  bestHeightLabel: string;
  bestLayers: number;
  bestZoneName: string;
  history: {
    id: number;
    heightCm?: number;
    heightLabel: string;
    zoneName: string;
    wish: string;
  }[];
}

const STORAGE_KEY = 'wish-stone-tower-records-v1';

/** GA4 이벤트 전송 (gtag가 없으면 조용히 넘어감) */
function trackEvent(name: string, params: Record<string, unknown> = {}) {
  try {
    const g = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof g === 'function') g('event', name, params);
  } catch {
    // 무시
  }
}


const DEFAULT_RECORD: StoredRecord = {
  bestHeightCm: 0,
  bestHeightLabel: '0.00m',
  bestLayers: 0,
  bestZoneName: ALTITUDE_ZONES[0].name,
  history: [],
};

function normalizeMeterLabel(label: unknown, cm?: number): string {
  if (typeof cm === 'number' && Number.isFinite(cm)) {
    return formatHeightMeters(cm);
  }
  if (typeof label === 'string') {
    const cmMatch = label.match(/^(\d+(?:\.\d+)?)cm$/i);
    if (cmMatch) {
      return formatHeightMeters(parseFloat(cmMatch[1]));
    }
    if (label.endsWith('m')) return label;
  }
  return '0.00m';
}

function loadRecord(): StoredRecord {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RECORD;
    const parsed = JSON.parse(raw) as Partial<StoredRecord>;
    const bestHeightCm =
      typeof parsed.bestHeightCm === 'number' ? parsed.bestHeightCm : 0;
    return {
      bestHeightCm,
      bestHeightLabel: formatHeightMeters(bestHeightCm),
      bestLayers: typeof parsed.bestLayers === 'number' ? parsed.bestLayers : 0,
      bestZoneName:
        typeof parsed.bestZoneName === 'string'
          ? parsed.bestZoneName
          : ALTITUDE_ZONES[0].name,
      history: Array.isArray(parsed.history)
        ? parsed.history.slice(0, 5).map((item) => ({
            id: typeof item.id === 'number' ? item.id : Date.now(),
            heightCm: typeof item.heightCm === 'number' ? item.heightCm : undefined,
            heightLabel: normalizeMeterLabel(item.heightLabel, item.heightCm),
            zoneName:
              typeof item.zoneName === 'string'
                ? item.zoneName
                : ALTITUDE_ZONES[0].name,
            wish: typeof item.wish === 'string' ? item.wish : '',
          }))
        : [],
    };
  } catch {
    return DEFAULT_RECORD;
  }
}

export default function App() {
  const [mode, setMode] = useState<GameMode>('title');
  const [runKey, setRunKey] = useState(1);
  const [muted, setMuted] = useState(false);
  const [currentZoneName, setCurrentZoneName] = useState(ALTITUDE_ZONES[0].name);
  const [currentTimeLabel, setCurrentTimeLabel] = useState(ALTITUDE_ZONES[0].timeLabel);
  const [wish, setWish] = useState('');
  const [lastResult, setLastResult] = useState<StoneTowerRunResult | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [record, setRecord] = useState<StoredRecord>(() => loadRecord());

  useEffect(() => {
    soundEngine.setMuted(muted);
  }, [muted]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      if (!next) {
        soundEngine.unlock();
      }
      return next;
    });
  }, []);

  const handleStartGame = useCallback(() => {
    soundEngine.unlock();
    trackEvent('game_start');
    setLastResult(null);
    setIsNewBest(false);
    setMode('playing');
    setRunKey((k) => k + 1);
  }, []);

  const handleBackToTitle = useCallback(() => {
    setLastResult(null);
    trackEvent('back_to_title');
    setIsNewBest(false);
    setMode('title');
    setRunKey((k) => k + 1);
  }, []);

  const handleZoneChange = useCallback(
    (_isDarkText: boolean, zoneName: string, timeLabel?: string) => {
      setCurrentZoneName(zoneName);
      if (timeLabel) setCurrentTimeLabel(timeLabel);
    },
    []
  );

  const handleGameOver = useCallback(
    (result: StoneTowerRunResult) => {
      setLastResult(result);
      setMode('gameover');
      trackEvent('game_over', {
        height_cm: result.heightCm,
        layers: result.layers,
        end_reason: (result as unknown as { endReason?: string }).endReason ?? 'unknown',
      });

      setRecord((prev) => {
        const beatBest = result.heightCm > prev.bestHeightCm;
        setIsNewBest(beatBest && result.heightCm > 0);
        const nextBestCm = beatBest ? result.heightCm : prev.bestHeightCm;

        const next: StoredRecord = {
          bestHeightCm: nextBestCm,
          bestHeightLabel: formatHeightMeters(nextBestCm),
          bestLayers: Math.max(prev.bestLayers, result.layers),
          bestZoneName: beatBest ? result.zoneName : prev.bestZoneName,
          history: [
            {
              id: Date.now(),
              heightCm: result.heightCm,
              heightLabel: result.heightLabel,
              zoneName: result.zoneName,
              wish: wish.trim(),
            },
            ...prev.history,
          ].slice(0, 5),
        };

        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore storage quota failures
        }
        return next;
      });
    },
    [wish]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (mode === 'title' || mode === 'gameover') {
          e.preventDefault();
          handleStartGame();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, handleStartGame]);

  const highestUnlockedIndex = ALTITUDE_ZONES.reduce((acc, zone, idx) => {
    if (record.bestLayers >= zone.minLayer) return idx;
    return acc;
  }, 0);

  return (
    <main className="min-h-dvh w-full bg-[#0D1218] text-[#F2ECE0] flex items-center justify-center sm:px-6 sm:py-4">
      <div className="w-full max-w-[1160px] flex items-center justify-center xl:grid xl:grid-cols-[270px_auto_270px] xl:gap-10">
        {/* 좌측 안내 및 소원 적기 (넓은 데스크톱 전용) */}
        <aside className="hidden xl:flex flex-col justify-between h-[min(92dvh,840px)] py-5">
          <div className="space-y-6">
            <div>
              <h1 className="sr-only">소원 돌탑</h1>
              <img
                src={TITLE_LETTERING_IMG}
                alt="소원 돌탑"
                referrerPolicy="no-referrer"
                className="h-11 w-auto object-contain select-none"
              />
              <p className="mt-3 text-[15px] leading-relaxed text-[#A7B0B8]">
                고풍스러운 산사 연못가에서 떨어지는 자연석을 받아 균형을 잡으며
                오전부터 깊은 밤까지 돌탑을 쌓아 올리세요.
              </p>
            </div>

            <div className="pt-5 border-t border-white/10 space-y-2.5">
              <label
                htmlFor="desktop-wish-input"
                className="block text-sm text-[#D8D1C2]"
              >
                돌탑에 담을 소원 (선택)
              </label>
              <input
                id="desktop-wish-input"
                type="text"
                maxLength={32}
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                placeholder="예: 올해 가족 모두 건강하기"
                className="w-full rounded-xl bg-white/6 border border-[#E3C996]/18 px-3.5 py-2.5 text-sm text-[#F5EFE2] placeholder:text-[#747F8A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D8AD64]"
              />
              <p className="text-xs text-[#808B94]">
                적어 둔 소원은 결과 기록에 함께 남습니다.
              </p>
            </div>

            <div className="pt-5 border-t border-white/10 space-y-3">
              <h2 className="font-display text-lg text-[#EBE3D2]">조작 방법</h2>
              <dl className="space-y-2.5 text-sm text-[#A7B0B8]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[#EBE3D2] shrink-0">좌우 이동</dt>
                  <dd className="text-right">화면 드래그 · 방향키 ← →</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[#EBE3D2] shrink-0">빠르게 내리기</dt>
                  <dd className="text-right">아래로 당기기 · ↓ 키</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[#EBE3D2] shrink-0">균형 잡기</dt>
                  <dd className="text-right">기울어진 쪽으로 받침대 조절</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10 text-xs text-[#7E8992] space-y-1">
            <p>
              현재 시간 · {currentTimeLabel} ({currentZoneName})
            </p>
            <p>구간을 지날 때마다 산사의 범종 소리가 울립니다.</p>
          </div>
        </aside>

        {/* 중앙 스마트폰 최적화 9:16 세로 게임 화면 */}
        <section
          aria-label="소원 돌탑 게임 화면"
          className="relative w-full h-dvh sm:h-[min(92dvh,840px)] sm:w-auto sm:aspect-[9/16] max-w-full sm:rounded-[30px] overflow-hidden sm:shadow-[0_28px_80px_rgba(0,0,0,0.62)] sm:ring-1 sm:ring-[#E8CFA0]/18 bg-[#121820]"
        >
          <StoneTowerGame
            mode={mode}
            onGameOver={handleGameOver}
            onZoneChange={handleZoneChange}
            runKey={runKey}
          />

          {/* 우측 상단 음소거 토글 버튼 */}
          <button
            type="button"
            onClick={handleToggleMute}
            aria-label={muted ? '소리 켜기' : '소리 끄기'}
            title={muted ? '소리 켜기' : '소리 끄기'}
            className="absolute top-3 right-3 z-30 w-11 h-11 rounded-2xl flex items-center justify-center backdrop-blur-md transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D8AD64] cursor-pointer"
            style={{
              backgroundColor: 'rgba(15, 20, 27, 0.74)',
              border: '1px solid rgba(232, 206, 158, 0.24)',
              color: '#F5EFE2',
            }}
          >
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>

          {/* 타이틀 오버레이 */}
          {mode === 'title' && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-between px-6 pt-20 pb-10 bg-gradient-to-b from-[#0A0E16]/72 via-[#0A0E16]/16 to-[#090D14]/82">
              <div className="text-center max-w-[290px] mt-2 flex flex-col items-center">
                <h1 className="sr-only">소원 돌탑</h1>
                <img
                  src={TITLE_LETTERING_IMG}
                  alt="소원 돌탑"
                  referrerPolicy="no-referrer"
                  className="h-14 w-auto max-w-[240px] object-contain drop-shadow-[0_4px_16px_rgba(0,0,0,0.75)] select-none"
                />
                <p className="mt-4 text-[14px] text-[#E6DFD0]/92 leading-relaxed drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
                  돌을 높이 쌓을수록 오전에서 깊은 밤으로
                  <br />
                  산사의 풍경이 천천히 저물어 갑니다.
                </p>
              </div>

              <div className="w-full max-w-[290px] flex flex-col items-center space-y-3.5">
                <div className="w-full xl:hidden">
                  <input
                    type="text"
                    maxLength={32}
                    value={wish}
                    onChange={(e) => setWish(e.target.value)}
                    placeholder="소원을 한 줄 적어보세요 (선택)"
                    aria-label="소원 입력"
                    className="w-full rounded-xl bg-[#111720]/84 text-[#F6F1E5] placeholder:text-[#98A0AA] px-3.5 py-2.5 text-sm border border-[#E4C995]/24 backdrop-blur-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D8AD64]"
                  />
                </div>

                {record.bestHeightCm > 0 && (
                  <p className="text-center text-sm text-[#EFE6D4] tabular-nums drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
                    최고 기록 {record.bestHeightLabel}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleStartGame}
                  aria-label="쌓기 시작"
                  className="px-6 py-2.5 min-h-[42px] rounded-xl bg-[#B56D34] hover:bg-[#C67A3D] active:scale-[0.98] shadow-[0_10px_24px_rgba(0,0,0,0.45)] border border-[#F3D39A]/28 flex items-center justify-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F3D39A] cursor-pointer"
                >
                  <img
                    src={START_LETTERING_IMG}
                    alt="쌓기 시작"
                    referrerPolicy="no-referrer"
                    className="h-[22px] w-auto object-contain select-none pointer-events-none"
                  />
                </button>

                <p className="text-center text-xs text-[#D3CCBE]/80">
                  좌우 드래그 또는 방향키 · 아래로 당겨 빠르게 내리기
                </p>
              </div>
            </div>
          )}

          {/* 게임 종료 결과 오버레이 */}
          {mode === 'gameover' && lastResult && (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-5 bg-[#090D14]/74 backdrop-blur-[4px]">
              <div className="w-full max-w-[300px] rounded-[24px] bg-[#171E28] text-[#F5EFE2] p-6 shadow-[0_24px_56px_rgba(0,0,0,0.58)] border border-[#E5CA98]/22">
                <div className="text-center">
                  <p className="text-xs text-[#C6B79D]">
                    {isNewBest
                      ? '새 최고 기록을 세웠어요'
                      : lastResult.endReason === 'missed'
                      ? '돌이 연못으로 빠졌어요'
                      : '무게중심이 기울었어요'}
                  </p>
                  <h2 className="mt-1 font-display text-2xl text-[#FAF4E8]">
                    {lastResult.endReason === 'missed'
                      ? '돌을 놓쳤어요'
                      : '돌탑이 무너졌어요'}
                  </h2>
                </div>

                <div className="mt-5 py-4 border-y border-white/10 text-center">
                  <p className="font-display text-4xl tabular-nums text-[#E8BC6E] leading-none">
                    {lastResult.heightLabel}
                  </p>
                  <p className="mt-2 text-sm text-[#D6CFC0]">
                    {lastResult.zoneName}
                  </p>
                  {record.bestHeightCm > 0 && (
                    <p className="mt-1 text-xs text-[#98A1AA] tabular-nums">
                      최고 기록 {record.bestHeightLabel}
                    </p>
                  )}
                </div>

                {wish.trim() && (
                  <p className="mt-4 text-center text-sm text-[#E5DAC6] italic leading-relaxed">
                    “{wish.trim()}”
                  </p>
                )}

                <div className="mt-6 flex flex-col items-center space-y-2">
                  <button
                    type="button"
                    onClick={handleStartGame}
                    className="px-6 py-2.5 min-h-[42px] rounded-xl bg-[#386B5E] hover:bg-[#427B6C] active:scale-[0.98] text-[#FAF5EA] font-display text-base flex items-center justify-center gap-2 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8BC6E] cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>다시 쌓기</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleBackToTitle}
                    className="px-4 py-1.5 rounded-lg text-xs text-[#B2B9C0] hover:text-[#F5EFE2] hover:bg-white/6 transition-colors duration-150 cursor-pointer whitespace-nowrap"
                  >
                    처음으로
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 우측 기록 & 시간대별 고도 여정 (넓은 데스크톱 전용) */}
        <aside className="hidden xl:flex flex-col justify-between h-[min(92dvh,840px)] py-5">
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-lg text-[#EBE3D2]">최고 기록</h2>
              <p className="mt-2 font-display text-3xl tabular-nums text-[#E8BC6E] leading-none">
                {record.bestHeightLabel}
              </p>
              <p className="mt-1.5 text-xs text-[#808B94]">{record.bestZoneName}</p>
            </div>

            <div className="pt-5 border-t border-white/10">
              <h2 className="font-display text-lg text-[#EBE3D2]">
                시간과 고도 여정
              </h2>
              <ol className="mt-3 space-y-2.5">
                {ALTITUDE_ZONES.map((zone, idx) => {
                  const isCurrent = zone.name === currentZoneName && mode === 'playing';
                  const unlocked = idx <= highestUnlockedIndex;
                  return (
                    <li
                      key={zone.id}
                      className={`flex items-baseline justify-between gap-2 text-sm transition-colors ${
                        isCurrent
                          ? 'text-[#E8BC6E] font-medium'
                          : unlocked
                          ? 'text-[#E5DEC9]'
                          : 'text-[#69747E]'
                      }`}
                    >
                      <span className="truncate">{zone.name}</span>
                      <span className="text-xs shrink-0 opacity-80">
                        {zone.timeLabel}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="pt-5 border-t border-white/10">
              <h2 className="font-display text-lg text-[#EBE3D2]">최근 쌓은 탑</h2>
              {record.history.length === 0 ? (
                <p className="mt-2.5 text-sm text-[#78838D]">
                  첫 번째 돌탑을 쌓으면 기록이 여기에 남습니다.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-white/8">
                  {record.history.map((item) => (
                    <li key={item.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between text-sm tabular-nums">
                        <span className="text-[#EFE9DB] font-display text-base">
                          {item.heightLabel}
                        </span>
                        <span className="text-xs text-[#959FA8]">
                          {item.zoneName}
                        </span>
                      </div>
                      {item.wish && (
                        <p className="mt-0.5 text-xs text-[#808B94] truncate">
                          {item.wish}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="pt-4 border-t border-white/10 text-xs text-[#737E88]">
            기록은 이 브라우저에 자동 저장됩니다.
          </p>
        </aside>
      </div>
    </main>
  );
}
