# EngLeash Academy – Development Plan

**Project:** EngLeash Academy Mobile & TV Apps  
**Phase:** 1 – Basics  
**Last updated:** February 2025  

---

## Overview

This plan covers **requirements first**, then **backend**, then **Android app**, then **Android TV app**. iOS is skipped for now.

---

## Phase 0: Prerequisites & Setup (Do This First)

### 0.1 Create requirements and confirm open points

- [x] Requirements document (this repo: `REQUIREMENTS.md`)
- [ ] **You:** Confirm open points in REQUIREMENTS.md (auth type, Admin download, quiz attempts, TV course list, etc.)
- [ ] **You:** Copy branding assets into project when ready:
  - Logo → e.g. `assets/logo.jpeg` (or `.png`)
  - Icon → e.g. `assets/icon.png` (for Android app icon and Android TV icon)

### 0.2 Hostinger – what to prepare

On your Hostinger account, create or have ready:

1. **Domain / subdomain**  
   - e.g. `api.engleashacademy.com` or `academy.yourdomain.com` for the API.

2. **Web hosting or VPS**  
   - Node.js (recommended) or PHP; enough for API + DB.

3. **Database**  
   - One MySQL or PostgreSQL database (name, user, password, host).  
   - You’ll use this in backend env (e.g. `.env`).

4. **SSL**  
   - HTTPS (Let’s Encrypt or Hostinger SSL) for the API domain.

5. **Storage**  
   - Space for: lesson videos (streaming), class notes PDFs, worksheet PDFs.  
   - Option: separate “storage” subdomain or path (e.g. `https://storage.engleashacademy.com/...`).

6. **Environment variables (later)**  
   - Backend will need: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `API_URL`, `STORAGE_URL`, etc.

**Deliverable:** Note down: API base URL, DB credentials (keep secret), storage base URL. No code yet—just “requirements” on the server side.

---

## Phase 1: Backend API (Hostinger)

Build the API that both Android and Android TV apps will use.

### 1.1 Stack suggestion

- **Runtime:** Node.js (LTS)
- **Framework:** Express (or Fastify)
- **DB:** MySQL or PostgreSQL
- **Auth:** JWT (access token; optional refresh token later)
- **File uploads:** Multer or similar; store files on disk or cloud (Hostinger storage path)

### 1.2 API scope (basics)

| Area | Endpoints (conceptual) |
|------|------------------------|
| **Auth** | `POST /auth/login` (body: role, email/username, password → token + user); optional `POST /auth/refresh` |
| **Users** | Admin: CRUD users (roles: Admin, Trainer, Student, Lab); others: get own profile |
| **Courses** | List courses; get one course; Admin: create/update/delete course |
| **Enrollments** | List my enrollments; enroll in course (Student/Trainer); Admin: enroll users, list by course |
| **Lessons** | List lessons by course; get one lesson (with video URL, notes, quiz, worksheet metadata) |
| **Class notes** | Get note for lesson (URL or file stream); upload (Admin) |
| **Quizzes** | Get quiz for lesson; submit answers; get results |
| **Worksheets** | Get worksheet for lesson (URL or file stream); upload (Admin) |
| **Video** | Lesson has `videoUrl` (streaming URL); backend does **not** expose download URL for Trainer/Student |

### 1.3 Business rules in API

- **Role checks:** Every endpoint verifies role (Admin / Trainer / Student / Lab).
- **Video URL:** For Trainer/Student, return only a **streaming** URL (e.g. HLS or direct stream), not a direct-download link. Lab same as Trainer/Student for video.
- **Lab + TV:** Optional: `GET /auth/login` returns client type (web/mobile/tv); reject Lab login if client ≠ TV (and reject non-Lab login from TV).
- **Enrollment:** Students/Trainers see only courses they’re enrolled in (unless you add “browse all” later).

### 1.4 Hostinger deployment

- Push backend code to a repo; on Hostinger use Git deploy or FTP.
- Set env vars (DB, JWT_SECRET, etc.) in hosting panel or `.env` (never commit `.env`).
- Point domain to Node app (e.g. via reverse proxy or Node process manager like PM2).
- Upload/store videos and PDFs in the chosen storage path; serve via API or direct URLs with token/expiry if needed.

**Deliverable:** Working API base URL (e.g. `https://api.engleashacademy.com`), all above endpoints implemented and tested (e.g. Postman).

---

## Phase 2: Android Mobile App

Single codebase; build one APK (phone/tablet). Use **React Native** or **Kotlin (Jetpack Compose)**—choose one and stick to it.

