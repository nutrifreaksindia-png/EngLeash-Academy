import { api } from '../api/client';
import { parseContentBlocks, splitBlocksByDivider } from '../components/learn/ContentBlocksView';

export type LessonBundle = {
  id: number;
  title: string;
  /** Course the learner opened (preferred for quiz access checks). */
  courseId?: number | null;
  course_id?: number | null;
  videoUrl?: string | null;
  allowVideoDownload: boolean;
  classNotes?: { id: number; title: string; fileUrl: string }[];
  worksheets?: { id: number; title: string; fileUrl: string }[];
  quiz: { id: number; title: string; questions: { id: number; question_text?: string; options?: any[] }[] } | null;
  quizAssignments?: { id: number; quiz_title?: string }[];
  videoAssignments?: { id: number; video_title?: string; video_description?: string; video_url?: string }[];
  studyMaterialAssignments?: { id: number; material_id: number; material_title?: string; material_description?: string }[];
  libraryWorksheetAssignments?: {
    id: number;
    worksheet_id: number;
    worksheet_title?: string;
    worksheet_description?: string;
  }[];
  orderedContent?: {
    orderIndex: number;
    type: string;
    id: number;
    title?: string;
    description?: string;
    videoUrl?: string | null;
    quizAssignmentId?: number | null;
  }[];
};

