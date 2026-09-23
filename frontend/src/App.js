import React, { useEffect, useState } from 'react';
import './App.css';
import NavigatorApp from './components/NavigatorApp';

function isAfterSunset(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return hour >= 19 || hour < 7;
}

function App() {
  const [nightMode, setNightMode] = useState(() => isAfterSunset());

  useEffect(() => {
    const tick = () => setNightMode(isAfterSunset());
    tick();
    const timer = window.setInterval(tick, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`app-theme${nightMode ? ' night-theme' : ''}`}>
      <NavigatorApp />
    </div>
  );
}

export default App;
