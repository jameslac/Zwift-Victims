import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

const STORAGE_KEY = 'zv.favorites';

export interface FavoriteRider {
  id: number;
  name: string;
  imageSrc?: string;
  category?: string;
  addedAt: number;
}

export type FavoriteRiderInput = Omit<FavoriteRider, 'addedAt'>;

interface FavoritesState {
  favorites: FavoriteRider[];
  isFavorite: (riderId: number) => boolean;
  toggleFavorite: (rider: FavoriteRiderInput) => void;
  upsertFavorite: (rider: FavoriteRiderInput) => void;
  removeFavorite: (riderId: number) => void;
}

const FavoritesContext = createContext<FavoritesState | null>(null);

function isValidFavorite(item: unknown): item is FavoriteRider {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    Number.isInteger(candidate.id) &&
    candidate.id > 0 &&
    typeof candidate.name === 'string' &&
    typeof candidate.addedAt === 'number'
  );
}

function loadFavorites(): FavoriteRider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFavorite);
  } catch {
    return [];
  }
}

function saveFavorites(items: FavoriteRider[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota or private-browsing errors.
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteRider[]>(loadFavorites);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const isFavorite = useCallback((riderId: number) => favoriteIds.has(riderId), [favoriteIds]);

  const upsertFavorite = useCallback((rider: FavoriteRiderInput) => {
    setFavorites((prev) => {
      const existingIndex = prev.findIndex((f) => f.id === rider.id);
      if (existingIndex === -1) {
        return [...prev, { ...rider, addedAt: Date.now() }];
      }
      const next = [...prev];
      next[existingIndex] = {
        ...next[existingIndex],
        ...rider,
      };
      return next;
    });
  }, []);

  const removeFavorite = useCallback((riderId: number) => {
    setFavorites((prev) => prev.filter((f) => f.id !== riderId));
  }, []);

  const toggleFavorite = useCallback((rider: FavoriteRiderInput) => {
    setFavorites((prev) => {
      if (prev.some((f) => f.id === rider.id)) {
        return prev.filter((f) => f.id !== rider.id);
      }
      return [...prev, { ...rider, addedAt: Date.now() }];
    });
  }, []);

  const value = useMemo(
    () => ({ favorites, isFavorite, toggleFavorite, upsertFavorite, removeFavorite }),
    [favorites, isFavorite, toggleFavorite, upsertFavorite, removeFavorite],
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites(): FavoritesState {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites must be used within FavoritesProvider');
  return ctx;
}