function preferredCourseId(lesson: LessonBundle): number | null {
  const raw = lesson.courseId ?? lesson.course_id;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

export type QuizPayload =
  | { mode: 'v2'; quizKey: string; assignmentId: number; quizId: number; quiz: any }
  | { mode: 'legacy'; quizKey: string; lessonId: number; quizId: number; quiz: { id: number; title: string; questions: any[] } };

export type ContentRef = {
  contentType: string;
  contentId: number;
  orderIndex: number;
};

export type LearnSlide =
  | { key: string; kind: 'intro'; lessonTitle: string; hint?: string }
  | {
      key: string;
      kind: 'video';
      title: string;
      videoUrl: string;
      allowDownload: boolean;
      contentType: 'video';
      contentId: number;
      orderIndex: number;
    }
  | {
      key: string;
      kind: 'text';
      sectionTitle: string;
      description?: string | null;
      blocks: any[];
      contentType: 'study_material' | 'worksheet';
      contentId: number;
      orderIndex: number;
      pageIndex: number;
      pageCount: number;
    }
  | {
      key: string;
      kind: 'quizzes_list';
      quizzes: {
        quizKey: string;
        title: string;
        contentId: number;
        orderIndex: number;
        questionCount: number;
        firstSlideKey: string;
      }[];
    }
  | {
      key: string;
      kind: 'quiz_start';
      quiz: QuizPayload;
      questionCount: number;
      contentType: 'quiz';
      contentId: number;
      orderIndex: number;
    }
  | {
      key: string;
      kind: 'quiz_question';
      quiz: QuizPayload;
      question: any;
      qIndex: number;
      qTotal: number;
      contentType: 'quiz';
      contentId: number;
      orderIndex: number;
    }
  | {
      key: string;
      kind: 'quiz_result';
      quiz: QuizPayload;
      contentType: 'quiz';
      contentId: number;
      orderIndex: number;
    }
  | {
      key: string;
      kind: 'open_notes';
      sectionTitle: string;
      notes: { id: number; title: string; fileUrl: string }[];
      contentType: 'notes';
      contentId: number;
      orderIndex: number;
    }
  | {
      key: string;
      kind: 'open_pdf_sheet';
      sectionTitle: string;
      worksheets: { id: number; title: string; fileUrl: string }[];
      contentType: 'pdf_worksheet';
      contentId: number;
      orderIndex: number;
    }
  | {
      key: string;
      kind: 'assignment';
      assignmentId: number;
      title: string;
      description?: string;
      contentType: 'assignment';
      contentId: number;
      orderIndex: number;
    }
  | { key: string; kind: 'done'; lessonTitle: string };

export type BuildLessonSlidesOptions = {
  /** Start from this composition orderIndex (inclusive). */
  startOrderIndex?: number | null;
  startType?: string | null;
  startId?: number | null;
  /** Include intro only when starting at the beginning of the lesson. */
  includeIntro?: boolean;
};

export function appendQuizSeries(
  slides: LearnSlide[],
  pack: QuizPayload,
  orderIndex: number,
) {
  const qs = pack.mode === 'v2' ? pack.quiz?.questions || [] : pack.quiz?.questions || [];
  if (!qs.length) return;
  const total = qs.length;
  const contentId = pack.quizId;
  slides.push({
    key: `${pack.quizKey}-start`,
    kind: 'quiz_start',
    quiz: pack,
    questionCount: total,
    contentType: 'quiz',
    contentId,
    orderIndex,
  });
  qs.forEach((q: any, i: number) => {
    slides.push({
      key: `${pack.quizKey}-q-${i}-${String(q?.id ?? 'x')}`,
      kind: 'quiz_question',
      quiz: pack,
      question: q,
      qIndex: i,
      qTotal: total,
      contentType: 'quiz',
      contentId,
      orderIndex,
    });
  });
  slides.push({
    key: `${pack.quizKey}-result`,
    kind: 'quiz_result',
    quiz: pack,
    contentType: 'quiz',
    contentId,
    orderIndex,
  });
}

/** @deprecated Quizzes are chosen via numbered header squares; list slide is no longer injected. */
export function injectQuizzesListSlide(slides: LearnSlide[]): LearnSlide[] {
  return slides.filter((s) => s.kind !== 'quizzes_list');
}

/** Distinct quizzes in deck order — for numbered square picker. */
export function listQuizzesInDeck(slides: LearnSlide[]): {
  quizKey: string;
  title: string;
  startKey: string;
  resultKey: string;
  questionCount: number;
}[] {
  const out: {
    quizKey: string;
    title: string;
    startKey: string;
    resultKey: string;
    questionCount: number;
  }[] = [];
  const seen = new Set<string>();
  for (const s of slides) {
    if (s.kind !== 'quiz_start' || seen.has(s.quiz.quizKey)) continue;
    seen.add(s.quiz.quizKey);
    const result = slides.find((x) => x.kind === 'quiz_result' && x.quiz.quizKey === s.quiz.quizKey);
    out.push({
      quizKey: s.quiz.quizKey,
      title: slideItemTitle(s),
      startKey: s.key,
      resultKey: result?.key || s.key,
      questionCount: s.questionCount,
    });
  }
  return out;
}

async function fetchQuizV2(assignmentId: number, courseId?: number | null): Promise<any | null> {
  try {
    const q =
      courseId != null && Number.isFinite(Number(courseId))
        ? `?courseId=${encodeURIComponent(String(courseId))}`
        : '';
    const payload = await api.get(`/quizzes/v2/assignment/${assignmentId}${q}`);
    return payload || null;
  } catch {
    return null;
  }
}

async function studyMaterialSlides(
  keyPrefix: string,
  lessonId: number,
  materialId: number,
  title: string,
  orderIndex: number,
  description?: string,
): Promise<LearnSlide[]> {
  try {
    const data = await api.get(`/study-materials/${materialId}`);
    const raw = splitBlocksByDivider(parseContentBlocks(data.content_json || '')).filter((c) => c.length > 0);
    const chunks = raw.length ? raw : [parseContentBlocks(data.content_json || '')];
    const pages = chunks.filter((chunk) => chunk.length > 0);
    const pageCount = Math.max(1, pages.length || 1);
    if (!pages.length) {
      return [{
        key: `${keyPrefix}-l${lessonId}-sm-${materialId}-0`,
        kind: 'text' as const,
        sectionTitle: title,
        description,
        blocks: [],
        contentType: 'study_material' as const,
        contentId: materialId,
        orderIndex,
        pageIndex: 0,
        pageCount: 1,
      }];
    }
    return pages.map((chunk, pi) => ({
      key: `${keyPrefix}-l${lessonId}-sm-${materialId}-${pi}`,
      kind: 'text' as const,
      sectionTitle: title,
      description: pi === 0 ? description || data.description : undefined,
      blocks: chunk,
      contentType: 'study_material' as const,
      contentId: materialId,
      orderIndex,
      pageIndex: pi,
      pageCount,
    }));
  } catch {
    return [{
      key: `${keyPrefix}-l${lessonId}-sm-${materialId}-err`,
      kind: 'text' as const,
      sectionTitle: title,
      description,
      blocks: [],
      contentType: 'study_material' as const,
      contentId: materialId,
      orderIndex,
      pageIndex: 0,
      pageCount: 1,
    }];
  }
}

async function worksheetLibrarySlides(
  keyPrefix: string,
  lessonId: number,
  worksheetId: number,
  title: string,
  orderIndex: number,
  description?: string,
): Promise<LearnSlide[]> {
  try {
    const data = await api.get(`/worksheets/${worksheetId}`);
    const raw = splitBlocksByDivider(parseContentBlocks(data.content_json || '')).filter((c) => c.length > 0);
    const chunks = raw.length ? raw : [parseContentBlocks(data.content_json || '')];
    const pages = chunks.filter((chunk) => chunk.length > 0);
    const pageCount = Math.max(1, pages.length || 1);
    if (!pages.length) {
      return [{
        key: `${keyPrefix}-l${lessonId}-ws-${worksheetId}-0`,
        kind: 'text' as const,
        sectionTitle: title,
        description,
        blocks: [],
        contentType: 'worksheet' as const,
        contentId: worksheetId,
        orderIndex,
        pageIndex: 0,
        pageCount: 1,
      }];
    }
    return pages.map((chunk, pi) => ({
      key: `${keyPrefix}-l${lessonId}-ws-${worksheetId}-${pi}`,
      kind: 'text' as const,
      sectionTitle: title,
      description: pi === 0 ? description || data.description : undefined,
      blocks: chunk,
      contentType: 'worksheet' as const,
      contentId: worksheetId,
      orderIndex,
      pageIndex: pi,
      pageCount,
    }));
  } catch {
    return [{
      key: `${keyPrefix}-l${lessonId}-ws-${worksheetId}-err`,
      kind: 'text' as const,
      sectionTitle: title,
      description,
      blocks: [],
      contentType: 'worksheet' as const,
      contentId: worksheetId,
      orderIndex,
      pageIndex: 0,
      pageCount: 1,
    }];
  }
}

async function buildFromOrdered(slides: LearnSlide[], lesson: LessonBundle, ordered: NonNullable<LessonBundle['orderedContent']>) {
  const rows = [...ordered].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const row of rows) {
    if (row.type === 'video') {
      const url = row.videoUrl || lesson.videoUrl || '';
      if (url) {
        slides.push({
          key: `ord-v-${row.orderIndex}-${row.id}`,
          kind: 'video',
          title: row.title || 'Video',
          videoUrl: url,
          allowDownload: lesson.allowVideoDownload,
          contentType: 'video',
          contentId: row.id,
          orderIndex: row.orderIndex,
        });
      }
    } else if (row.type === 'study_material') {
      const part = await studyMaterialSlides(
        'ord',
        lesson.id,
        row.id,
        row.title || 'Study material',
        row.orderIndex,
        row.description,
      );
      slides.push(...part);
    } else if (row.type === 'worksheet') {
      const part = await worksheetLibrarySlides(
        'ord',
        lesson.id,
        row.id,
        row.title || 'Worksheet',
        row.orderIndex,
        row.description,
      );
      slides.push(...part);
    } else if (row.type === 'quiz') {
      let pack: QuizPayload | null = null;
      if (row.quizAssignmentId) {
        const payload = await fetchQuizV2(row.quizAssignmentId, preferredCourseId(lesson));
        const q = payload?.quiz;
        const questions = q?.questions || [];
        if (questions.length) {
          pack = {
            mode: 'v2',
            quizKey: `ord-l${lesson.id}-a${row.quizAssignmentId}`,
            assignmentId: row.quizAssignmentId,
            quizId: row.id,
            quiz: q,
          };
        }
      }
      if (!pack && lesson.quiz?.questions?.length) {
        pack = {
          mode: 'legacy',
          quizKey: `ord-l${lesson.id}-legacy`,
          lessonId: lesson.id,
          quizId: lesson.quiz.id,
          quiz: lesson.quiz,
        };
      }
      if (pack) appendQuizSeries(slides, pack, row.orderIndex);
    } else if (row.type === 'assignment') {
      // Assignments appear in My Assignments by schedule day — not in Learn Mode.
    }
  }
}

