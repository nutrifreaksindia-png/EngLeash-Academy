import { api } from '../api/client';
import { parseContentBlocks, splitBlocksByDivider } from '../components/learn/ContentBlocksView';

export type LessonBundle = {
  id: number;
  title: string;
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

export type QuizPayload =
  | { mode: 'v2'; quizKey: string; assignmentId: number; quiz: any }
  | { mode: 'legacy'; quizKey: string; lessonId: number; quiz: { id: number; title: string; questions: any[] } };

export type LearnSlide =
  | { key: string; kind: 'intro'; lessonTitle: string; hint?: string }
  | { key: string; kind: 'video'; title: string; videoUrl: string; allowDownload: boolean }
  | { key: string; kind: 'text'; sectionTitle: string; description?: string | null; blocks: any[] }
  | { key: string; kind: 'quiz_question'; quiz: QuizPayload; question: any; qIndex: number; qTotal: number }
  | { key: string; kind: 'quiz_submit'; quiz: QuizPayload }
  | { key: string; kind: 'quiz_result'; quiz: QuizPayload }
  | {
      key: string;
      kind: 'open_notes';
      sectionTitle: string;
      notes: { id: number; title: string; fileUrl: string }[];
    }
  | {
      key: string;
      kind: 'open_pdf_sheet';
      sectionTitle: string;
      worksheets: { id: number; title: string; fileUrl: string }[];
    }
  | { key: string; kind: 'assignment'; assignmentId: number; title: string; description?: string }
  | { key: string; kind: 'done'; lessonTitle: string };

export function appendQuizSeries(slides: LearnSlide[], pack: QuizPayload) {
  const qs = pack.mode === 'v2' ? pack.quiz?.questions || [] : pack.quiz?.questions || [];
  if (!qs.length) return;
  const total = qs.length;
  qs.forEach((q: any, i: number) => {
    slides.push({
      key: `${pack.quizKey}-q-${q.id}-${i}`,
      kind: 'quiz_question',
      quiz: pack,
      question: q,
      qIndex: i,
      qTotal: total,
    });
  });
  slides.push({ key: `${pack.quizKey}-submit`, kind: 'quiz_submit', quiz: pack });
  slides.push({ key: `${pack.quizKey}-result`, kind: 'quiz_result', quiz: pack });
}

async function fetchQuizV2(assignmentId: number): Promise<any | null> {
  try {
    const payload = await api.get(`/quizzes/v2/assignment/${assignmentId}`);
    return payload?.quiz || null;
  } catch {
    return null;
  }
}

async function studyMaterialSlides(
  keyPrefix: string,
  lessonId: number,
  materialId: number,
  title: string,
  description?: string,
): Promise<LearnSlide[]> {
  try {
    const data = await api.get(`/study-materials/${materialId}`);
    const raw = splitBlocksByDivider(parseContentBlocks(data.content_json || '')).filter((c) => c.length > 0);
    const chunks = raw.length ? raw : [parseContentBlocks(data.content_json || '')];
    return chunks.filter((chunk) => chunk.length > 0).map((chunk, pi) => ({
      key: `${keyPrefix}-l${lessonId}-sm-${materialId}-${pi}`,
      kind: 'text' as const,
      sectionTitle: chunks.length > 1 ? `${title} · Page ${pi + 1}/${chunks.length}` : title,
      description: pi === 0 ? description || data.description : undefined,
      blocks: chunk,
    }));
  } catch {
    return [{
      key: `${keyPrefix}-l${lessonId}-sm-${materialId}-err`,
      kind: 'text' as const,
      sectionTitle: title,
      description,
      blocks: [],
    }];
  }
}

async function worksheetLibrarySlides(
  keyPrefix: string,
  lessonId: number,
  worksheetId: number,
  title: string,
  description?: string,
): Promise<LearnSlide[]> {
  try {
    const data = await api.get(`/worksheets/${worksheetId}`);
    const raw = splitBlocksByDivider(parseContentBlocks(data.content_json || '')).filter((c) => c.length > 0);
    const chunks = raw.length ? raw : [parseContentBlocks(data.content_json || '')];
    return chunks.filter((chunk) => chunk.length > 0).map((chunk, pi) => ({
      key: `${keyPrefix}-l${lessonId}-ws-${worksheetId}-${pi}`,
      kind: 'text' as const,
      sectionTitle: chunks.length > 1 ? `${title} · Page ${pi + 1}/${chunks.length}` : title,
      description: pi === 0 ? description || data.description : undefined,
      blocks: chunk,
    }));
  } catch {
    return [{
      key: `${keyPrefix}-l${lessonId}-ws-${worksheetId}-err`,
      kind: 'text' as const,
      sectionTitle: title,
      description,
      blocks: [],
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
        });
      }
    } else if (row.type === 'study_material') {
      const part = await studyMaterialSlides('ord', lesson.id, row.id, row.title || 'Study material', row.description);
      slides.push(...part);
    } else if (row.type === 'worksheet') {
      const part = await worksheetLibrarySlides('ord', lesson.id, row.id, row.title || 'Worksheet', row.description);
      slides.push(...part);
    } else if (row.type === 'quiz') {
      let pack: QuizPayload | null = null;
      if (row.quizAssignmentId) {
        const q = await fetchQuizV2(row.quizAssignmentId);
        const questions = q?.questions || [];
        if (questions.length) {
          pack = {
            mode: 'v2',
            quizKey: `ord-l${lesson.id}-a${row.quizAssignmentId}`,
            assignmentId: row.quizAssignmentId,
            quiz: q,
          };
        }
      }
      if (!pack && lesson.quiz?.questions?.length) {
        pack = {
          mode: 'legacy',
          quizKey: `ord-l${lesson.id}-legacy`,
          lessonId: lesson.id,
          quiz: lesson.quiz,
        };
      }
      if (pack) appendQuizSeries(slides, pack);
    } else if (row.type === 'assignment') {
      slides.push({
        key: `ord-as-${row.orderIndex}-${row.id}`,
        kind: 'assignment',
        assignmentId: row.id,
        title: row.title || 'Assignment',
        description: row.description || '',
      });
    }
  }
}

