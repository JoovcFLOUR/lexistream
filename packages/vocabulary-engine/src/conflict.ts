import type {
  ContextOccurrence,
  FlashcardRecord,
  LexicalMeaning,
  VocabularyItem,
} from '@lexistream/shared-types';

function occurrenceSignature(occ: ContextOccurrence): string {
  const bucket15s = Math.floor(occ.timestamp / 15);
  return `${occ.video_id}::${bucket15s}::${occ.context.trim().toLowerCase()}`;
}

export function mergeOccurrences(
  local: ContextOccurrence[],
  incoming: ContextOccurrence[],
): ContextOccurrence[] {
  const map = new Map<string, ContextOccurrence>();
  for (const occ of [...local, ...incoming]) {
    const sig = occurrenceSignature(occ);
    if (!map.has(sig)) {
      map.set(sig, occ);
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  );
}

export function mergeMeanings(
  local: LexicalMeaning[],
  incoming: LexicalMeaning[],
): LexicalMeaning[] {
  const map = new Map<string, LexicalMeaning>();
  for (const m of [...local, ...incoming]) {
    const sig = `${m.part_of_speech}::${m.translation.trim().toLowerCase()}`;
    if (!map.has(sig)) {
      map.set(sig, m);
    }
  }
  return Array.from(map.values());
}

/**
 * Deterministic CRDT-inspired merge for VocabularyItem:
 * - Set-union for occurrences, surface_forms, meanings, custom_examples, tags.
 * - Version + ISO timestamp tie-breaker for mutable scalar fields.
 */
export function mergeVocabularyItems(
  local: VocabularyItem,
  remote: VocabularyItem,
): VocabularyItem {
  const remoteWinsScalar =
    remote.version > local.version ||
    (remote.version === local.version && remote.updated_at >= local.updated_at);

  const winner = remoteWinsScalar ? remote : local;
  const surfaceForms = Array.from(
    new Set([...local.surface_forms, ...remote.surface_forms]),
  );
  const customExamples = Array.from(
    new Set([...local.custom_examples, ...remote.custom_examples]),
  );
  const tags = Array.from(new Set([...local.tags, ...remote.tags]));

  return {
    ...winner,
    surface_forms: surfaceForms,
    occurrences: mergeOccurrences(local.occurrences, remote.occurrences),
    meanings: mergeMeanings(local.meanings, remote.meanings),
    custom_examples: customExamples,
    tags,
    version: Math.max(local.version, remote.version),
    created_at:
      local.created_at <= remote.created_at ? local.created_at : remote.created_at,
    updated_at:
      local.updated_at >= remote.updated_at ? local.updated_at : remote.updated_at,
  };
}

export function mergeFlashcardRecords(
  local: FlashcardRecord,
  remote: FlashcardRecord,
): FlashcardRecord {
  if (remote.version > local.version) return remote;
  if (local.version > remote.version) return local;
  return remote.updated_at >= local.updated_at ? remote : local;
}