async function buildFromLegacy(slides: LearnSlide[], lesson: LessonBundle) {
  let orderCursor = 0;
  const vids = lesson.videoAssignments?.length ? lesson.videoAssignments : null;
  if (vids) {
    vids.forEach((v, i) => {
      if (v.video_url) {
        const contentId = Number((v as any).video_id ?? v.id);
        slides.push({
          key: `leg-v-${v.id}-${i}`,
          kind: 'video',
          title: v.video_title || 'Lesson video',
          videoUrl: v.video_url,
          allowDownload: lesson.allowVideoDownload,
          contentType: 'video',
          contentId,
          orderIndex: orderCursor++,
        });
      }
    });
  } else if (lesson.videoUrl) {
    slides.push({
      key: `leg-video-main`,
      kind: 'video',
      title: 'Lesson video',
      videoUrl: lesson.videoUrl,
      allowDownload: lesson.allowVideoDownload,
      contentType: 'video',
      contentId: lesson.id,
      orderIndex: orderCursor++,
    });
  }

  const notes = lesson.classNotes || [];
  if (notes.length) {
    slides.push({
      key: `leg-notes`,
      kind: 'open_notes',
      sectionTitle: 'Class notes',
      notes,
      contentType: 'notes',
      contentId: notes[0]?.id ?? 0,
      orderIndex: orderCursor++,
    });
  }

  if (lesson.quiz?.questions?.length) {
    appendQuizSeries(
      slides,
      {
        mode: 'legacy',
        quizKey: `leg-l${lesson.id}-qz`,
        lessonId: lesson.id,
        quizId: lesson.quiz.id,
        quiz: lesson.quiz,
      },
      orderCursor++,
    );
  } else if ((lesson.quizAssignments || []).length) {
    const qa = lesson.quizAssignments![0];
    if (qa?.id) {
      const payload = await fetchQuizV2(qa.id, preferredCourseId(lesson));
      const q = payload?.quiz;
      const questions = q?.questions || [];
      if (questions.length) {
        appendQuizSeries(
          slides,
          {
            mode: 'v2',
            quizKey: `leg-v2-${lesson.id}-${qa.id}`,
            assignmentId: qa.id,
            quizId: Number((q as any)?.quiz_bank_id ?? qa.id),
            quiz: q,
          },
          orderCursor++,
        );
      }
    }
  }

  for (const sm of lesson.studyMaterialAssignments || []) {
    const part = await studyMaterialSlides(
      'leg',
      lesson.id,
      sm.material_id,
      sm.material_title || 'Study material',
      orderCursor++,
      sm.material_description,
    );
    slides.push(...part);
  }
  for (const w of lesson.libraryWorksheetAssignments || []) {
    const part = await worksheetLibrarySlides(
      'leg',
      lesson.id,
      w.worksheet_id,
      w.worksheet_title || 'Worksheet',
      orderCursor++,
      w.worksheet_description,
    );
    slides.push(...part);
  }

  const pdfSheets = lesson.worksheets || [];
  if (pdfSheets.length) {
    slides.push({
      key: `leg-pdf`,
      kind: 'open_pdf_sheet',
      sectionTitle: 'Worksheet files',
      worksheets: pdfSheets as { id: number; title: string; fileUrl: string }[],
      contentType: 'pdf_worksheet',
      contentId: pdfSheets[0]?.id ?? 0,
      orderIndex: orderCursor++,
    });
  }
}

