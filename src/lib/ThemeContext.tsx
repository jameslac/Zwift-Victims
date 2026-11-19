import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { COLOR_SCHEMES } from './themeConfig';
import type { ColorSchemeId } from './themeConfig';

const COLOR_SCHEME_KEY = 'zv.ui.colorScheme';

interface ThemeContextState {
  colorScheme: ColorSchemeId;
  setColorScheme: (id: ColorSchemeId) => void;
  studioOpen: boolean;
  setStudioOpen: (open: boolean) => void;
}

const ThemeContext = createContext<ThemeContextState | null>(null);

function loadColorScheme(): ColorSchemeId {
  try {
    const raw = localStorage.getItem(COLOR_SCHEME_KEY);
    if (raw && COLOR_SCHEMES.some((s) => s.id === raw)) {
      return raw as ColorSchemeId;
    }
  } catch {
    // Ignore storage errors
  }
  return 'emerald';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorSchemeId>(loadColorScheme);
  const [studioOpen, setStudioOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    const scheme = COLOR_SCHEMES.find((s) => s.id === colorScheme);
    if (scheme) {
      const meta = document.querySelector('meta[name="theme-color"]');
      // Use the dark surface color so installed iOS/Android PWAs never show a colored sliver at the bottom/top bars
      if (meta) meta.setAttribute('content', scheme.surfaceHex);
    }
  }, [colorScheme]);

  const setColorScheme = useCallback((id: ColorSchemeId) => {
    try {
      localStorage.setItem(COLOR_SCHEME_KEY, id);
    } catch {
      // Ignore storage errors
    }
    setColorSchemeState(id);
  }, []);

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
      studioOpen,
      setStudioOpen,
    }),
    [colorScheme, setColorScheme, studioOpen],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
