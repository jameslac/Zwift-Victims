export type ColorSchemeId =
  | 'emerald'
  | 'gold'
  | 'jaguars'
  | 'okc_thunder'
  | 'jchillz'
  | 'neon_purple'
  | 'cyberpunk'
  | 'laser'
  | 'volt'
  | 'cobalt'
  | 'crimson'
  | 'amethyst'
  | 'watopia';

export interface ColorSchemeOption {
  id: ColorSchemeId;
  name: string;
  tagline: string;
  accentHex: string;
  secondaryHex: string;
  tertiaryHex?: string;
  surfaceHex: string;
  cardHex: string;
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
  },
  {
    id: 'gold',
    name: 'Black & Gold',
    tagline: 'Pure pitch-black obsidian with metallic championship gold & amber',
    accentHex: '#eab308',
    secondaryHex: '#f59e0b',
    surfaceHex: '#050505',
    cardHex: '#100e09',
  },
  {
    id: 'jaguars',
    name: 'Jacksonville Jaguars',
    tagline: 'Duval teal & championship gold on jaguar obsidian black',
    accentHex: '#007a8c',
    secondaryHex: '#d7a22a',
    surfaceHex: '#05090b',
    cardHex: '#0b1418',
  },
  {
    id: 'okc_thunder',
    name: 'OKC Thunder',
    tagline: 'Thunder blue & sunset orange over midnight navy',
    accentHex: '#007ac1',
    secondaryHex: '#ef3b24',
    surfaceHex: '#040a14',
    cardHex: '#081629',
  },
  {
    id: 'jchillz',
    name: 'JChillz Cryo-HUD',
    tagline: 'Deep obsidian & frost white with electric ice cyan, arctic mint & cryo violet',
    accentHex: '#00f0ff',
    secondaryHex: '#8a2be2',
    tertiaryHex: '#00ffaa',
    surfaceHex: '#0b0f19',
    cardHex: '#111827',
  },
  {
    id: 'neon_purple',
    name: 'Purple & Neon',
    tagline: 'Deep ultraviolet carbon with electric purple & neon acid lime',
    accentHex: '#9333ea',
    secondaryHex: '#39ff14',
    surfaceHex: '#07040e',
    cardHex: '#110a22',
  },
  {
    id: 'cyberpunk',
    name: 'Neon Synthwave',
    tagline: 'Midnight void with electric hot-pink magenta & neon laser cyan',
    accentHex: '#ff2a85',
    secondaryHex: '#00f0ff',
    surfaceHex: '#06040f',
    cardHex: '#100b21',
  },
  {
    id: 'laser',
    name: 'Neon Cyber Cyan',
    tagline: 'Deep tech carbon with hyper-neon electric cyan & acid lime',
    accentHex: '#06b6d4',
    secondaryHex: '#a3e635',
    surfaceHex: '#04090e',
    cardHex: '#0a151f',
  },
  {
    id: 'volt',
    name: 'Neon Volt',
    tagline: 'Matte zinc carbon with high-visibility acid volt-lime & emerald',
    accentHex: '#84cc16',
    secondaryHex: '#10b981',
    surfaceHex: '#09090b',
    cardHex: '#131317',
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
    tagline: 'Deep cosmic graphite with electric violet & neon magenta',
    accentHex: '#8b5cf6',
    secondaryHex: '#ec4899',
    surfaceHex: '#080710',
    cardHex: '#121022',
  },
  {
    id: 'watopia',
    name: 'Classic Orange',
    tagline: 'Classic slate & orange palette',
    accentHex: '#fc6719',
    secondaryHex: '#f59e0b',
    surfaceHex: '#020617',
    cardHex: '#0f172a',
  },
];
