export type ColorSchemeId = 'emerald' | 'cobalt' | 'volt' | 'crimson' | 'amethyst' | 'watopia';
export type NavStyleId = 'hybrid' | 'drawer' | 'tabs';
export type ProfileLayoutId = 'bento' | 'split' | 'tabbed';

export interface ColorSchemeOption {
  id: ColorSchemeId;
  name: string;
  tagline: string;
  accentHex: string;
  secondaryHex: string;
  surfaceHex: string;
  cardHex: string;
  recommended?: boolean;
  legacy?: boolean;
}

export interface NavStyleOption {
  id: NavStyleId;
  name: string;
  shortName: string;
  description: string;
  recommended?: boolean;
}

export interface ProfileLayoutOption {
  id: ProfileLayoutId;
  name: string;
  shortName: string;
  description: string;
  recommended?: boolean;
}

export const COLOR_SCHEMES: readonly ColorSchemeOption[] = [
  {
    id: 'emerald',
    name: 'Aero Emerald',
    tagline: 'Obsidian carbon with electric mint & cyan telemetry accents',
    accentHex: '#10b981',
    secondaryHex: '#06b6d4',
    surfaceHex: '#070b0e',
    cardHex: '#0e161d',
    recommended: true,
  },
  {
    id: 'cobalt',
    name: 'Stratos Cobalt',
    tagline: 'Abyssal navy with electric sky-blue & indigo accents',
    accentHex: '#0ea5e9',
    secondaryHex: '#6366f1',
    surfaceHex: '#060a14',
    cardHex: '#0e1526',
  },
  {
    id: 'volt',
    name: 'Peloton Volt',
    tagline: 'Matte zinc carbon with high-visibility acid lime & emerald',
    accentHex: '#84cc16',
    secondaryHex: '#10b981',
    surfaceHex: '#09090b',
    cardHex: '#131317',
  },
  {
    id: 'crimson',
    name: 'Nocturne Rose',
    tagline: 'Warm carbon noir with punchy race-day crimson & coral',
    accentHex: '#f43f5e',
    secondaryHex: '#fb923c',
    surfaceHex: '#0c080b',
    cardHex: '#171016',
  },
  {
    id: 'amethyst',
    name: 'Ultraviolet',
    tagline: 'Deep cosmic graphite with electric violet & magenta',
    accentHex: '#8b5cf6',
    secondaryHex: '#ec4899',
    surfaceHex: '#080710',
    cardHex: '#121022',
  },
  {
    id: 'watopia',
    name: 'Classic Orange',
    tagline: 'Legacy slate & orange palette for A/B comparison',
    accentHex: '#fc6719',
    secondaryHex: '#f59e0b',
    surfaceHex: '#020617',
    cardHex: '#0f172a',
    legacy: true,
  },
];

export const NAV_STYLES: readonly NavStyleOption[] = [
  {
    id: 'hybrid',
    name: 'Hybrid (Mobile Bottom Bar + Web Top Tabs)',
    shortName: 'Hybrid Bar',
    description:
      'Fixed 3-tab bottom bar on mobile (thumb-friendly PWA feel) + segmented top bar on desktop, with a top utility menu.',
    recommended: true,
  },
  {
    id: 'drawer',
    name: 'Hamburger Slide-Over Menu',
    shortName: 'Hamburger Menu',
    description:
      'Minimal top header on both mobile & web with a slide-over hamburger drawer for pages, rider search, and settings.',
  },
  {
    id: 'tabs',
    name: 'Sticky Top Segmented Tabs',
    shortName: 'Top Tabs',
    description:
      'Sticky horizontal segmented tab bar at the top of the screen on both mobile and desktop.',
  },
];

export const PROFILE_LAYOUTS: readonly ProfileLayoutOption[] = [
  {
    id: 'bento',
    name: 'Telemetry Bento Grid',
    shortName: 'Bento Grid',
    description:
      'Hero card with primary power thresholds (FTP, W/kg, zFTP, zMAP), 2-panel Competitive vs. Career Bento row, then ZwiftRacing & Power Curve.',
    recommended: true,
  },
  {
    id: 'split',
    name: 'Pro Dossier Split Sidebar',
    shortName: 'Split Dossier',
    description:
      'Desktop 2-column layout with a sticky left Rider Dossier (identity, XP, thresholds, career stats) and right-hand analytics column.',
  },
  {
    id: 'tabbed',
    name: 'Focused Sub-Tabbed Profile',
    shortName: 'Sub-Tabbed',
    description:
      'Compact rider banner with sub-tabs (Overview & Bio | ZwiftRacing & Phenotype | Power Curve) to eliminate vertical scrolling.',
  },
];
