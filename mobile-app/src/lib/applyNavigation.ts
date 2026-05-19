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

export type ApplyEnquiry = {
  id: number;
  courseId: number;
  batchId: number | null;
  status: string;
  displayName: string | null;
  phoneCountryCode: string | null;
  phoneLocal: string | null;
  callbackDate: string | null;
  callbackSlot: string | null;
  noteText?: string | null;
  batchLabel?: string | null;
};

export type ApplyCallbackNavParams = {
  courseId: number;
  courseName: string;
  batchId?: number | null;
  batchLabel?: string;
  noOpenBatches?: boolean;
  enquiryId?: number;
  editMode?: boolean;
  initialEnquiry?: ApplyEnquiry;
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

export async function fetchActiveApplyEnquiry(courseId: number): Promise<ApplyEnquiry | null> {
  try {
    const data = await api.get(`/payments/apply/enquiries/my?course_id=${courseId}`);
    return data?.enquiry ?? null;
  } catch {
    return null;
  }
}

export async function fetchActiveApplyEnquiryMap(): Promise<Record<number, ApplyEnquiry>> {
  try {
    const data = await api.get('/payments/apply/enquiries/my');
    const list: ApplyEnquiry[] = Array.isArray(data?.enquiries) ? data.enquiries : [];
    const map: Record<number, ApplyEnquiry> = {};
    for (const row of list) {
      if (row?.courseId) map[Number(row.courseId)] = row;
    }
    return map;
  } catch {
    return {};
  }
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

export function callbackParamsFromEnquiry(
  enquiry: ApplyEnquiry,
  courseName: string,
): ApplyCallbackNavParams {
  return {
    courseId: enquiry.courseId,
    courseName,
    batchId: enquiry.batchId,
    batchLabel: enquiry.batchLabel ?? undefined,
    noOpenBatches: enquiry.batchId == null,
    enquiryId: enquiry.id,
    editMode: true,
    initialEnquiry: enquiry,
  };
}

type NavLike = {
  navigate: (name: string, params?: object) => void;
  replace?: (name: string, params?: object) => void;
};

/** Route to edit callback, batch picker, or new callback when no open batches. */
export async function navigateApplyForCourse(
  navigation: NavLike,
  course: PublicCourse,
  options?: { replace?: boolean },
): Promise<void> {
  const go = options?.replace && navigation.replace ? navigation.replace.bind(navigation) : navigation.navigate.bind(navigation);

  const existing = await fetchActiveApplyEnquiry(course.id);
  if (existing) {
    go('ApplyCallback', callbackParamsFromEnquiry(existing, course.name));
    return;
  }

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

  const existing = await fetchActiveApplyEnquiry(courseId);
  if (existing) {
    tabNav.navigate('Home', {
      screen: 'ApplyCallback',
      params: callbackParamsFromEnquiry(existing, course.name),
    });
    return true;
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

export function applyPrimaryLabel(
  enrollmentType: string | undefined,
  hasBookedCall: boolean,
): string {
  const t = (enrollmentType || 'free').toLowerCase();
  if (t === 'apply' && hasBookedCall) return 'Edit call';
  if (t === 'apply') return 'Apply';
  if (t === 'purchase') return 'Purchase';
  if (t === 'subscribe') return 'Subscribe';
  return 'Join Free';
}
