/** Apply / Subscribe resume: after auth, reopen Home → LandingHome with continuation params. Purchase goes to CoursePurchaseSummary (see navigatePurchaseSummaryAfterAuth). */

export type ResumeCourseAuthNavParams = {
  redirectAfterSignup: 'apply' | 'subscribe';
  courseId: number | string;
  courseName?: string;
};

export function normalizeResumeCourseAuthParams(routeParams: unknown): ResumeCourseAuthNavParams | null {
  const p = routeParams as Record<string, unknown> | undefined | null;
  if (!p) return null;
  const r = String(p.redirectAfterSignup || '');
  if (r !== 'apply' && r !== 'subscribe') return null;
  const id = Number(p.courseId);
  if (!Number.isFinite(id)) return null;
  return {
    redirectAfterSignup: r as ResumeCourseAuthNavParams['redirectAfterSignup'],
    courseId: p.courseId as number | string,
    courseName: p.courseName != null ? String(p.courseName) : undefined,
  };
}

export function navigateLandingResumeCourseAfterAuth(
  tabNav: { navigate?: (name: string, params?: unknown) => void } | undefined,
  normalized: ResumeCourseAuthNavParams | null
): boolean {
  if (!normalized) return false;
  const courseIdNum = Number(normalized.courseId);
  if (!Number.isFinite(courseIdNum)) return false;
  const courseNameStr = normalized.courseName ?? '';
  const landingParams =
    normalized.redirectAfterSignup === 'apply'
      ? { applyAfterAuthCourseId: courseIdNum, applyAfterAuthCourseName: courseNameStr }
      : {
          subscribeAfterAuthCourseId: courseIdNum,
          subscribeAfterAuthCourseName: courseNameStr,
        };
  tabNav?.navigate?.('Home', {
    screen: 'LandingHome',
    params: landingParams,
  });
  return true;
}

export type PurchaseSummaryAuthParams = {
  courseId: number;
  courseName: string;
  fee_inr: number;
  discount_inr: number;
};

/** After signup/login for one-time purchase funnel. */
export function navigatePurchaseSummaryAfterAuth(
  tabNav: { navigate?: (name: string, params?: unknown) => void } | undefined,
  p: PurchaseSummaryAuthParams | null
): boolean {
  if (!p || !Number.isFinite(p.courseId)) return false;
  tabNav?.navigate?.('Home', {
    screen: 'CoursePurchaseSummary',
    params: {
      courseId: p.courseId,
      courseName: p.courseName,
      fee_inr: p.fee_inr,
      discount_inr: p.discount_inr,
    },
  });
  return true;
}

export function purchaseSummaryParamsFromRoute(routeParams: unknown): PurchaseSummaryAuthParams | null {
  const p = routeParams as Record<string, unknown> | undefined | null;
  if (!p || String(p.redirectAfterSignup || '') !== 'purchase') return null;
  const id = Number(p.courseId);
  if (!Number.isFinite(id)) return null;
  return {
    courseId: id,
    courseName: p.courseName != null ? String(p.courseName) : 'Course',
    fee_inr: Number(p.courseFeeInr ?? 0),
    discount_inr: Number(p.courseDiscountInr ?? 0),
  };
}
