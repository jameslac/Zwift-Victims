import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { UnitSystem } from './units';

const KEY = 'zv.units';

interface UnitsState {
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
}

const UnitsContext = createContext<UnitsState | null>(null);

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [units, setUnitsState] = useState<UnitSystem>(() =>
    localStorage.getItem(KEY) === 'imperial' ? 'imperial' : 'metric',
  );
  const setUnits = (u: UnitSystem) => {
    localStorage.setItem(KEY, u);
    setUnitsState(u);
  };
  return <UnitsContext.Provider value={{ units, setUnits }}>{children}</UnitsContext.Provider>;
}

export function useUnits(): UnitsState {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error('useUnits must be used within UnitsProvider');
  return ctx;
}
