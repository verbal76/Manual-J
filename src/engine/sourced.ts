import type { Sourced } from './types';
/** A user-entered number that may be used in a calculation: present, finite, and not tagged UNKNOWN. */
export const usable = (s: Sourced<number> | undefined | null): s is Sourced<number> & { value: number } =>
  !!s && typeof s.value === 'number' && Number.isFinite(s.value) && s.quality !== 'UNKNOWN';
