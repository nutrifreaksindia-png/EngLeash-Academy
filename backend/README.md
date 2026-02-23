# EngLeash Academy API

Node.js + Express backend. Uses SQLite by default (dev); can be switched to MySQL on Hostinger.

## Setup

```bash
npm install
npm run init-db   # create data/academy.db and tables
npm run seed      # optional: admin, trainer, student, lab users + sample course
npm start         # listen on PORT (default 3000)
```

## Env (optional)

Create `.env` from `.env.example`:

- `PORT` – server port (default 3000)
- `JWT_SECRET` – secret for JWT signing
- `API_URL` / `STORAGE_URL` – public base URLs for links (e.g. for Hostinger)

## API overview

- `POST /api/auth/login` – body: `{ email, password, role, client? }`. Returns `{ token, user }`. Lab must send `client: "tv"`.
- `GET /api/users/me` – current user (Bearer token).
- `GET /api/courses` – list (enrolled for non-Admin; all for Admin).
- `GET /api/courses/catalog` – all published courses + `enrolled` flag (Admin/Trainer/Student).
- `GET /api/courses/:id` – course detail.
- `POST /api/enrollments/enroll` – body: `{ course_id }` (Trainer/Student/Lab).
- `GET /api/lessons/course/:courseId` – lessons for course.
- `GET /api/lessons/:id` – lesson with `videoUrl`, `classNotes`, `worksheets`, `quiz`. Video download only for Admin.
- `GET /api/quizzes/lesson/:lessonId` – quiz and questions.
- `POST /api/quizzes/lesson/:lessonId/submit` – body: `{ answers: number[] }`. Returns `{ score, total, passed }`.
- `POST /api/uploads/lesson/:lessonId/notes` – Admin: upload class notes (multipart file).
- `POST /api/uploads/lesson/:lessonId/worksheet` – Admin: upload worksheet.
- `POST /api/uploads/lesson/:lessonId/video` – Admin: upload lesson video.

Videos and PDFs are served under `/uploads/...`.
