import AsyncStorage from '@react-native-async-storage/async-storage';

export type ContentItemType =
  | 'video'
  | 'study_material'
  | 'worksheet'
  | 'quiz'
  | 'assignment'
  | 'notes'
  | 'pdf_worksheet';

export type QuizReviewItemStored = {
  questionId?: number | string;
  index?: number;
  prompt: string;
  type?: string;
  isCorrect: boolean;
  yourAnswer: string;
  correctAnswer: string;
  explanation?: string | null;
};

export type ItemProgress = {
  type: ContentItemType;
  id: number;
  status: 'pending' | 'watched' | 'learnt' | 'done';
  /** 0-based page indices viewed (study / worksheet). */
  viewedPages?: number[];
  pageCount?: number;
  latestScore?: number;
  latestTotal?: number;
  latestReview?: QuizReviewItemStored[];
};

export type LessonLearnRecordV2 = {
  items: Record<string, ItemProgress>;
  completed: boolean;
  /** Highest lesson % ever reached — never decreases on reopen/redo. */
  peakPercent?: number;
  updatedAt: string;
};

/** @deprecated slide-index model; kept for clear/migration helpers */
export type LessonLearnRecord = {
  totalSteps: number;
  furthestStepIndex: number;
  completed: boolean;
  updatedAt: string;
};

export type ContentSummaryItem = {
  type: string;
  id: number;
  title?: string;
  orderIndex?: number;
  quizAssignmentId?: number | null;
  pageCount?: number;
};

/** Types that share equal lesson weight when present. */
export const LESSON_PROGRESS_TYPES = [
  'video',
  'study_material',
  'worksheet',
  'quiz',
] as const;

export function itemKey(type: string, id: number): string {
  return `${type}:${id}`;
}

function storageKeyV1(userId: number, courseId: number, lessonId: number) {
  return `learn:v1:${userId}:${courseId}:${lessonId}`;
}

function storageKeyV2(userId: number, courseId: number, lessonId: number) {
  return `learn:v2:${userId}:${courseId}:${lessonId}`;
}

function emptyRecord(): LessonLearnRecordV2 {
  return { items: {}, completed: false, peakPercent: 0, updatedAt: new Date().toISOString() };
}

function isFinished(item: ItemProgress | undefined): boolean {
  if (!item) return false;
  return item.status === 'watched' || item.status === 'learnt' || item.status === 'done';
}

function unionPageIndexes(a?: number[], b?: number[]): number[] {
  return Array.from(new Set([...(a || []), ...(b || [])])).sort((x, y) => x - y);
}

/** Keep finished item state sticky when merging updates. */
function mergeItemProgress(prev: ItemProgress | undefined, next: ItemProgress): ItemProgress {
  if (!prev || !isFinished(prev)) return next;
  if (prev.type === 'study_material' || prev.type === 'worksheet') {
    const doneStatus = prev.type === 'study_material' ? ('learnt' as const) : ('done' as const);
    return {
      ...next,
      ...prev,
      status: doneStatus,
      viewedPages: unionPageIndexes(prev.viewedPages, next.viewedPages),
      pageCount: Math.max(Number(prev.pageCount) || 0, Number(next.pageCount) || 0) || prev.pageCount,
      latestScore: next.latestScore ?? prev.latestScore,
      latestTotal: next.latestTotal ?? prev.latestTotal,
    };
  }
  if (prev.type === 'quiz') {
    return {
      ...next,
      status: 'done',
      latestScore: next.latestScore ?? prev.latestScore,
      latestTotal: next.latestTotal ?? prev.latestTotal,
      latestReview: next.latestReview?.length ? next.latestReview : prev.latestReview,
    };
  }
  if (prev.type === 'video') {
    return { ...next, status: 'watched' };
  }
  return { ...next, status: prev.status };
}

function mergeItemsSticky(
  prevItems: Record<string, ItemProgress>,
  nextItems: Record<string, ItemProgress>,
): Record<string, ItemProgress> {
  const out: Record<string, ItemProgress> = { ...prevItems, ...nextItems };
  for (const key of Object.keys(out)) {
    out[key] = mergeItemProgress(prevItems[key], out[key]);
  }
  return out;
}

