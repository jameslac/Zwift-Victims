import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { ZwiftProfile } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import { useFavorites } from '../lib/FavoritesContext';
import { useTheme } from '../lib/ThemeContext';
import { COLOR_SCHEMES } from '../lib/themeConfig';
import { formatRiderName, getFavoriteCategory } from '../lib/useRiderProfile';
import type { UnitSystem } from '../lib/units';

export type ActiveNavTab = 'profile' | 'history' | 'victims' | 'detail';

function ProfileNavIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </svg>
  );
}

function HistoryNavIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

function VictimsNavIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

function PaletteIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

export function ThemePreferencesModal({ onClose }: { onClose: () => void }) {
  const { colorScheme, setColorScheme } = useTheme();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Color Theme Preferences"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[88dvh] overflow-y-auto rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl p-5 sm:p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-accent/15 border border-accent/40 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-accent-text">
              <PaletteIcon className="w-3.5 h-3.5" />
              <span>Theme Preferences</span>
            </div>
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-100">
              Choose Your Color Scheme
            </h2>
            <p className="text-xs text-slate-400">
              Personalize your app palette. Your choice is saved automatically on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close theme preferences"
            className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Done
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {COLOR_SCHEMES.map((scheme) => {
            const active = colorScheme === scheme.id;
            return (
              <button
                key={scheme.id}
                type="button"
                onClick={() => setColorScheme(scheme.id)}
                aria-pressed={active}
                className={`text-left rounded-xl border p-3 transition-all flex items-start gap-3 ${
                  active
                    ? 'border-accent bg-accent/10 ring-1 ring-accent'
                    : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                }`}
              >
                <div
                  className="w-9 h-9 rounded-lg border border-white/15 shrink-0 flex items-center justify-center shadow-inner"
                  style={{ backgroundColor: scheme.surfaceHex }}
                >
                  <div className="flex -space-x-1">
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/40"
                      style={{ backgroundColor: scheme.accentHex }}
                    />
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/40"
                      style={{ backgroundColor: scheme.secondaryHex }}
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-100">{scheme.name}</span>
                    {scheme.badge && (
                      <span className="rounded-full bg-accent/20 border border-accent/40 px-1.5 py-0.2 text-[10px] font-bold text-accent-text">
                        {scheme.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{scheme.tagline}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AppHeader({
  isOwnProfile,
  units,
  onUnitsChange,
  onLogout,
  backTo,
  backLabel,
  targetRiderId,
  activeTab: explicitActiveTab,
}: {
  isOwnProfile: boolean;
  units: UnitSystem;
  onUnitsChange: (u: UnitSystem) => void;
  onLogout: () => void;
  backTo?: string;
  backLabel?: string;
  targetRiderId?: number;
  activeTab?: ActiveNavTab;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile: authProfile } = useAuth();
  const { favorites } = useFavorites();
  const { colorScheme, setColorScheme, studioOpen, setStudioOpen } = useTheme();
  const [lookupId, setLookupId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const currentScheme = COLOR_SCHEMES.find((s) => s.id === colorScheme) ?? COLOR_SCHEMES[0];

  const ownProfileId = authProfile?.id;
  const rivalsCount = favorites.filter((f) => f.id !== ownProfileId).length;

  const basePath =
    !isOwnProfile && targetRiderId ? `/riders/${encodeURIComponent(String(targetRiderId))}` : '';
  const profilePath = basePath || '/';
  const historyPath = basePath ? `${basePath}/history` : '/history';
  const victimsPath = '/victims';

  const inferredTab: ActiveNavTab =
    explicitActiveTab ??
    (location.pathname.endsWith('/history') || location.pathname === '/history'
      ? 'history'
      : location.pathname.endsWith('/victims') || location.pathname === '/victims'
        ? 'victims'
        : location.pathname.includes('/races/') || location.pathname.includes('/activities/')
          ? 'detail'
          : 'profile');

  function handleLookupSubmit(e: FormEvent) {
    e.preventDefault();
    const cleaned = lookupId.trim();
    if (!/^\d+$/.test(cleaned)) return;
    setLookupId('');
    setDrawerOpen(false);
    navigate(`/riders/${cleaned}`);
  }

  const navItems: Array<{
    id: Exclude<ActiveNavTab, 'detail'>;
    label: string;
    shortLabel: string;
    to: string;
    icon: ReactNode;
    badge?: number;
  }> = [
    {
      id: 'profile',
      label: isOwnProfile ? 'Profile' : 'Rider Profile',
      shortLabel: 'Profile',
      to: profilePath,
      icon: <ProfileNavIcon className="w-4 h-4" />,
    },
    {
      id: 'history',
      label: isOwnProfile ? 'Race History' : 'Rider History',
      shortLabel: 'History',
      to: historyPath,
      icon: <HistoryNavIcon className="w-4 h-4" />,
    },
    {
      id: 'victims',
      label: 'Victims',
      shortLabel: 'Victims',
      to: victimsPath,
      icon: <VictimsNavIcon className="w-4 h-4" />,
      badge: rivalsCount > 0 ? rivalsCount : undefined,
    },
  ];

  return (
    <>
      <header className="sticky top-0 z-30 -mx-4 sm:-mx-8 px-4 sm:px-8 py-3 backdrop-blur-xl bg-slate-950/88 border-b border-slate-800/80">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          {/* Left: Brand + Back/Context Link */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 font-extrabold text-base sm:text-lg tracking-tight text-slate-100 hover:opacity-90 transition-opacity shrink-0"
            >
              <span
                className="inline-flex items-center justify-center w-8 h-8 rounded-xl text-white font-black text-sm shadow-md"
                style={{
                  background: `linear-gradient(135deg, ${currentScheme.accentHex}, ${currentScheme.secondaryHex})`,
                }}
              >
                Z
              </span>
              <span>Zwift Victims</span>
            </Link>

            {backTo && backLabel && (
              <Link
                to={backTo}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors truncate"
              >
                <span>{backLabel}</span>
              </Link>
            )}

            {!isOwnProfile && !backTo && (
              <Link
                to="/"
                className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent-text hover:bg-accent/20 transition-colors shrink-0"
              >
                <span>← My Profile</span>
              </Link>
            )}
          </div>

          {/* Center: Desktop Segmented Navigation (md+) */}
          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center rounded-xl bg-slate-900/90 border border-slate-800 p-1 gap-1"
          >
            {navItems.map((item) => {
              const active = inferredTab === item.id;
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${
                    active
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 text-[10px] font-extrabold tabular-nums ${
                        active
                          ? 'bg-black/25 text-white'
                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right: Theme Picker + Desktop Search & Controls + Mobile Menu Button */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              title={`Theme: ${currentScheme.name} (Click to change)`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/90 bg-slate-900/90 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: currentScheme.accentHex }}
              />
              <span className="hidden sm:inline">{currentScheme.name}</span>
              <span className="sm:hidden">Theme</span>
            </button>

            <form onSubmit={handleLookupSubmit} className="hidden lg:flex items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Rider ID…"
                aria-label="View rider by Zwift ID"
                value={lookupId}
                onChange={(e) => setLookupId(e.target.value)}
                className="w-28 rounded-xl bg-slate-900 border border-slate-700/90 px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!/^\d+$/.test(lookupId.trim())}
                className="rounded-xl border border-slate-700/90 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Go
              </button>
            </form>

            <div
              role="group"
              aria-label="Units"
              className="hidden sm:inline-flex rounded-xl border border-slate-700/90 bg-slate-900 p-0.5 text-xs"
            >
              <button
                type="button"
                onClick={() => onUnitsChange('metric')}
                aria-pressed={units === 'metric'}
                className={`rounded-lg px-2 py-1 font-bold transition-colors ${
                  units === 'metric'
                    ? 'bg-accent text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                KG
              </button>
              <button
                type="button"
                onClick={() => onUnitsChange('imperial')}
                aria-pressed={units === 'imperial'}
                className={`rounded-lg px-2 py-1 font-bold transition-colors ${
                  units === 'imperial'
                    ? 'bg-accent text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                LB
              </button>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="hidden sm:inline-flex rounded-xl border border-slate-700/90 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              Log out
            </button>

            {/* Mobile / Tablet Utility Menu Button */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu and rider lookup"
              className="inline-flex lg:hidden items-center justify-center rounded-xl border border-slate-700/90 bg-slate-900 p-2 text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Slide-Over Utility & Options Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation & preferences menu"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-full max-w-xs bg-slate-900 border-l border-slate-800 h-full p-5 flex flex-col justify-between gap-6 overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
                <div className="flex items-center gap-2 font-extrabold text-base text-slate-100">
                  <span
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-white font-black text-xs"
                    style={{
                      background: `linear-gradient(135deg, ${currentScheme.accentHex}, ${currentScheme.secondaryHex})`,
                    }}
                  >
                    Z
                  </span>
                  <span>Menu &amp; Options</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white"
                >
                  Close
                </button>
              </div>

              {/* Rider Lookup */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
                  Inspect Rider by Zwift ID
                </p>
                <form onSubmit={handleLookupSubmit} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Enter Zwift ID…"
                    aria-label="View rider by Zwift ID"
                    value={lookupId}
                    onChange={(e) => setLookupId(e.target.value)}
                    className="flex-1 rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent"
                  />
                  <button
                    type="submit"
                    disabled={!/^\d+$/.test(lookupId.trim())}
                    className="rounded-xl bg-accent px-3.5 py-2 text-sm font-bold text-white disabled:opacity-40"
                  >
                    Go
                  </button>
                </form>
              </div>

              {/* Navigation Links */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
                  Pages
                </p>
                {navItems.map((item) => {
                  const active = inferredTab === item.id;
                  return (
                    <Link
                      key={item.id}
                      to={item.to}
                      onClick={() => setDrawerOpen(false)}
                      className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors ${
                        active ? 'bg-accent text-white' : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        {item.icon}
                        <span>{item.label}</span>
                      </span>
                      {item.badge !== undefined && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                            active ? 'bg-black/25 text-white' : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
                {!isOwnProfile && (
                  <Link
                    to="/"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2.5 text-sm font-bold text-accent-text hover:bg-accent/20 mt-2"
                  >
                    <span>← Back to My Profile</span>
                  </Link>
                )}
              </div>

              {/* Units Toggle */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1">
                  Measurement Units
                </p>
                <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-950 border border-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => onUnitsChange('metric')}
                    className={`rounded-lg py-1.5 text-xs font-bold transition-colors ${
                      units === 'metric'
                        ? 'bg-accent text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Metric (kg, km)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUnitsChange('imperial')}
                    className={`rounded-lg py-1.5 text-xs font-bold transition-colors ${
                      units === 'imperial'
                        ? 'bg-accent text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Imperial (lb, mi)
                  </button>
                </div>
              </div>

              {/* Inline Color Theme Picker */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Color Scheme
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false);
                      setStudioOpen(true);
                    }}
                    className="text-[11px] font-semibold text-accent-text hover:underline"
                  >
                    Details
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {COLOR_SCHEMES.map((scheme) => {
                    const active = colorScheme === scheme.id;
                    return (
                      <button
                        key={scheme.id}
                        type="button"
                        onClick={() => setColorScheme(scheme.id)}
                        aria-pressed={active}
                        className={`rounded-xl border p-2 text-left transition-all flex flex-col gap-1.5 ${
                          active
                            ? 'border-accent bg-accent/15'
                            : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: scheme.accentHex }}
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: scheme.secondaryHex }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-slate-200 leading-tight truncate">
                          {scheme.name.replace('Neon ', '').replace('Classic ', '')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  onLogout();
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
              >
                Log out of Zwift
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar (< md) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="fixed bottom-0 inset-x-0 z-30 md:hidden backdrop-blur-xl bg-slate-950/95 border-t border-slate-800/90 px-3 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="max-w-md mx-auto grid grid-cols-3 gap-1">
          {navItems.map((item) => {
            const active = inferredTab === item.id;
            return (
              <Link
                key={item.id}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 px-2 text-[11px] font-bold transition-colors ${
                  active
                    ? 'bg-accent/15 text-accent-text'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative flex items-center justify-center">
                  {item.icon}
                  {item.badge !== undefined && (
                    <span className="absolute -top-1.5 -right-3.5 rounded-full bg-accent px-1.5 py-0.1 text-[9px] font-extrabold text-white tabular-nums shadow">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span>{item.shortLabel}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {studioOpen && <ThemePreferencesModal onClose={() => setStudioOpen(false)} />}
    </>
  );
}

export function RiderContextBanner({
  profile,
  isOwnProfile,
}: {
  profile: ZwiftProfile;
  isOwnProfile: boolean;
}) {
  const { isFavorite, toggleFavorite } = useFavorites();
  if (isOwnProfile) return null;

  const name = formatRiderName(profile);
  const favoriteCategory = getFavoriteCategory(profile);
  const favorited = isFavorite(profile.id);

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-accent/35 p-3 sm:px-4 sm:py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {profile.imageSrc ? (
          <img
            src={profile.imageSrc}
            alt={name}
            className="w-8 h-8 rounded-full object-cover border border-accent/60 shrink-0"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-200 shrink-0">
            {name[0]}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-accent-text uppercase tracking-wider">
              Inspecting Rider
            </span>
            <span className="text-xs text-slate-400">· ID #{profile.id}</span>
          </div>
          <p className="text-sm font-extrabold text-slate-100 truncate">{name}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() =>
            toggleFavorite({
              id: profile.id,
              name,
              imageSrc: profile.imageSrc,
              category: favoriteCategory,
            })
          }
          aria-pressed={favorited}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
            favorited
              ? 'bg-amber-500/15 border-amber-400/50 text-amber-300 hover:bg-amber-500/25'
              : 'bg-slate-950 border-slate-700 text-slate-200 hover:border-amber-400/50 hover:text-amber-300'
          }`}
        >
          <span aria-hidden="true">{favorited ? '★' : '☆'}</span>
          <span>{favorited ? 'In Victims List' : 'Add to Victims'}</span>
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-accent/60 hover:text-accent-text transition-colors"
        >
          <span>My Profile</span>
        </Link>
      </div>
    </div>
  );
}
