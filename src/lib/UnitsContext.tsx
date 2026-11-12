import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { UnitSystem } from './units';

const KEY = 'zv.units';

interface UnitsState {
  /** The user's explicit choice, or null if they haven't picked one yet. */
  choice: UnitSystem | null;
  setUnits: (u: UnitSystem) => void;
}

const UnitsContext = createContext<UnitsState | null>(null);

function loadChoice(): UnitSystem | null {
  const v = localStorage.getItem(KEY);
  return v === 'imperial' || v === 'metric' ? v : null;
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<UnitSystem | null>(loadChoice);
  const setUnits = (u: UnitSystem) => {
    localStorage.setItem(KEY, u);
    setChoice(u);
  };
  return <UnitsContext.Provider value={{ choice, setUnits }}>{children}</UnitsContext.Provider>;
}

/**
 * Returns the active unit system: the user's explicit choice if they made one,
 * otherwise `fallback` (e.g. derived from their Zwift `useMetric` setting).
 */
export function useUnits(fallback: UnitSystem = 'metric'): {
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
} {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return { units: ctx.choice ?? fallback, setUnits: ctx.setUnits };
}
