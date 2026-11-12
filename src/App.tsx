import { useEffect, useState } from 'react';

interface ApiHealth {
  status: string;
  service: string;
  timestamp: string;
}

export default function App() {
  const [health, setHealth] = useState<ApiHealth | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-100">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#fc6719] text-white font-black text-3xl shadow-lg">
          Z
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">Zwift Victims</h1>
          <p className="text-slate-400 text-sm">
            Head-to-Head Zwift Race Tracker, Telemetry &amp; Equipment Analytics
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-left text-xs font-mono space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">PWA Frontend:</span>
            <span className="text-emerald-400 font-semibold">Online</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Cloudflare API Worker:</span>
            {health ? (
              <span className="text-emerald-400 font-semibold">{health.status}</span>
            ) : (
              <span className="text-amber-400">Local Dev / Standby</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
