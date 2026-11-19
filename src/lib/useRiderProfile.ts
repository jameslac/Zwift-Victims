import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchProfileById, getCachedProfileById } from '../api/zwiftCore';
import type { ZwiftProfile } from '../api/zwiftCore';
import { useAuth } from '../auth/AuthContext';
import { useFavorites } from './FavoritesContext';

export function formatRiderCategory(profile: ZwiftProfile): string | undefined {
  const metrics = profile.competitionMetrics;
  const openCat = metrics?.category?.trim() || undefined;
  const womenCat = metrics?.categoryWomen?.trim() || undefined;
  if (profile.male === false) {
    if (womenCat && openCat) return `${womenCat} (Women) / ${openCat} (Open)`;
    if (womenCat) return `${womenCat} (Women)`;
    if (openCat) return `${openCat} (Open)`;
    return undefined;
  }
  return openCat ?? womenCat;
}

export function getFavoriteCategory(profile: ZwiftProfile): string | undefined {
  const metrics = profile.competitionMetrics;
  return (
    (profile.male === false
      ? (metrics?.categoryWomen ?? metrics?.category)
      : (metrics?.category ?? metrics?.categoryWomen))?.trim() || undefined
  );
}

export function formatRiderName(profile: ZwiftProfile): string {
  return [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Zwift rider';
}

export type RiderProfileResolution =
  | { status: 'loading'; riderIdParam?: string }
  | { status: 'unauthenticated' }
  | { status: 'invalid_id'; riderIdParam: string }
  | { status: 'error'; riderIdParam: string; message: string }
  | { status: 'loaded'; profile: ZwiftProfile; isOwnProfile: boolean };

export function useRiderProfile(): RiderProfileResolution {
  const { loading, profile: authProfile, getAccessToken } = useAuth();
  const { riderId } = useParams<{ riderId?: string }>();
  const { favorites, upsertFavorite } = useFavorites();

  const parsedRiderId = riderId && /^\d+$/.test(riderId) ? Number(riderId) : null;
  const isInvalidRiderId = Boolean(riderId) && parsedRiderId === null;
  const needsRemoteFetch =
    Boolean(authProfile) && parsedRiderId !== null && parsedRiderId !== authProfile!.id;

  const [fetched, setFetched] = useState<{
    riderId: number;
    profile: ZwiftProfile | null;
    error: string | null;
  } | null>(() => {
    if (parsedRiderId !== null) {
      const cached = getCachedProfileById(parsedRiderId);
      if (cached) return { riderId: parsedRiderId, profile: cached, error: null };
    }
    return null;
  });

  useEffect(() => {
    if (!needsRemoteFetch || parsedRiderId === null) return;
    let cancelled = false;
    getAccessToken()
      .then((token) => fetchProfileById(token, parsedRiderId))
      .then((loaded) => {
        if (!cancelled) setFetched({ riderId: parsedRiderId, profile: loaded, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetched({
            riderId: parsedRiderId,
            profile: null,
            error: err instanceof Error ? err.message : 'Failed to load rider profile.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [getAccessToken, needsRemoteFetch, parsedRiderId]);

  const cachedRemote =
    needsRemoteFetch && parsedRiderId !== null ? getCachedProfileById(parsedRiderId) : undefined;
  const resolvedProfile = needsRemoteFetch
    ? fetched?.riderId === parsedRiderId
      ? fetched.profile
      : (cachedRemote ?? null)
    : authProfile;
  const isOwnProfile = Boolean(
    authProfile && resolvedProfile && resolvedProfile.id === authProfile.id,
  );

  // Keep favorited rider metadata fresh when viewing their profile
  useEffect(() => {
    if (!resolvedProfile || isOwnProfile) return;
    const existing = favorites.find((f) => f.id === resolvedProfile.id);
    if (!existing) return;
    const name = formatRiderName(resolvedProfile);
    const category = getFavoriteCategory(resolvedProfile);
    if (
      existing.name !== name ||
      existing.imageSrc !== resolvedProfile.imageSrc ||
      existing.category !== category
    ) {
      upsertFavorite({
        id: resolvedProfile.id,
        name,
        imageSrc: resolvedProfile.imageSrc,
        category,
      });
    }
  }, [resolvedProfile, isOwnProfile, favorites, upsertFavorite]);

  if (loading) {
    return { status: 'loading', riderIdParam: riderId };
  }

  if (!authProfile) {
    return { status: 'unauthenticated' };
  }

  if (isInvalidRiderId && riderId) {
    return { status: 'invalid_id', riderIdParam: riderId };
  }

  if (needsRemoteFetch) {
    if (cachedRemote) {
      return {
        status: 'loaded',
        profile: cachedRemote,
        isOwnProfile: false,
      };
    }
    if (fetched?.riderId !== parsedRiderId) {
      return { status: 'loading', riderIdParam: String(parsedRiderId) };
    }
    if (fetched.error || !fetched.profile) {
      return {
        status: 'error',
        riderIdParam: String(parsedRiderId),
        message: fetched.error ?? `Unable to load rider ${parsedRiderId}.`,
      };
    }
    return {
      status: 'loaded',
      profile: fetched.profile,
      isOwnProfile: false,
    };
  }

  return {
    status: 'loaded',
    profile: authProfile,
    isOwnProfile: true,
  };
}
