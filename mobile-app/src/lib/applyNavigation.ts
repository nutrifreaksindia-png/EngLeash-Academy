import { Alert } from 'react-native';
import { api } from '../api/client';
import type { PublicCourse } from '../screens/LandingHomeScreen';

export type OpenBatchRow = {
  id: number;
  batch_number?: number;
  title?: string;
  name?: string;
  session_type?: 'group' | 'one_to_one' | string;
};

export type ApplyCallbackNavParams = {
  courseId: number;
  courseName: string;
  batchId?: number | null;
  batchLabel?: string;
  noOpenBatches?: boolean;
};

export function isApplyEnquiryEnabled(course: Pick<PublicCourse, 'apply_enquiry_enabled'>): boolean {
  return course.apply_enquiry_enabled !== false && course.apply_enquiry_enabled !== 0;
}

export function batchDisplayLabel(batch: OpenBatchRow): string {
  const num = batch.batch_number ?? batch.id;
  const type = batch.session_type === 'one_to_one' ? '1:1' : 'Group';
  const title = String(batch.title || batch.name || '').trim();
  if (title) return `Batch ${num} · ${type} — ${title}`;
  return `Batch ${num} · ${type}`;
}

export async function fetchOpenBatchesForCourse(courseId: number): Promise<OpenBatchRow[]> {
  const data = await api.get(`/enrollments/courses/${courseId}/open-batches`);
  return Array.isArray(data?.batches) ? data.batches : [];
}

export function callbackParamsForCourse(
  course: Pick<PublicCourse, 'id' | 'name'>,
  opts?: { batch?: OpenBatchRow | null; noOpenBatches?: boolean },
): ApplyCallbackNavParams {
  const batch = opts?.batch;
  return {
    courseId: course.id,
    courseName: course.name,
    batchId: batch?.id ?? null,
    batchLabel: batch ? batchDisplayLabel(batch) : undefined,
    noOpenBatches: opts?.noOpenBatches ?? !batch,
  };
}

type NavLike = {
  navigate: (name: string, params?: object) => void;
  replace?: (name: string, params?: object) => void;
};

/** Route to batch picker or callback wizard when no open batches. */
export async function navigateApplyForCourse(
  navigation: NavLike,
  course: PublicCourse,
  options?: { replace?: boolean },
): Promise<void> {
  const go = options?.replace && navigation.replace ? navigation.replace.bind(navigation) : navigation.navigate.bind(navigation);

  if (!isApplyEnquiryEnabled(course)) {
    try {
      const batches = await fetchOpenBatchesForCourse(course.id);
      if (batches.length === 0) {
        Alert.alert('Apply', 'No open batches right now. Please check back later.');
        return;
      }
    } catch {
      /* fall through to batch screen */
    }
    go('ApplyCourseBatches', { course });
    return;
  }

  try {
    const batches = await fetchOpenBatchesForCourse(course.id);
    if (batches.length === 0) {
      go('ApplyCallback', callbackParamsForCourse(course, { noOpenBatches: true }));
      return;
    }
  } catch {
    /* show batch screen; it will load batches again */
  }

  go('ApplyCourseBatches', { course });
}

/** After sign-up / sign-in with apply intent. */
export async function navigateApplyAfterAuth(
  tabNav: { navigate?: (name: string, params?: object) => void } | undefined,
  courseId: number,
  courseName: string,
): Promise<boolean> {
  if (!tabNav?.navigate) return false;

  let course: PublicCourse = {
    id: courseId,
    name: courseName,
    enrollment_type: 'apply',
  };

  try {
    const catalog = await api.get('/courses/catalog');
    const row = Array.isArray(catalog) ? catalog.find((c: PublicCourse) => Number(c?.id) === Number(courseId)) : null;
    if (row) course = { ...course, ...row };
  } catch {
    try {
      const pub = await api.publicGet(`/courses/public/${courseId}`);
      if (pub) course = { ...course, ...pub };
    } catch {
      /* keep minimal course */
    }
  }

  if (!isApplyEnquiryEnabled(course)) {
    tabNav.navigate('Home', {
      screen: 'ApplyCourseBatches',
      params: { course },
    });
    return true;
  }

  try {
    const batches = await fetchOpenBatchesForCourse(courseId);
    if (batches.length === 0) {
      tabNav.navigate('Home', {
        screen: 'ApplyCallback',
        params: callbackParamsForCourse(course, { noOpenBatches: true }),
      });
      return true;
    }
  } catch {
    /* batch screen */
  }

  tabNav.navigate('Home', {
    screen: 'ApplyCourseBatches',
    params: { course },
  });
  return true;
}