async function buildFromLegacy(slides: LearnSlide[], lesson: LessonBundle) {
  const vids = lesson.videoAssignments?.length ? lesson.videoAssignments : null;
  if (vids) {
    vids.forEach((v, i) => {
      if (v.video_url) {
        slides.push({
          key: `leg-v-${v.id}-${i}`,
          kind: 'video',
          title: v.video_title || 'Lesson video',
          videoUrl: v.video_url,
          allowDownload: lesson.allowVideoDownload,
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
    });
  }

  const notes = lesson.classNotes || [];
  if (notes.length) {
    slides.push({
      key: `leg-notes`,
      kind: 'open_notes',
      sectionTitle: 'Class notes',
      notes,
    });
  }

  if (lesson.quiz?.questions?.length) {
    appendQuizSeries(slides, {
      mode: 'legacy',
      quizKey: `leg-l${lesson.id}-qz`,
      lessonId: lesson.id,
      quiz: lesson.quiz,
    });
  } else if ((lesson.quizAssignments || []).length) {
    const qa = lesson.quizAssignments![0];
    if (qa?.id) {
      const q = await fetchQuizV2(qa.id);
      const questions = q?.questions || [];
      if (questions.length) {
        appendQuizSeries(slides, {
          mode: 'v2',
          quizKey: `leg-v2-${lesson.id}-${qa.id}`,
          assignmentId: qa.id,
          quiz: q,
        });
      }
    }
  }

  for (const sm of lesson.studyMaterialAssignments || []) {
    const part = await studyMaterialSlides('leg', lesson.id, sm.material_id, sm.material_title || 'Study material', sm.material_description);
    slides.push(...part);
  }
  for (const w of lesson.libraryWorksheetAssignments || []) {
    const part = await worksheetLibrarySlides(
      'leg',
      lesson.id,
      w.worksheet_id,
      w.worksheet_title || 'Worksheet',
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
    });
  }
}

/** Build horizontal learn-mode slides from a lesson GET payload. */
export async function buildLessonSlides(lesson: LessonBundle): Promise<LearnSlide[]> {
  const slides: LearnSlide[] = [];
  slides.push({
    key: 'intro',
    kind: 'intro',
    lessonTitle: lesson.title,
    hint: 'Swipe left or right to move between pages.',
  });

  const ordered = lesson.orderedContent;
  if (ordered?.length) {
    await buildFromOrdered(slides, lesson, ordered);
  } else {
    await buildFromLegacy(slides, lesson);
  }

  slides.push({ key: 'done', kind: 'done', lessonTitle: lesson.title });

  const inner = slides.slice(1, -1);
  if (!inner.length) {
    slides.splice(slides.length - 1, 0, {
      key: 'empty-lesson',
      kind: 'text',
      sectionTitle: 'Lesson content',
      description: 'No slides are available yet for this lesson.',
      blocks: [],
    });
  }

  return slides;
}
