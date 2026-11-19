import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { COLOR_SCHEMES, NAV_STYLES, PROFILE_LAYOUTS } from './themeConfig';
import type { ColorSchemeId, NavStyleId, ProfileLayoutId } from './themeConfig';

const COLOR_SCHEME_KEY = 'zv.ui.colorScheme';
const NAV_STYLE_KEY = 'zv.ui.navStyle';
const PROFILE_LAYOUT_KEY = 'zv.ui.profileLayout';

interface ThemeContextState {
  colorScheme: ColorSchemeId;
  setColorScheme: (id: ColorSchemeId) => void;
  navStyle: NavStyleId;
  setNavStyle: (id: NavStyleId) => void;
  profileLayout: ProfileLayoutId;
  setProfileLayout: (id: ProfileLayoutId) => void;
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

function loadNavStyle(): NavStyleId {
  try {
    const raw = localStorage.getItem(NAV_STYLE_KEY);
    if (raw && NAV_STYLES.some((s) => s.id === raw)) {
      return raw as NavStyleId;
    }
  } catch {
    // Ignore storage errors
  }
  return 'hybrid';
}

function loadProfileLayout(): ProfileLayoutId {
  try {
    const raw = localStorage.getItem(PROFILE_LAYOUT_KEY);
    if (raw && PROFILE_LAYOUTS.some((s) => s.id === raw)) {
      return raw as ProfileLayoutId;
    }
  } catch {
    // Ignore storage errors
  }
  return 'bento';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorSchemeId>(loadColorScheme);
  const [navStyle, setNavStyleState] = useState<NavStyleId>(loadNavStyle);
  const [profileLayout, setProfileLayoutState] = useState<ProfileLayoutId>(loadProfileLayout);
  const [studioOpen, setStudioOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    const scheme = COLOR_SCHEMES.find((s) => s.id === colorScheme);
    if (scheme) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', scheme.accentHex);
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

  const setNavStyle = useCallback((id: NavStyleId) => {
    try {
      localStorage.setItem(NAV_STYLE_KEY, id);
    } catch {
      // Ignore storage errors
    }
    setNavStyleState(id);
  }, []);

  const setProfileLayout = useCallback((id: ProfileLayoutId) => {
    try {
      localStorage.setItem(PROFILE_LAYOUT_KEY, id);
    } catch {
      // Ignore storage errors
    }
    setProfileLayoutState(id);
  }, []);

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
      navStyle,
      setNavStyle,
      profileLayout,
      setProfileLayout,
      studioOpen,
      setStudioOpen,
    }),
    [
      colorScheme,
      setColorScheme,
      navStyle,
      setNavStyle,
      profileLayout,
      setProfileLayout,
      studioOpen,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
