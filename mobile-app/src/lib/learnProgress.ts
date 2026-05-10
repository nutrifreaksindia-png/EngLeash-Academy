import AsyncStorage from '@react-native-async-storage/async-storage';

export type LessonLearnRecord = {
  totalSteps: number;
  /** Highest slide index the learner has reached (0-based). */
  furthestStepIndex: number;
  completed: boolean;
  updatedAt: string;
};

function storageKey(userId: number, courseId: number, lessonId: number) {
  return `learn:v1:${userId}:${courseId}:${lessonId}`;
}

export async function getLessonProgress(
  userId: number,
  courseId: number,
  lessonId: number,
): Promise<LessonLearnRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, courseId, lessonId));
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

export async function saveLessonProgress(
  userId: number,
  courseId: number,
  lessonId: number,
  patch: Partial<LessonLearnRecord>,
): Promise<void> {
  const prev = await getLessonProgress(userId, courseId, lessonId);
  const next: LessonLearnRecord = {
    totalSteps: patch.totalSteps ?? prev?.totalSteps ?? 0,
    furthestStepIndex: Math.max(
      patch.furthestStepIndex ?? prev?.furthestStepIndex ?? 0,
      prev?.furthestStepIndex ?? 0,
    ),
    completed: patch.completed !== undefined ? patch.completed : prev?.completed ?? false,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(storageKey(userId, courseId, lessonId), JSON.stringify(next));
}

export async function clearLessonProgress(userId: number, courseId: number, lessonId: number) {
  await AsyncStorage.removeItem(storageKey(userId, courseId, lessonId));
}

export async function clearCourseProgress(userId: number, courseId: number, lessonIds: number[]) {
  await Promise.all(lessonIds.map((id) => clearLessonProgress(userId, courseId, id)));
}

export async function computeCourseProgressPercent(
  userId: number,
  courseId: number,
  lessons: { id: number }[],
): Promise<number> {
  if (!lessons.length) return 0;
  let acc = 0;
  for (const l of lessons) {
    const p = await getLessonProgress(userId, courseId, l.id);
    if (p?.completed) {
      acc += 100;
    } else if (p?.totalSteps) {
      acc += Math.min(100, ((p.furthestStepIndex + 1) / p.totalSteps) * 100);
    }
  }
  return Math.round(acc / lessons.length);
}

/** First lesson without completed=true, else first lesson id. */
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
): Promise<LessonAction> {
  const p = await getLessonProgress(userId, courseId, lessonId);
  if (!p) return 'start';
  if (p.completed) return 'restart';
  if (p.furthestStepIndex > 0) return 'resume';
  return 'start';
}

export async function allLessonsCompleted(
  userId: number,
  courseId: number,
  lessonIds: number[],
): Promise<boolean> {
  if (!lessonIds.length) return false;
  for (const id of lessonIds) {
    const p = await getLessonProgress(userId, courseId, id);
    if (!p?.completed) return false;
  }
  return true;
}
