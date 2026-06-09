{showSavePrompt && (
  <div className="absolute inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center px-4">
    <div className="bg-white/20 backdrop-blur-sm border border-white/30 rounded-2xl p-5 shadow-xl w-full max-w-sm">
      <div className="text-[17px] font-bold text-white drop-shadow-md mb-2">🎉 Вы прибыли!</div>
      <div className="text-[14px] text-white/80 mb-5">
        Сохранить ваш путь к <span className="font-medium text-white drop-shadow-sm">{arrivedDest?.label}</span>? Система запомнит его и будет предлагать в будущем.
      </div>
      <div className="flex gap-3">
        <button onClick={handleSkipSave} className="flex-1 py-3 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 text-white text-[15px] font-medium">
          Не сохранять
        </button>
        <button onClick={handleSaveRoute} className="flex-1 py-3 rounded-xl bg-amber-500/80 backdrop-blur-sm text-white text-[15px] font-semibold">
          Сохранить
        </button>
      </div>
    </div>
  </div>
)}
