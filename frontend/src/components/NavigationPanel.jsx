import React, { useEffect, useRef } from 'react';
import { X, Navigation as NavIcon, ArrowUp, ArrowUpLeft, ArrowUpRight, CornerUpLeft, CornerUpRight, RotateCcw, Flag, Play, Loader2 } from 'lucide-react';
import { formatDistance, formatDuration } from '../lib/api';

function maneuverIcon(step) {
  const t = step.type; const m = step.modifier;
  if (t === 'arrive') return <Flag />;
  if (t === 'depart') return <NavIcon />;
  if (t === 'roundabout' || t === 'rotary') return <RotateCcw />;
  if (m === 'left' || m === 'sharp left') return <CornerUpLeft />;
  if (m === 'right' || m === 'sharp right') return <CornerUpRight />;
  if (m === 'slight left') return <ArrowUpLeft />;
  if (m === 'slight right') return <ArrowUpRight />;
  return <ArrowUp />;
}

export default function NavigationPanel({ route, currentStep, destination, onCancel, onFinish, navStarted, onStart, rerouting }) {
  const step = route.steps?.[currentStep] || route.steps?.[0];
  const remainingSteps = route.steps?.slice(currentStep) || [];
  const remainingDist = remainingSteps.reduce((a, s) => a + (s.distance || 0), 0);
  const remainingDur = remainingSteps.reduce((a, s) => a + (s.duration || 0), 0);

  // Функция синтеза речи
  const speak = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // Останавливаем прошлую фразу
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    window.speechSynthesis.speak(utterance);
  };

  // Перепроверка и авто-озвучка при изменении шага (currentStep)
  useEffect(() => {
    if (navStarted && step?.instruction) {
      // Если это первый шаг или он изменился в процессе движения
      if (step.distance > 0) {
        speak(`Через ${formatDistance(step.distance)}. ${step.instruction}`);
      } else {
        speak(step.instruction);
      }
    }
  }, [currentStep, navStarted, step]);

  return (
    <>
      {navStarted && (
        <div className="absolute top-2 left-2 right-2 z-30">
          <div className="bg-stone-900 text-white rounded-2xl shadow-lg px-3 py-2.5 flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-xl bg-amber-500 flex items-center justify-center text-white shrink-0">
              {React.cloneElement(maneuverIcon(step), { size: 24 })}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-amber-300 font-semibold leading-none mb-0.5">
                через {formatDistance(step.distance)}
              </div>
              <div className="text-[14px] leading-tight line-clamp-2">{step.instruction}</div>
            </div>
            <button
              onClick={onCancel}
              className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-white shrink-0"
              aria-label="cancel"
            ><X size={16} /></button>
          </div>
          {rerouting && (
            <div className="mt-2 mx-auto w-fit bg-stone-900/85 text-white text-[12px] rounded-full px-3 py-1.5 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Перестраиваю маршрут…
            </div>
          )}
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-30 bg-white rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-3 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        {!navStarted ? (
          <>
            <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-stone-500 leading-none mb-1">Маршрут</div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <div className="text-[22px] font-bold text-stone-900 leading-none">{formatDuration(remainingDur)}</div>
                  <div className="text-[14px] text-stone-600 leading-none">{formatDistance(remainingDist)}</div>
                </div>
                {destination?.label && (
                  <div className="text-[12px] text-stone-500 truncate mt-1">{destination.label}</div>
                )}
              </div>
              <button
                onClick={onCancel}
                className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 shrink-0"
                aria-label="cancel"
              ><X size={18} /></button>
            </div>
            <button
              onClick={() => {
                // Хак для iOS Safari: разблокируем аудио-контекст при первом клике на Старт
                if ('speechSynthesis' in window) {
                  window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
                }
                onStart();
              }}
              className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[16px] font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition-transform shadow-sm"
            >
              <Play size={20} fill="currentColor" />
              Старт
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-stone-500 leading-none mb-1">До цели</div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <div className="text-[18px] font-bold text-stone-900 leading-none">{formatDuration(remainingDur)}</div>
                <div className="text-[13px] text-stone-600 leading-none">{formatDistance(remainingDist)}</div>
              </div>
              {destination?.label && (
                <div className="text-[11px] text-stone-500 truncate mt-1">{destination.label}</div>
              )}
            </div>
            <button
              onClick={onFinish || onCancel}
              className="px-3.5 py-2.5 rounded-xl bg-red-500 text-white text-[13px] font-semibold active:scale-95 transition-transform shrink-0"
            >Завершить</button>
          </div>
        )}
      </div>
    </>
  );
}
