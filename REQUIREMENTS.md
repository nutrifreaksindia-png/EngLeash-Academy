# EngLeash Academy – Requirements Document

**Project:** EngLeash Academy Mobile & TV Apps  
**Version:** 1.0 (Basics)  
**Last updated:** February 2025  

---

## 1. Branding Assets

| Asset | Source path | Usage |
|-------|-------------|--------|
| **Logo** | `/Users/manuelamalraj/Work/EA/Images/WhatsApp Image 2025-05-07 at 12.01.54.jpeg` | Splash, headers, marketing (full “EngLeash Academy” + tagline “Unleash your English from here”) |
| **Icon** | `/Users/manuelamalraj/Work/EA/Images/EngLeash Academy Favicon.png` | App icon (Android mobile & Android TV) – red square with white stylized “E” |

**Brand colours (from logo):** Red, dark blue, white, dark gray (divider).

---

## 2. Platforms (Phase 1)

| Platform | In scope now | Notes |
|----------|----------------|-------|
| **Android (phone/tablet)** | Yes | Full app |
| **Android TV** | Yes | Lab-only, video-only |
| **iOS** | No | Deferred to later phase |

---

## 3. User Roles & Login

Four login types; each user has exactly one role.

| Role | Allowed clients | Primary use |
|------|------------------|-------------|
| **Admin** | Android app | Manage courses, content, users, enrollments |
| **Trainers** | Android app | Teach; view content; no video download |
| **Students** | Android app | Learn; view content; no video download |
| **Lab** | Android TV app only | Play lesson videos in lab (no other features) |

- **Single restriction for now:** Trainers and Students **cannot download** lesson videos; they can **only stream/view**.
- Admin may have download capability (to be confirmed; can default to “view only” for consistency).
- Lab: no class notes, quizzes, or worksheets—only lesson videos.

---

## 4. Authentication & Access

- Login screen: role selection (Admin / Trainers / Students) for Android app; Lab for Android TV.
- Credentials: email + password (or username + password—to be confirmed with backend).
- Session/token-based auth; token stored securely on device.
- Lab login valid only on Android TV; reject Lab login from Android mobile app (and vice versa if needed).

---

## 5. Android App – Core Flows

### 5.1 Home screen (after login)

- List of **courses**.
- For Students/Trainers: show only **enrolled** courses (or “Browse courses” + “My courses”).
- For Admin: show all courses and ability to manage.

### 5.2 Course catalog / enrollment

- **Course enrollment screen**: list of available courses; user can enroll (Students/Trainers) or manage (Admin).
- After enrollment, enrolled courses appear on home (or under “My courses”).

### 5.3 Course detail & lessons

- One course contains many **lessons**.
- Lessons are ordered and labeled: **Day 01, Day 02, Day 03**, etc.
- For each lesson, the following are available (for Admin/Trainers/Students on Android app):

| Content type | View | Download |
|--------------|------|----------|
| **Lesson video** | Yes | No (Trainers & Students); Admin TBD |
| **Class notes** | Yes | Yes |
| **Quizzes** | Yes (take quiz) | N/A |
| **Worksheet** | Yes | Yes (assumed; confirm if view-only acceptable) |

- **Class notes:** View in-app and option to download (e.g. PDF).
- **Quizzes:** View/take quiz; submit answers; see results (basic flow).
- **Worksheet:** View and download (e.g. PDF).

---

## 6. Android TV App – Lab

- **Only Lab role** can use the TV app (reject other roles).
- **Only lesson videos:** no class notes, quizzes, or worksheets.
- Flow: Login (Lab) → List of courses (or enrolled/assigned courses) → Select course → List of lessons (Day 01, Day 02, …) → Play lesson video.
- UI: 10-foot experience (large text, D-pad/remote friendly, no touch).

---

## 7. Content Model (Logical)

- **Course:** id, name, description, image, order, isPublished, etc.
- **Lesson:** id, courseId, title (e.g. “Day 01”), order, videoUrl, etc.
- **Class notes:** per lesson; file (e.g. PDF) + optional title/description.
- **Quiz:** per lesson; questions (MCQ or similar); correct answers; user attempts stored.
- **Worksheet:** per lesson; file (e.g. PDF) + optional title/description.
- **Enrollment:** userId, courseId, role, enrolledAt.

(Exact fields and APIs will be defined in backend spec.)

---

## 8. Backend & Hosting

- Backend to be hosted on **Hostinger** (your server).
- Needs: REST (or GraphQL) API for auth, courses, lessons, enrollments, notes, quizzes, worksheets, and video URL (streaming).
- Video files: streamed from server or CDN (e.g. Hostinger storage or separate CDN); no download URL for Trainers/Students.
- Database: e.g. MySQL/PostgreSQL on Hostinger (to be decided in plan).

---

## 9. Non-Functional (Basics)

- **Security:** HTTPS only; secure token storage; no video download for Trainers/Students.
- **Offline:** Not required in Phase 1 (online only).
- **Performance:** List and video streaming should be smooth on typical connections.

---

## 10. Out of Scope (Phase 1)

- iOS app.
- Push notifications.
- Certificates / grades / advanced analytics.
- Social features, comments, forums.
- Offline download for any role (or restrict to Admin only if added later).

---

## 11. Open Points to Confirm

1. Auth: email+password or username+password?
2. Admin: can Admin download lesson videos or view only?
3. Worksheet: view + download, or view only?
4. Quiz: single attempt or multiple attempts per user per quiz?
5. TV: Lab sees all courses or only “assigned” courses?

Once these are confirmed, they can be added to this requirements doc and reflected in the plan.