function slideOrderIndex(slide: LearnSlide): number | null {
  if ('orderIndex' in slide && typeof slide.orderIndex === 'number') return slide.orderIndex;
  return null;
}

export function findStartSlideIndex(
  slides: LearnSlide[],
  opts: BuildLessonSlidesOptions,
): number {
  if (opts.startType != null && opts.startId != null) {
    const t = String(opts.startType);
    const id = Number(opts.startId);
    // Direct quiz open lands on that quiz's start card (results handled by LearnMode when done).
    if (t === 'quiz') {
      const start = slides.findIndex(
        (s) => s.kind === 'quiz_start' && Number(s.contentId) === id,
      );
      if (start >= 0) return start;
      const q0 = slides.findIndex(
        (s) =>
          s.kind === 'quiz_question' &&
          s.qIndex === 0 &&
          Number(s.contentId) === id,
      );
      if (q0 >= 0) return q0;
    }
    const idx = slides.findIndex(
      (s) =>
        'contentType' in s &&
        s.contentType === t &&
        'contentId' in s &&
        Number(s.contentId) === id,
    );
    if (idx >= 0) return idx;
  }
  if (opts.startOrderIndex != null && Number.isFinite(Number(opts.startOrderIndex))) {
    const want = Number(opts.startOrderIndex);
    const quizStartByOrder = slides.findIndex(
      (s) => s.kind === 'quiz_start' && Number(s.orderIndex) === want,
    );
    if (quizStartByOrder >= 0) return quizStartByOrder;
    const idx = slides.findIndex((s) => slideOrderIndex(s) === want);
    if (idx >= 0) return idx;
  }
  return 0;
}

