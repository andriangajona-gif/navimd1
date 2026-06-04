import React from 'react';
import { MapPin, Bus, Route, Menu } from 'lucide-react';

export default function BottomBar() {
  const items = [
    { icon: MapPin, label: 'Места' },
    { icon: Bus, label: 'Транспорт' },
    { icon: Route, label: 'Маршрут' },
    { icon: Menu, label: 'Ещё' },
  ];
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 bg-white border-t border-stone-200 px-2 pt-1.5 pb-[max(env(safe-area-inset-bottom),6px)]">
      <div className="flex items-center justify-around">
        {items.map(({ icon: Icon, label }, i) => (
          <button key={i} className="flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 text-stone-600 active:text-amber-600">
            <Icon size={22} />
            <span className="text-[10px] leading-none">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
