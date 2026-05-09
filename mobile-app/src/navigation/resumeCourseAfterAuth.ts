/** Apply/Purchase funnel: Landing sends user to Account → Signup (or Login) with these params; after signup or login we reopen Home → LandingHome with continuation params. */

export type ResumeCourseAuthNavParams = {
  redirectAfterSignup: 'apply' | 'purchase';
  courseId: number | string;
  courseName?: string;
};

export function normalizeResumeCourseAuthParams(routeParams: unknown): ResumeCourseAuthNavParams | null {
  const p = routeParams as Record<string, unknown> | undefined | null;
  if (!p) return null;
  const r = String(p.redirectAfterSignup || '');
  if (r !== 'apply' && r !== 'purchase') return null;
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
      : { purchaseAfterAuthCourseId: courseIdNum, purchaseAfterAuthCourseName: courseNameStr };
  tabNav?.navigate?.('Home', {
    screen: 'LandingHome',
    params: landingParams,
  });
  return true;
}
