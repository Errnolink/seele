/**
 * Tag classification state (v2.5 §3.1, §Module 3.3, §Module 6.4).
 *
 * Tags are renderer-only labels the user creates and assigns to files.
 * They persist to localStorage so they survive restarts. The hook
 * exposes tag definitions, per-file assignments, active filter set,
 * and mutation helpers for the sidebar pills, inspector tag manager,
 * and batch operations.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

export interface TagDef {
  /** Stable key, e.g. "pilot-eva-00" */
  key: string;
  /** Display label, e.g. "EVA-00 PROD TYPE" */
  label: string;
  /** Text color hex */
  color: string;
  /** Background color hex (with alpha) */
  bg: string;
  /** Border color hex */
  border: string;
  category: "PILOT" | "SYSTEM" | "STAGE" | "CUSTOM";
}

/** Preset tag palette — NERV-accurate hues from the spec. */
const TAG_PALETTE = [
  { color: "#ff9830", bg: "rgba(255,152,48,0.15)", border: "rgba(255,152,48,0.5)" },
  { color: "#50ff50", bg: "rgba(80,255,80,0.15)", border: "rgba(80,255,80,0.5)" },
  { color: "#20f0ff", bg: "rgba(32,240,255,0.15)", border: "rgba(32,240,255,0.5)" },
  { color: "#ffb700", bg: "rgba(255,183,0,0.15)", border: "rgba(255,183,0,0.5)" },
  { color: "#ff4fd8", bg: "rgba(255,79,216,0.15)", border: "rgba(255,79,216,0.5)" },
  { color: "#c4b5fd", bg: "rgba(196,181,253,0.15)", border: "rgba(196,181,253,0.5)" },
];

/** Default starter tags so the section isn't empty on first launch. */
const DEFAULT_TAGS: TagDef[] = [
  { key: "intake", label: "INTAKE", category: "SYSTEM", ...TAG_PALETTE[0] },
  { key: "review", label: "REVIEW QUEUE", category: "STAGE", ...TAG_PALETTE[3] },
  { key: "archive", label: "ARCHIVED", category: "STAGE", ...TAG_PALETTE[2] },
  { key: "rejected", label: "REJECTED", category: "SYSTEM", ...TAG_PALETTE[4] },
];

const STORAGE_TAGS = "wiergise:tags";
const STORAGE_ASSIGN = "wiergise:tagAssignments";

/** Shared immutable empty result — avoids per-call allocations. */
const EMPTY_TAGS: TagDef[] = [];

function loadTags(): TagDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_TAGS);
    if (raw) {
      const parsed = JSON.parse(raw) as TagDef[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_TAGS;
}

function loadAssignments(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  try {
    const raw = localStorage.getItem(STORAGE_ASSIGN);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      for (const [filePath, tags] of Object.entries(parsed)) {
        if (Array.isArray(tags)) map.set(filePath, new Set(tags));
      }
    }
  } catch {
    /* empty */
  }
  return map;
}

let paletteCursor = 0;

export function useTags() {
  const [tags, setTags] = useState<TagDef[]>(loadTags);
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(loadAssignments);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  // Persist to localStorage on change.
  useEffect(() => {
    localStorage.setItem(STORAGE_TAGS, JSON.stringify(tags));
  }, [tags]);

  useEffect(() => {
    const obj: Record<string, string[]> = {};
    for (const [path, tagSet] of assignments) {
      obj[path] = [...tagSet];
    }
    localStorage.setItem(STORAGE_ASSIGN, JSON.stringify(obj));
  }, [assignments]);

  const addTag = useCallback((label: string, category: TagDef["category"] = "CUSTOM") => {
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `tag-${Date.now()}`;
    const palette = TAG_PALETTE[paletteCursor % TAG_PALETTE.length];
    paletteCursor++;
    const def: TagDef = { key, label: label.toUpperCase(), category, ...palette };
    setTags((prev) => [...prev, def]);
    return key;
  }, []);

  const removeTag = useCallback((key: string) => {
    setTags((prev) => prev.filter((t) => t.key !== key));
    setAssignments((prev) => {
      const next = new Map(prev);
      for (const [path, tagSet] of next) {
        if (tagSet.has(key)) {
          const copy = new Set(tagSet);
          copy.delete(key);
          next.set(path, copy);
        }
      }
      return next;
    });
    setActiveTags((prev) => {
      const copy = new Set(prev);
      copy.delete(key);
      return copy;
    });
  }, []);

  const toggleFileTag = useCallback((filePath: string, tagKey: string) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(filePath) ?? []);
      if (current.has(tagKey)) current.delete(tagKey);
      else current.add(tagKey);
      next.set(filePath, current);
      return next;
    });
  }, []);

  /** Batch-assign a tag to multiple file paths. */
  const batchAssign = useCallback((filePaths: string[], tagKey: string, assign: boolean) => {
    setAssignments((prev) => {
      const next = new Map(prev);
      for (const fp of filePaths) {
        const current = new Set(next.get(fp) ?? []);
        if (assign) current.add(tagKey);
        else current.delete(tagKey);
        next.set(fp, current);
      }
      return next;
    });
  }, []);

  const toggleActiveTag = useCallback((key: string) => {
    setActiveTags((prev) => {
      const copy = new Set(prev);
      if (copy.has(key)) copy.delete(key);
      else copy.add(key);
      return copy;
    });
  }, []);

  // Precomputed per-file resolved tags. Rebuilt only when tags/assignments
  // change; getFileTags then answers in O(1) with a STABLE array reference
  // — the previous per-call `tags.filter(...)` allocated a fresh array for
  // every visible tile on every render (hot path in the masonry grid).
  const tagCache = useMemo(() => {
    const cache = new Map<string, TagDef[]>();
    const defByKey = new Map(tags.map((t) => [t.key, t]));
    for (const [path, keys] of assignments) {
      if (keys.size === 0) continue;
      const defs: TagDef[] = [];
      for (const k of keys) {
        const def = defByKey.get(k);
        if (def) defs.push(def);
      }
      cache.set(path, defs.length > 0 ? defs : EMPTY_TAGS);
    }
    return cache;
  }, [tags, assignments]);

  /** Get tags assigned to a file — O(1) map hit, stable array reference. */
  const getFileTags = useCallback(
    (filePath: string): TagDef[] => tagCache.get(filePath) ?? EMPTY_TAGS,
    [tagCache],
  );

  /** Count how many files have each tag. */
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tagSet of assignments.values()) {
      for (const key of tagSet) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [assignments]);

  return {
    tags,
    activeTags,
    tagCounts,
    addTag,
    removeTag,
    toggleFileTag,
    batchAssign,
    toggleActiveTag,
    getFileTags,
  };
}


/** Return type of {@link useTags}. Named so consumers don't couple to
 *  the hook's internal implementation. */
export interface UseTagsReturn {
  tags: TagDef[];
  activeTags: Set<string>;
  tagCounts: Map<string, number>;
  addTag: (label: string, category?: TagDef["category"]) => string;
  removeTag: (key: string) => void;
  toggleFileTag: (filePath: string, tagKey: string) => void;
  batchAssign: (filePaths: string[], tagKey: string, assign: boolean) => void;
  toggleActiveTag: (key: string) => void;
  getFileTags: (filePath: string) => TagDef[];
}
