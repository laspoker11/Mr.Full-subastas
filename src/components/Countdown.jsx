import { useEffect, useState } from "react";

export function timeParts(endsAt) {
  const diff = new Date(endsAt).getTime() - Date.now();
  const expired = diff <= 0;
  const s = Math.max(0, Math.floor(diff / 1000));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  return { days, hours, mins, secs, expired };
}

export function useClockTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

export default function Countdown({ endsAt }) {
  useClockTick();
  const { days, hours, mins, secs, expired } = timeParts(endsAt);
  if (expired) return <span>Tiempo agotado</span>;
  return (
    <span>
      {days}D : {String(hours).padStart(2, "0")}H : {String(mins).padStart(2, "0")}M : {String(secs).padStart(2, "0")}S
    </span>
  );
}
