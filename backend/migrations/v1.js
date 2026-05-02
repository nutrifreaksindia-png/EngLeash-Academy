function runV1Migrations(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'approved';
  `);
}

function safeAlter(db, sql) {
  try {
    db.exec(sql);
  } catch (_) {
    // ignore duplicate-column errors for idempotency
  }
}

function ensureV1Tables(db) {
  safeAlter(db, "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'approved'");
  safeAlter(db, "ALTER TABLE users ADD COLUMN mobile_number TEXT");
  safeAlter(db, "ALTER TABLE users ADD COLUMN profile_photo_url TEXT");

  safeAlter(db, "ALTER TABLE courses ADD COLUMN highlights TEXT");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN specifications_html TEXT");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN duration_days INTEGER DEFAULT 1");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN lesson_schedule_json TEXT");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN modes_json TEXT");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN languages_json TEXT");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN fee_inr REAL DEFAULT 0");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN discount_inr REAL DEFAULT 0");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN course_status TEXT DEFAULT 'Active'");
  safeAlter(db, "ALTER TABLE courses ADD COLUMN enrollment_type TEXT DEFAULT 'free'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      full_name TEXT,
      email TEXT,
      role TEXT,
      profile_photo_url TEXT,
      mobile_number TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS student_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      gender TEXT CHECK(gender IN ('Male','Female','Other')),
      birth_date TEXT,
      address_line_1 TEXT,
      address_line_2 TEXT,
      city_district TEXT DEFAULT 'Madurai',
      state_province TEXT DEFAULT 'Tamil Nadu',
      country TEXT DEFAULT 'India',
      country_code TEXT DEFAULT '+91',
      occupation TEXT DEFAULT 'Student',
      policies_agreed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      enrollment_type TEXT NOT NULL CHECK(enrollment_type IN ('free','apply','purchase')) DEFAULT 'free',
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
      requested_at TEXT DEFAULT (datetime('now')),
      approved_at TEXT,
      approved_by INTEGER REFERENCES users(id),
      notes TEXT,
      UNIQUE(user_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS lesson_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      video_url TEXT,
      study_material_html TEXT,
      worksheet_html TEXT,
      worksheet_answer_key_html TEXT,
      assignment_title TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS course_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      lesson_id INTEGER NOT NULL REFERENCES lesson_library(id) ON DELETE CASCADE,
      day_number INTEGER NOT NULL,
      sequence_in_day INTEGER NOT NULL DEFAULT 1,
      UNIQUE(course_id, lesson_id),
      UNIQUE(course_id, day_number, sequence_in_day)
    );

    CREATE TABLE IF NOT EXISTS batch_trainers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      trainer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(batch_id, trainer_id)
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      holiday_date TEXT NOT NULL UNIQUE,
      reason TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batch_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      session_day INTEGER NOT NULL,
      lesson_id INTEGER REFERENCES lesson_library(id),
      lesson_title TEXT,
      session_date TEXT NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','cancelled')),
      cancellation_reason TEXT,
      cancelled_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(batch_id, session_day)
    );

    CREATE TABLE IF NOT EXISTS batch_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assignment_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL REFERENCES batch_assignments(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_key TEXT NOT NULL,
      file_url TEXT NOT NULL,
      submitted_at TEXT DEFAULT (datetime('now')),
      UNIQUE(assignment_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id);
    CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);
    CREATE INDEX IF NOT EXISTS idx_course_lessons_course_day ON course_lessons(course_id, day_number, sequence_in_day);
    CREATE INDEX IF NOT EXISTS idx_batch_sessions_batch_day ON batch_sessions(batch_id, session_day);
    CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON assignment_submissions(assignment_id);

    CREATE TABLE IF NOT EXISTS quiz_bank (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_bank_id INTEGER NOT NULL REFERENCES quiz_bank(id) ON DELETE CASCADE,
      version_no INTEGER NOT NULL,
      title TEXT,
      time_limit_sec INTEGER,
      shuffle_questions INTEGER DEFAULT 0,
      passing_pct REAL DEFAULT 0,
      published_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(quiz_bank_id, version_no)
    );

    CREATE TABLE IF NOT EXISTS quiz_questions_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_version_id INTEGER NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('mcq_single','mcq_multi','matching','fill_blank')),
      prompt TEXT NOT NULL,
      explanation TEXT,
      points REAL NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quiz_question_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES quiz_questions_v2(id) ON DELETE CASCADE,
      option_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_correct INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quiz_matching_pairs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES quiz_questions_v2(id) ON DELETE CASCADE,
      left_text TEXT NOT NULL,
      right_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quiz_blank_solutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES quiz_questions_v2(id) ON DELETE CASCADE,
      blank_key TEXT NOT NULL,
      answer_text TEXT NOT NULL,
      is_case_sensitive INTEGER NOT NULL DEFAULT 0,
      alt_group TEXT
    );

    CREATE TABLE IF NOT EXISTS quiz_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_version_id INTEGER NOT NULL REFERENCES quiz_versions(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('course','lesson')),
      scope_id INTEGER NOT NULL,
      availability_start TEXT,
      availability_end TEXT,
      is_required INTEGER NOT NULL DEFAULT 0,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_attempts_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL REFERENCES quiz_assignments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      started_at TEXT DEFAULT (datetime('now')),
      submitted_at TEXT,
      score REAL DEFAULT 0,
      max_score REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('started','submitted','abandoned'))
    );

    CREATE TABLE IF NOT EXISTS quiz_attempt_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL REFERENCES quiz_attempts_v2(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES quiz_questions_v2(id) ON DELETE CASCADE,
      response_json TEXT NOT NULL,
      is_correct INTEGER NOT NULL DEFAULT 0,
      earned_points REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_versions_bank ON quiz_versions(quiz_bank_id, version_no);
    CREATE INDEX IF NOT EXISTS idx_quiz_questions_v2_version ON quiz_questions_v2(quiz_version_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_quiz_question_options_qid ON quiz_question_options(question_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_quiz_matching_pairs_qid ON quiz_matching_pairs(question_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_quiz_blank_solutions_qid ON quiz_blank_solutions(question_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_assignments_scope ON quiz_assignments(scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS idx_quiz_attempts_v2_assignment_user ON quiz_attempts_v2(assignment_id, user_id, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_quiz_attempt_responses_attempt ON quiz_attempt_responses(attempt_id);

    CREATE TABLE IF NOT EXISTS video_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      video_url TEXT NOT NULL,
      storage_key TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS video_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL REFERENCES video_library(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('course','lesson')),
      scope_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_video_assignments_scope ON video_assignments(scope_type, scope_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_video_assignments_video ON video_assignments(video_id);

    CREATE TABLE IF NOT EXISTS study_material_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      content_json TEXT NOT NULL DEFAULT '{"schema_version":1,"blocks":[]}',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS study_material_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES study_material_library(id) ON DELETE CASCADE,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('image','gif','pdf','audio')),
      url TEXT NOT NULL,
      storage_key TEXT,
      meta_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS study_material_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES study_material_library(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('course','lesson')),
      scope_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_study_material_assets_material ON study_material_assets(material_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_study_material_assignments_scope ON study_material_assignments(scope_type, scope_id, order_index, id);
    CREATE INDEX IF NOT EXISTS idx_study_material_assignments_material ON study_material_assignments(material_id);
  `);

  safeAlter(db, "ALTER TABLE batches ADD COLUMN title TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN course_id INTEGER REFERENCES courses(id)");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN training_schedule_json TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN meeting_id TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN planned_start_date TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN actual_start_date TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN notes TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN batch_status TEXT DEFAULT 'draft'");
  safeAlter(db, "ALTER TABLE video_library ADD COLUMN category_id INTEGER REFERENCES video_categories(id)");
  safeAlter(db, "ALTER TABLE study_material_library ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS video_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.prepare('INSERT OR IGNORE INTO video_categories (name, slug) VALUES (?, ?)').run('English Grammar', 'english-grammar');
  db.prepare('INSERT OR IGNORE INTO video_categories (name, slug) VALUES (?, ?)').run('English Vocabulary', 'english-vocabulary');

  migrateUsersTableCreatorRole(db);
}

/** Expand users.role CHECK to allow Creator (SQLite cannot ALTER CHECK). */
function usersTableSqlAllowsCreator(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!row?.sql) return false;
  return String(row.sql).includes("'Creator'");
}

function migrateUsersTableCreatorRole(db) {
  if (usersTableSqlAllowsCreator(db)) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE users__creator_role (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL CHECK(role IN ('Admin', 'Trainer', 'Student', 'Lab', 'Creator')),
        created_at TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'approved',
        mobile_number TEXT,
        profile_photo_url TEXT
      );
    `);
    db.exec(`
      INSERT INTO users__creator_role (id, email, password_hash, name, role, created_at, status, mobile_number, profile_photo_url)
      SELECT id, email, password_hash, name, role, created_at, status, mobile_number, profile_photo_url FROM users;
    `);
    db.exec('DROP TABLE users;');
    db.exec('ALTER TABLE users__creator_role RENAME TO users;');
  });

  db.pragma('foreign_keys = OFF');
  try {
    tx();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

module.exports = { ensureV1Tables };