### 2.1 Project setup

- New project: e.g. `engleash-academy-android` under `Documents/EngLeash-Academy/`.
- App name: **EngLeash Academy**
- Package: e.g. `com.engleash.academy`
- Add logo and icon from assets (see Phase 0).

### 2.2 Screens (basics)

| # | Screen | Who sees it | Notes |
|---|--------|-------------|--------|
| 1 | Login | All (Admin, Trainer, Student) | Role selector + email/username + password |
| 2 | Home | All | List of courses (enrolled for Student/Trainer; all for Admin) |
| 3 | Course catalog / Enrollment | Student, Trainer, Admin | List courses; enroll button; Admin: manage |
| 4 | Course detail | All | List lessons (Day 01, Day 02, …) |
| 5 | Lesson detail | All | Tabs/sections: Video, Class notes, Quiz, Worksheet |
| 6 | Video player | All | Stream only; no download for Trainer/Student |
| 7 | Class notes | All | View + download PDF |
| 8 | Quiz | All | Load questions; submit; show result |
| 9 | Worksheet | All | View + download PDF |

### 2.3 Implementation order

1. **Auth:** Login UI → call `POST /auth/login` → store token → navigate by role.
2. **Home:** Call courses API (enrolled or all) → show list.
3. **Enrollment:** Catalog screen; enroll API; refresh “My courses”.
4. **Course detail:** Lessons list for selected course.
5. **Lesson detail:** Fetch lesson + video URL, notes, quiz, worksheet.
6. **Video:** Use ExoPlayer (Android) or React Native video lib; stream only; hide any download UI for Trainer/Student.
7. **Class notes:** In-app viewer + “Download” button (open URL or save file).
8. **Quiz:** Load questions; form; submit; show score/success.
9. **Worksheet:** Same as notes (view + download).

### 2.4 Security

- Store JWT in secure storage (e.g. Android Keystore / EncryptedSharedPreferences).
- Send `Authorization: Bearer <token>` on every API call.
- Disable video download (no download button / no download URL) for Trainer and Student.

**Deliverable:** APK that works with your Hostinger API; all four roles (Admin, Trainer, Student) can log in and use the flows above.

---

## Phase 3: Android TV App

Separate build variant or separate project (e.g. `engleash-academy-tv`) so that TV has its own launcher and no phone UI.

### 3.1 Project setup

- **Option A:** Same repo as Android app, with `androidtv` product flavor / build type.
- **Option B:** Separate project that shares API client and auth logic (e.g. shared module or copy minimal code).

Manifest:  
- `android.leanback` and TV launcher;  
- Declare that the app is not required for phone (so it doesn’t show in phone Play Store).

### 3.2 Screens (TV – minimal)

| # | Screen | Notes |
|---|--------|--------|
| 1 | Login | Only “Lab” option; email/username + password (D-pad friendly). |
| 2 | Course list | Only courses assigned/enrolled for this Lab user (or all—see requirements). |
| 3 | Lesson list | Day 01, Day 02, … for selected course. |
| 4 | Video player | Full-screen; ExoPlayer; no notes/quiz/worksheet. |

### 3.3 Implementation order

1. TV project/flavor + Leanback theme; app icon (same as icon asset).
2. Login: Lab only; call same `POST /auth/login` with role=Lab; backend may enforce client=TV.
3. Course list: call courses API (enrolled or as per backend).
4. Lesson list: list lessons for course.
5. Video: play `videoUrl` in ExoPlayer; back button returns to lesson list.

**Deliverable:** Android TV APK; Lab user can log in on TV and watch lesson videos only.

---

## Phase 4: Polish & Deploy (Later)

- Copy final logo/icon into both apps; splash screen.
- Error handling and basic loading states.
- Test on real device and TV.
- Build release APKs; sign; upload to Play Store (optional for later).
- Document API (e.g. Postman collection or OpenAPI) and env setup for Hostinger.

---

## Summary Checklist

- [ ] **You:** Confirm requirements and open points.
- [ ] **You:** Create Hostinger API host, DB, SSL, storage.
- [ ] **Dev:** Backend API (auth, courses, lessons, notes, quizzes, worksheets, video URL; no download for Trainer/Student/Lab).
- [ ] **Dev:** Android app (login, home, enrollment, course, lesson, video, notes, quiz, worksheet).
- [ ] **Dev:** Android TV app (Lab login, courses, lessons, video only).
- [ ] **You:** Copy logo/icon into project; test end-to-end.

Once requirements are confirmed and Hostinger is ready, development can start with the backend, then Android, then Android TV.