/** Slice a full deck so playback starts at the selected item through the end. */
export function sliceSlidesFromStart(
  fullSlides: LearnSlide[],
  opts: BuildLessonSlidesOptions = {},
): LearnSlide[] {
  const hasStart =
    (opts.startType != null && opts.startId != null) ||
    (opts.startOrderIndex != null && Number.isFinite(Number(opts.startOrderIndex)));

  const intro = fullSlides.find((s) => s.kind === 'intro');
  const done = fullSlides.find((s) => s.kind === 'done');
  const content = fullSlides.filter((s) => s.kind !== 'intro' && s.kind !== 'done');
  const cut = hasStart ? findStartSlideIndex(content, opts) : 0;
  const sliced = injectQuizzesListSlide(content.slice(cut));

  const out: LearnSlide[] = [];
  if (!hasStart && intro) out.push(intro);
  out.push(...sliced);
  if (done) out.push(done);
  else {
    out.push({
      key: 'done',
      kind: 'done',
      lessonTitle: intro && 'lessonTitle' in intro ? String(intro.lessonTitle) : '',
    });
  }
  return out;
}

/** Build horizontal learn-mode slides from a lesson GET payload (full lesson). */
export async function buildLessonSlides(
  lesson: LessonBundle,
  _opts: BuildLessonSlidesOptions = {},
): Promise<LearnSlide[]> {
  const content: LearnSlide[] = [];

  const ordered = lesson.orderedContent;
  if (ordered?.length) {
    await buildFromOrdered(content, lesson, ordered);
  } else {
    await buildFromLegacy(content, lesson);
  }

  if (!content.length) {
    content.push({
      key: 'empty-lesson',
      kind: 'text',
      sectionTitle: 'Lesson content',
      description: 'No slides are available yet for this lesson.',
      blocks: [],
      contentType: 'study_material',
      contentId: 0,
      orderIndex: 0,
      pageIndex: 0,
      pageCount: 1,
    });
  }

  const withQuizzes = injectQuizzesListSlide(content);
  const slides: LearnSlide[] = [
    {
      key: 'intro',
      kind: 'intro',
      lessonTitle: lesson.title,
      hint: 'Swipe left or right to move between pages.',
    },
    ...withQuizzes,
    { key: 'done', kind: 'done', lessonTitle: lesson.title },
  ];
  return slides;
}

export type LibraryCategory = 'video' | 'study_material' | 'worksheet' | 'quiz';

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  video: 'Videos',
  study_material: 'Study Material',
  worksheet: 'Worksheet',
  quiz: 'Quizzes',
};

export function slideLibraryCategory(slide: LearnSlide | undefined): LibraryCategory | null {
  if (!slide) return null;
  if (slide.kind === 'video') return 'video';
  if (slide.kind === 'text') {
    return slide.contentType === 'worksheet' ? 'worksheet' : 'study_material';
  }
  if (slide.kind === 'open_pdf_sheet') return 'worksheet';
  if (slide.kind === 'assignment') return null;
  if (
    slide.kind === 'quizzes_list' ||
    slide.kind === 'quiz_start' ||
    slide.kind === 'quiz_question' ||
    slide.kind === 'quiz_result'
  ) {
    return 'quiz';
  }
  return null;
}

export function firstIndexForLibraryCategory(slides: LearnSlide[], category: LibraryCategory): number {
  // Entering Quizzes lands on the first quiz start (picker is the numbered header squares).
  if (category === 'quiz') {
    const startIdx = slides.findIndex((s) => s.kind === 'quiz_start');
    if (startIdx >= 0) return startIdx;
  }
  return slides.findIndex((s) => slideLibraryCategory(s) === category);
}