export function statusLabelForType(type: string, status: ItemProgress['status']): string {
  if (status === 'pending') return 'Not started';
  if (type === 'video') return status === 'watched' ? 'Watched' : String(status);
  if (type === 'study_material') return status === 'learnt' ? 'Learnt' : String(status);
  if (type === 'quiz' || type === 'worksheet' || type === 'assignment' || type === 'notes' || type === 'pdf_worksheet') {
    return status === 'done' ? 'Done' : String(status);
  }
  return String(status);
}

export type ItemBadgeTone = 'neutral' | 'partial' | 'complete';

/** Badge text including partial page progress for study / worksheet. */
export function itemStatusBadge(
  type: string,
  item: ItemProgress | undefined,
  opts?: { quizHasResult?: boolean },
): { label: string; tone: ItemBadgeTone } {
  if (type === 'study_material' || type === 'worksheet') {
    if (item?.status === 'learnt') return { label: 'Learnt', tone: 'complete' };
    if (item?.status === 'done') return { label: 'Done', tone: 'complete' };
    const pages = Math.max(0, Number(item?.pageCount) || 0);
    const viewed = Array.isArray(item?.viewedPages) ? item!.viewedPages!.length : 0;
    if (pages > 0 && viewed >= pages) {
      return { label: type === 'study_material' ? 'Learnt' : 'Done', tone: 'complete' };
    }
    if (viewed > 0 && pages > 0) {
      return { label: `${viewed}/${pages} pages`, tone: 'partial' };
    }
    if (viewed > 0) {
      return { label: `${viewed} page${viewed === 1 ? '' : 's'} viewed`, tone: 'partial' };
    }
    return { label: 'Not started', tone: 'neutral' };
  }
  if (type === 'quiz') {
    if (item?.status === 'done' || opts?.quizHasResult) {
      return { label: 'Done', tone: 'complete' };
    }
    return { label: 'Not started', tone: 'neutral' };
  }
  if (type === 'video') {
    if (item?.status === 'watched') return { label: 'Watched', tone: 'complete' };
    return { label: 'Not started', tone: 'neutral' };
  }
  return {
    label: statusLabelForType(type, item?.status || 'pending'),
    tone: item && isFinished(item) ? 'complete' : 'neutral',
  };
}

/** Next 0-based page to open (first not-yet-viewed, else 0). */
export function nextUnreadPageIndex(item: ItemProgress | undefined): number {
  if (!item) return 0;
  const pages = Math.max(0, Number(item.pageCount) || 0);
  const viewed = new Set(item.viewedPages || []);
  if (!viewed.size) return 0;
  if (pages > 0) {
    for (let i = 0; i < pages; i += 1) {
      if (!viewed.has(i)) return i;
    }
    return Math.max(0, pages - 1);
  }
  const maxViewed = Math.max(...Array.from(viewed));
  return maxViewed + 1;
}

