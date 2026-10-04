// The types of the oracle's note generators in generate.mjs, a plain
// JavaScript file the oracle runs directly, for the tests that use them.

/** `count` small container-heavy notes from `seed`, the same notes for the same seed. */
export function generateNotes(seed: number, count: number): string[];

/** `count` notes from `seed` by the broad generator, written the way people write notes, the same notes for the same seed. */
export function generateBroadNotes(seed: number, count: number): string[];