/** Stable id for one library item (one video / material / worksheet / quiz / assignment). */
export function siblingItemKey(slide: LearnSlide): string | null {
  if (slide.kind === 'video') return `video:${slide.contentId}`;
  if (slide.kind === 'text') return `${slide.contentType}:${slide.contentId}`;
  if (slide.kind === 'open_pdf_sheet') return `worksheet:pdf:${slide.contentId}`;
  if (slide.kind === 'assignment') return `assignment:${slide.contentId}`;
  if (
    slide.kind === 'quiz_start' ||
    slide.kind === 'quiz_question' ||
    slide.kind === 'quiz_result'
  ) {
    return `quiz:${slide.quiz.quizKey}`;
  }
  return null;
}

/** Distinct items in a library category — for numbered square picker. */
export function listItemsInLibraryCategory(
  slides: LearnSlide[],
  category: LibraryCategory,
): { key: string; title: string; firstIndex: number }[] {
  const items: { key: string; title: string; firstIndex: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (slideLibraryCategory(s) !== category) continue;
    const key = siblingItemKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, firstIndex: i, title: slideItemTitle(s) });
  }
  return items;
}

export type LessonContentItem = {
  key: string;
  title: string;
  firstIndex: number;
  category: LibraryCategory;
  /** Present when category is quiz — for result/start routing. */
  quizKey?: string;
};

/** Distinct content items in deck order (skips intro / done). */
export function listLessonContentItems(slides: LearnSlide[]): LessonContentItem[] {
  const items: LessonContentItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const category = slideLibraryCategory(s);
    const key = siblingItemKey(s);
    if (!category || !key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      key,
      firstIndex: i,
      title: slideItemTitle(s),
      category,
      quizKey: s.kind === 'quiz_start' || s.kind === 'quiz_question' || s.kind === 'quiz_result'
        ? s.quiz.quizKey
        : undefined,
    });
  }
  return items;
}

/** Footer CTA after the current slide: next item label + target, or lesson summary. */
export function nextLessonFooterAction(
  slides: LearnSlide[],
  index: number,
): { label: string; kind: 'item'; item: LessonContentItem } | { label: 'Next'; kind: 'done'; doneIndex: number } | null {
  const items = listLessonContentItems(slides);
  if (!items.length) {
    const doneIndex = slides.findIndex((s) => s.kind === 'done');
    return doneIndex >= 0 ? { label: 'Next', kind: 'done', doneIndex } : null;
  }

  const currentKey = siblingItemKey(slides[index]);
  let pos = currentKey ? items.findIndex((it) => it.key === currentKey) : -1;
  if (pos < 0) {
    // Intro / between groups: treat as the last item that has already started.
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].firstIndex <= index) {
        pos = i;
        break;
      }
    }
  }

  const next = pos >= 0 ? items[pos + 1] : items[0];
  if (!next) {
    const doneIndex = slides.findIndex((s) => s.kind === 'done');
    return doneIndex >= 0 ? { label: 'Next', kind: 'done', doneIndex } : null;
  }

  const current = pos >= 0 ? items[pos] : null;
  const sameType = Boolean(current && current.category === next.category);
  const label = (() => {
    switch (next.category) {
      case 'video':
        return sameType ? 'Next Video' : 'Video';
      case 'study_material':
        return sameType ? 'Next Material' : 'Study Material';
      case 'quiz':
        return sameType ? 'Next Quiz' : 'Quiz';
      case 'worksheet':
        return sameType ? 'Next Worksheet' : 'Worksheet';
      default:
        return 'Next';
    }
  })();

  return { label, kind: 'item', item: next };
}

export type SiblingContentNav = {
  title: string;
  prevIndex: number | null;
  nextIndex: number | null;
  position: number;
  total: number;
};

/**
 * Prev/next among distinct items of the same library type (e.g. Quiz 1 ↔ Quiz 2).
 * Returns null when there is only one item of that type (hide arrows).
 */
export function siblingContentNav(slides: LearnSlide[], index: number): SiblingContentNav | null {
  const slide = slides[index];
  if (!slide) return null;
  const category = slideLibraryCategory(slide);
  if (!category || slide.kind === 'quizzes_list') return null;

  const currentKey = siblingItemKey(slide);
  if (!currentKey) return null;

  const items: { key: string; firstIndex: number; title: string }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (slideLibraryCategory(s) !== category) continue;
    const key = siblingItemKey(s);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, firstIndex: i, title: slideItemTitle(s) });
  }

  if (items.length <= 1) return null;

  const pos = items.findIndex((it) => it.key === currentKey);
  if (pos < 0) return null;

  return {
    title: items[pos].title,
    prevIndex: pos > 0 ? items[pos - 1].firstIndex : null,
    nextIndex: pos < items.length - 1 ? items[pos + 1].firstIndex : null,
    position: pos + 1,
    total: items.length,
  };
}