export async function getLessonProgressV2(
  userId: number,
  courseId: number,
  lessonId: number,
): Promise<LessonLearnRecordV2 | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyV2(userId, courseId, lessonId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      items: o.items && typeof o.items === 'object' ? o.items : {},
      completed: Boolean(o.completed),
      peakPercent: Math.max(0, Math.min(100, Number(o.peakPercent) || 0)),
      updatedAt: String(o.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

export async function saveLessonProgressV2(
  userId: number,
  courseId: number,
  lessonId: number,
  next: LessonLearnRecordV2,
): Promise<void> {
  const prev = await getLessonProgressV2(userId, courseId, lessonId);
  const items = mergeItemsSticky(prev?.items || {}, next.items || {});
  const summary = resolveLessonSummary(null, { items, completed: false, updatedAt: '' });
  const fullyDone = isLessonFullyComplete(items, summary);
  const completed = Boolean(prev?.completed || next.completed || fullyDone);
  const rawPercent = computeLessonPercentRaw(
    { items, completed: false, peakPercent: 0, updatedAt: '' },
    summary,
  );
  const peakPercent = Math.max(
    Number(prev?.peakPercent) || 0,
    Number(next.peakPercent) || 0,
    rawPercent,
    completed ? 100 : 0,
  );
  const payload: LessonLearnRecordV2 = {
    items,
    completed: completed || peakPercent >= 100,
    peakPercent,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(storageKeyV2(userId, courseId, lessonId), JSON.stringify(payload));
}

/** Prefer API summary; fall back to keys already stored on the device. */
export function resolveLessonSummary(
  summary: ContentSummaryItem[] | undefined | null,
  record: LessonLearnRecordV2 | null,
): ContentSummaryItem[] {
  if (summary && summary.length) {
    return summary.filter((s) => s.type && Number.isFinite(Number(s.id)));
  }
  if (!record?.items) return [];
  return Object.values(record.items)
    .filter((it) => LESSON_PROGRESS_TYPES.includes(it.type as (typeof LESSON_PROGRESS_TYPES)[number]))
    .map((it) => ({
      type: it.type,
      id: it.id,
      pageCount: it.pageCount,
    }));
}

/** Ensure inventory keys exist as pending so % denominators stay stable. */
export async function ensureLessonInventory(
  userId: number,
  courseId: number,
  lessonId: number,
  summary: ContentSummaryItem[],
): Promise<LessonLearnRecordV2> {
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const items = { ...prev.items };
  for (const row of summary) {
    const type = String(row.type || '') as ContentItemType;
    const id = Number(row.id);
    if (!type || !Number.isFinite(id)) continue;
    if (!LESSON_PROGRESS_TYPES.includes(type as (typeof LESSON_PROGRESS_TYPES)[number])) continue;
    const k = itemKey(type, id);
    if (!items[k]) {
      items[k] = {
        type,
        id,
        status: 'pending',
        ...(row.pageCount != null ? { pageCount: Number(row.pageCount) } : {}),
      };
    } else if (row.pageCount != null && !items[k].pageCount) {
      items[k] = { ...items[k], pageCount: Number(row.pageCount) };
    }
  }
  const effective = resolveLessonSummary(summary, { ...prev, items });
  const completed =
    Boolean(prev.completed) || isLessonFullyComplete(items, effective);
  const next: LessonLearnRecordV2 = {
    items,
    completed,
    peakPercent: prev.peakPercent || 0,
    updatedAt: new Date().toISOString(),
  };
  await saveLessonProgressV2(userId, courseId, lessonId, next);
  return (await getLessonProgressV2(userId, courseId, lessonId)) || next;
}

/** Progress of a single library item within its type (0..1). */
export function itemProgressFraction(item: ItemProgress | undefined, type: string): number {
  if (!item) return 0;
  if (type === 'video') return item.status === 'watched' ? 1 : 0;
  if (type === 'quiz') return item.status === 'done' ? 1 : 0;
  if (type === 'study_material' || type === 'worksheet') {
    if (isFinished(item)) return 1;
    const pages = Math.max(0, Number(item.pageCount) || 0);
    const viewed = Array.isArray(item.viewedPages) ? item.viewedPages.length : 0;
    if (pages > 0) return Math.min(1, viewed / pages);
    return 0;
  }
  return isFinished(item) ? 1 : 0;
}

function presentProgressTypes(summary: ContentSummaryItem[]): string[] {
  const present = new Set<string>();
  for (const s of summary) {
    const t = String(s.type || '');
    if (LESSON_PROGRESS_TYPES.includes(t as (typeof LESSON_PROGRESS_TYPES)[number])) {
      present.add(t);
    }
  }
  return LESSON_PROGRESS_TYPES.filter((t) => present.has(t));
}

/**
 * Lesson %: equal weight per present type (video / study / worksheet / quiz).
 * Within a type, each library item has equal weight; study/worksheet items use pages viewed / page count.
 * Raw value (ignores peak) — use computeLessonPercentFromRecord for display.
 */
export function computeLessonPercentRaw(
  record: LessonLearnRecordV2 | null,
  summary: ContentSummaryItem[],
): number {
  const effective = resolveLessonSummary(summary, record);
  const types = presentProgressTypes(effective);
  if (!types.length) {
    return record?.completed ? 100 : 0;
  }

  const typeWeight = 100 / types.length;
  let total = 0;

  for (const type of types) {
    const rows = effective.filter((s) => s.type === type);
    if (!rows.length) continue;
    let typeFrac = 0;
    for (const row of rows) {
      const item = record?.items[itemKey(row.type, Number(row.id))];
      const merged: ItemProgress | undefined = item
        ? {
            ...item,
            pageCount: item.pageCount ?? row.pageCount,
          }
        : row.pageCount != null
          ? {
              type: type as ContentItemType,
              id: Number(row.id),
              status: 'pending',
              pageCount: row.pageCount,
            }
          : undefined;
      typeFrac += itemProgressFraction(merged, type);
    }
    total += typeWeight * (typeFrac / rows.length);
  }

  return Math.round(Math.min(100, Math.max(0, total)));
}

/** Display lesson % — never below peakPercent once progress has been earned. */
export function computeLessonPercentFromRecord(
  record: LessonLearnRecordV2 | null,
  summary: ContentSummaryItem[],
): number {
  if (record?.completed) return 100;
  const raw = computeLessonPercentRaw(record, summary);
  return Math.max(raw, Number(record?.peakPercent) || 0);
}

export function isLessonFullyComplete(
  items: Record<string, ItemProgress>,
  summary: ContentSummaryItem[],
): boolean {
  const effective = resolveLessonSummary(summary, { items, completed: false, updatedAt: '' });
  const types = presentProgressTypes(effective);
  if (!types.length) return false;
  for (const type of types) {
    const rows = effective.filter((s) => s.type === type);
    for (const row of rows) {
      const item = items[itemKey(row.type, Number(row.id))];
      const merged = item
        ? { ...item, pageCount: item.pageCount ?? row.pageCount }
        : undefined;
      if (itemProgressFraction(merged, type) < 1) return false;
    }
  }
  return true;
}

export function summarizeLessonItemStatuses(
  record: LessonLearnRecordV2 | null,
  summary: ContentSummaryItem[],
): { watched: string; learnt: string; done: string } {
  const effective = resolveLessonSummary(summary, record);
  const videos = effective.filter((s) => s.type === 'video');
  const study = effective.filter((s) => s.type === 'study_material');
  const worksheets = effective.filter((s) => s.type === 'worksheet');
  const quizzes = effective.filter((s) => s.type === 'quiz');

  const finishedCount = (rows: ContentSummaryItem[]) =>
    rows.filter((s) => isFinished(record?.items[itemKey(s.type, Number(s.id))])).length;

  return {
    watched: videos.length ? `${finishedCount(videos)}/${videos.length} watched` : '',
    learnt: study.length ? `${finishedCount(study)}/${study.length} learnt` : '',
    done: [
      worksheets.length ? `${finishedCount(worksheets)}/${worksheets.length} worksheets` : '',
      quizzes.length ? `${finishedCount(quizzes)}/${quizzes.length} quizzes` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

const TYPE_LABEL: Record<string, string> = {
  video: 'Video',
  study_material: 'Study material',
  worksheet: 'Worksheet',
  quiz: 'Quiz',
  assignment: 'Assignment',
  notes: 'Notes',
  pdf_worksheet: 'Worksheet',
};

/** Progress snapshot for the lesson end screen. */
export function summarizeLessonEndProgress(
  record: LessonLearnRecordV2 | null,
  summary: ContentSummaryItem[],
): {
  percent: number;
  complete: boolean;
  completed: { label: string; title: string }[];
  incomplete: { label: string; title: string }[];
} {
  const effective = resolveLessonSummary(summary, record);
  const percent = computeLessonPercentFromRecord(record, effective);
  const complete = percent >= 100 || Boolean(record?.completed);
  const completed: { label: string; title: string }[] = [];
  const incomplete: { label: string; title: string }[] = [];

  for (const row of effective) {
    if (!LESSON_PROGRESS_TYPES.includes(row.type as (typeof LESSON_PROGRESS_TYPES)[number])) {
      continue;
    }
    const item = record?.items[itemKey(row.type, Number(row.id))];
    const merged = item
      ? { ...item, pageCount: item.pageCount ?? row.pageCount }
      : row.pageCount != null
        ? ({
            type: row.type as ContentItemType,
            id: Number(row.id),
            status: 'pending' as const,
            pageCount: row.pageCount,
          } satisfies ItemProgress)
        : undefined;
    const frac = itemProgressFraction(merged, row.type);
    const entry = {
      label: TYPE_LABEL[row.type] || row.type,
      title: String(row.title || `${TYPE_LABEL[row.type] || row.type} #${row.id}`),
    };
    if (frac >= 1) completed.push(entry);
    else incomplete.push(entry);
  }

  return { percent, complete, completed, incomplete };
}

async function recomputeAndSave(
  userId: number,
  courseId: number,
  lessonId: number,
  items: Record<string, ItemProgress>,
  summary?: ContentSummaryItem[],
): Promise<void> {
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const merged = mergeItemsSticky(prev.items, items);
  const effective = resolveLessonSummary(summary, { ...prev, items: merged });
  const completed =
    Boolean(prev.completed) || isLessonFullyComplete(merged, effective);
  await saveLessonProgressV2(userId, courseId, lessonId, {
    items: merged,
    completed,
    peakPercent: prev.peakPercent || 0,
    updatedAt: '',
  });
}

export async function markVideoWatched(
  userId: number,
  courseId: number,
  lessonId: number,
  videoId: number,
  summary?: ContentSummaryItem[],
): Promise<void> {
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const k = itemKey('video', videoId);
  const items = {
    ...prev.items,
    [k]: { type: 'video' as const, id: videoId, status: 'watched' as const },
  };
  await recomputeAndSave(userId, courseId, lessonId, items, summary);
}

export async function markPagedItemView(
  userId: number,
  courseId: number,
  lessonId: number,
  type: 'study_material' | 'worksheet',
  id: number,
  pageIndex: number,
  pageCount: number,
  summary?: ContentSummaryItem[],
): Promise<void> {
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const k = itemKey(type, id);
  const existing = prev.items[k];
  const viewedPages = unionPageIndexes(existing?.viewedPages, [pageIndex]);
  const pages = Math.max(1, pageCount || existing?.pageCount || 1);
  const allSeen = viewedPages.length >= pages;
  const doneStatus = type === 'study_material' ? ('learnt' as const) : ('done' as const);
  const alreadyDone = isFinished(existing);
  const items = {
    ...prev.items,
    [k]: {
      type,
      id,
      status: alreadyDone || allSeen ? doneStatus : ('pending' as const),
      viewedPages,
      pageCount: Math.max(pages, Number(existing?.pageCount) || 0) || pages,
    },
  };
  await recomputeAndSave(userId, courseId, lessonId, items, summary);
}

export async function markQuizDone(
  userId: number,
  courseId: number,
  lessonId: number,
  quizId: number,
  latestScore: number,
  latestTotal: number,
  summary?: ContentSummaryItem[],
  latestReview?: QuizReviewItemStored[],
): Promise<void> {
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const k = itemKey('quiz', quizId);
  const items = {
    ...prev.items,
    [k]: {
      type: 'quiz' as const,
      id: quizId,
      status: 'done' as const,
      latestScore,
      latestTotal,
      ...(latestReview?.length ? { latestReview } : {}),
    },
  };
  await recomputeAndSave(userId, courseId, lessonId, items, summary);
}

export async function markGenericDone(
  userId: number,
  courseId: number,
  lessonId: number,
  type: ContentItemType,
  id: number,
  summary?: ContentSummaryItem[],
): Promise<void> {
  // Only the four weighted types affect lesson completion %; still record others if present.
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const k = itemKey(type, id);
  const items = {
    ...prev.items,
    [k]: { type, id, status: 'done' as const },
  };
  await recomputeAndSave(userId, courseId, lessonId, items, summary);
}

export async function markLessonCompletedIfDone(
  userId: number,
  courseId: number,
  lessonId: number,
  summary: ContentSummaryItem[],
): Promise<void> {
  const prev = (await getLessonProgressV2(userId, courseId, lessonId)) || emptyRecord();
  const effective = resolveLessonSummary(summary, prev);
  if (isLessonFullyComplete(prev.items, effective)) {
    await saveLessonProgressV2(userId, courseId, lessonId, {
      ...prev,
      completed: true,
      updatedAt: '',
    });
  }
}

/** Legacy getter used by older call sites; maps from v2 when present. */
export async function getLessonProgress(
  userId: number,
  courseId: number,
  lessonId: number,
): Promise<LessonLearnRecord | null> {
  const v2 = await getLessonProgressV2(userId, courseId, lessonId);
  if (v2) {
    const pct = computeLessonPercentFromRecord(v2, resolveLessonSummary(null, v2));
    return {
      totalSteps: 100,
      furthestStepIndex: Math.max(0, pct - 1),
      completed: v2.completed || pct >= 100,
      updatedAt: v2.updatedAt,
    };
  }
  try {
    const raw = await AsyncStorage.getItem(storageKeyV1(userId, courseId, lessonId));
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      totalSteps: Math.max(0, Number(o.totalSteps) || 0),
      furthestStepIndex: Math.max(0, Number(o.furthestStepIndex) || 0),
      completed: Boolean(o.completed),
      updatedAt: String(o.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

export async function clearLessonProgress(userId: number, courseId: number, lessonId: number) {
  await AsyncStorage.multiRemove([
    storageKeyV1(userId, courseId, lessonId),
    storageKeyV2(userId, courseId, lessonId),
  ]);
}

export async function clearCourseProgress(userId: number, courseId: number, lessonIds: number[]) {
  await Promise.all(lessonIds.map((id) => clearLessonProgress(userId, courseId, id)));
}

/**
 * Overall course % = share of lessons that are fully completed (not average of partial lesson %).
 */
export async function computeCourseProgressPercent(
  userId: number,
  courseId: number,
  lessons: { id: number; contentSummary?: ContentSummaryItem[] }[],
): Promise<number> {
  if (!lessons.length) return 0;
  let completedCount = 0;
  for (const l of lessons) {
    const record = await getLessonProgressV2(userId, courseId, l.id);
    const summary = resolveLessonSummary(l.contentSummary, record);
    if (record?.completed || computeLessonPercentFromRecord(record, summary) >= 100) {
      completedCount += 1;
    }
  }
  return Math.round((completedCount / lessons.length) * 100);
}

export function pickPrimaryLessonId(lessons: { id: number; sort_order?: number }[]): number | null {
  if (!lessons.length) return null;
  const sorted = [...lessons].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  return sorted[0]?.id ?? null;
}

export type LessonAction = 'start' | 'resume' | 'restart';

export async function resolveLessonAction(
  userId: number,
  courseId: number,
  lessonId: number,
  summary?: ContentSummaryItem[],
): Promise<LessonAction> {
  const v2 = await getLessonProgressV2(userId, courseId, lessonId);
  if (!v2) return 'start';
  const effective = resolveLessonSummary(summary, v2);
  const pct = computeLessonPercentFromRecord(v2, effective);
  if (v2.completed || pct >= 100) return 'restart';
  const anyStarted = Object.values(v2.items).some(
    (it) => isFinished(it) || (it.viewedPages && it.viewedPages.length > 0),
  );
  if (anyStarted || pct > 0) return 'resume';
  return 'start';
}

export async function allLessonsCompleted(
  userId: number,
  courseId: number,
  lessonIds: number[],
): Promise<boolean> {
  if (!lessonIds.length) return false;
  for (const id of lessonIds) {
    const v2 = await getLessonProgressV2(userId, courseId, id);
    if (!v2?.completed) {
      const pct = computeLessonPercentFromRecord(v2, resolveLessonSummary(null, v2));
      if (pct < 100) return false;
    }
  }
  return true;
}