/** Categories present in this deck, in first-appearance (lesson composition) order. */
export function libraryCategoriesInOrder(
  slides: LearnSlide[],
): { id: LibraryCategory; label: string }[] {
  const seen = new Set<LibraryCategory>();
  const out: { id: LibraryCategory; label: string }[] = [];
  for (const s of slides) {
    const cat = slideLibraryCategory(s);
    if (!cat || seen.has(cat)) continue;
    seen.add(cat);
    out.push({ id: cat, label: LIBRARY_CATEGORY_LABELS[cat] });
  }
  return out;
}

/** Header title: content type only (never the item title). */
export function headerItemTypeLabel(slide: LearnSlide | undefined): string {
  if (!slide) return '';
  if (slide.kind === 'video') return 'Video';
  if (slide.kind === 'text') {
    return slide.contentType === 'worksheet' ? 'Worksheet' : 'Study Material';
  }
  if (
    slide.kind === 'quizzes_list' ||
    slide.kind === 'quiz_start' ||
    slide.kind === 'quiz_question' ||
    slide.kind === 'quiz_result'
  ) {
    return 'Quiz';
  }
  if (slide.kind === 'intro') return 'Lesson';
  if (slide.kind === 'done') return 'Complete';
  if (slide.kind === 'assignment') return 'Assignment';
  if (slide.kind === 'open_notes') return 'Class Notes';
  if (slide.kind === 'open_pdf_sheet') return 'Worksheet';
  return 'Lesson';
}

/** Item title shown under the type row (above content). */
export function slideItemTitle(slide: LearnSlide | undefined): string {
  if (!slide) return '';
  if (slide.kind === 'video') return slide.title || 'Video';
  if (slide.kind === 'text') return slide.sectionTitle || 'Content';
  if (slide.kind === 'quizzes_list') return 'Quizzes';
  if (slide.kind === 'quiz_start' || slide.kind === 'quiz_question' || slide.kind === 'quiz_result') {
    return slide.quiz.mode === 'v2'
      ? String(slide.quiz.quiz?.title || 'Quiz')
      : String(slide.quiz.quiz?.title || 'Quiz');
  }
  if (slide.kind === 'intro') return slide.lessonTitle || 'Lesson';
  if (slide.kind === 'done') return slide.lessonTitle || 'Complete';
  if (slide.kind === 'assignment') return slide.title || 'Assignment';
  if (slide.kind === 'open_notes' || slide.kind === 'open_pdf_sheet') return slide.sectionTitle;
  return '';
}

function stepGroupKey(slide: LearnSlide): string {
  if (slide.kind === 'intro') return 'intro';
  if (slide.kind === 'done') return 'done';
  if (slide.kind === 'video') return `video:${slide.contentId}`;
  if (slide.kind === 'text') return `text:${slide.contentType}:${slide.contentId}`;
  if (slide.kind === 'quizzes_list') return 'quizzes_list';
  if (slide.kind === 'quiz_start' || slide.kind === 'quiz_question' || slide.kind === 'quiz_result') {
    return `quiz:${slide.quiz.quizKey}`;
  }
  if (slide.kind === 'assignment') return `assignment:${slide.contentId}`;
  if (slide.kind === 'open_notes') return `notes:${slide.contentId}`;
  if (slide.kind === 'open_pdf_sheet') return `pdf:${slide.contentId}`;
  return slide.key;
}

/** Step position within the current video / material / worksheet / quiz group. */
export function contentStepMeta(
  slides: LearnSlide[],
  index: number,
): { step: number; total: number } {
  const slide = slides[index];
  if (!slide) return { step: 0, total: 0 };
  const key = stepGroupKey(slide);
  const indices: number[] = [];
  slides.forEach((s, i) => {
    if (stepGroupKey(s) === key) indices.push(i);
  });
  const pos = indices.indexOf(index);
  return {
    step: pos >= 0 ? pos + 1 : 1,
    total: Math.max(1, indices.length),
  };
}

/** @deprecated use headerItemTypeLabel */
export function headerProgressLabel(slide: LearnSlide | undefined): string | null {
  return headerItemTypeLabel(slide) || null;
}
