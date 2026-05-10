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
  safeAlter(db, "ALTER TABLE courses ADD COLUMN progression_type TEXT DEFAULT 'unlock_all'");

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
      enrollment_type TEXT NOT NULL CHECK(enrollment_type IN ('free','apply','purchase','subscribe')) DEFAULT 'free',
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
      lesson_id INTEGER REFERENCES lesson_library(id) ON DELETE CASCADE,
      day_number INTEGER NOT NULL,
      sequence_in_day INTEGER NOT NULL DEFAULT 1,
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
      updated_at TEXT DEFAULT (datetime('now')),
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

    CREATE TABLE IF NOT EXISTS razorpay_course_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      razorpay_order_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','paid','failed')),
      payment_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_orders_payment_id ON razorpay_course_orders(payment_id) WHERE payment_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id);
    CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id);
    CREATE INDEX IF NOT EXISTS idx_course_lessons_course_day ON course_lessons(course_id, day_number, sequence_in_day);
    CREATE INDEX IF NOT EXISTS idx_batch_sessions_batch_day ON batch_sessions(batch_id, session_day);

    CREATE TABLE IF NOT EXISTS batch_session_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_session_id INTEGER NOT NULL REFERENCES batch_sessions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('present', 'absent', 'late', 'excused')),
      marked_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(batch_session_id, student_id)
    );
    CREATE INDEX IF NOT EXISTS idx_batch_session_attendance_session ON batch_session_attendance(batch_session_id);

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

    CREATE TABLE IF NOT EXISTS worksheet_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      content_json TEXT NOT NULL DEFAULT '{"schema_version":1,"blocks":[]}',
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS worksheet_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worksheet_id INTEGER NOT NULL REFERENCES worksheet_library(id) ON DELETE CASCADE,
      asset_type TEXT NOT NULL CHECK(asset_type IN ('image','gif','pdf','audio')),
      url TEXT NOT NULL,
      storage_key TEXT,
      meta_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS worksheet_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      worksheet_id INTEGER NOT NULL REFERENCES worksheet_library(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('course','lesson')),
      scope_id INTEGER NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_required INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_worksheet_assets_worksheet ON worksheet_assets(worksheet_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_worksheet_assignments_scope ON worksheet_assignments(scope_type, scope_id, order_index, id);
    CREATE INDEX IF NOT EXISTS idx_worksheet_assignments_worksheet ON worksheet_assignments(worksheet_id);

    CREATE TABLE IF NOT EXISTS assignment_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      content_html TEXT NOT NULL DEFAULT '',
      created_by INTEGER REFERENCES users(id),
      is_draft INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assignment_library_updated ON assignment_library (updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS lesson_library_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL REFERENCES lesson_library(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('video','study_material','worksheet','quiz','assignment')),
      item_id INTEGER NOT NULL,
      UNIQUE(lesson_id, item_type, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_lesson_library_items_lesson_order ON lesson_library_items (lesson_id, sort_order);
  `);

  safeAlter(db, "ALTER TABLE batches ADD COLUMN title TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN course_id INTEGER REFERENCES courses(id)");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN training_schedule_json TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN meeting_id TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN planned_start_date TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN actual_start_date TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN notes TEXT");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN batch_status TEXT DEFAULT 'draft'");
  safeAlter(db, "ALTER TABLE batches ADD COLUMN enrollment_open_status TEXT DEFAULT 'closed'");
  safeAlter(db, 'ALTER TABLE batches ADD COLUMN batch_number INTEGER');
  safeAlter(db, 'ALTER TABLE batches ADD COLUMN duration_days INTEGER');
  safeAlter(db, 'ALTER TABLE batches ADD COLUMN subscription_package_id INTEGER REFERENCES billing_packages(id)');
  safeAlter(db, 'ALTER TABLE course_enrollments ADD COLUMN batch_id INTEGER REFERENCES batches(id)');
  safeAlter(db, "ALTER TABLE video_library ADD COLUMN category_id INTEGER REFERENCES video_categories(id)");
  safeAlter(db, "ALTER TABLE study_material_library ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0");
  safeAlter(db, "ALTER TABLE worksheet_library ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0");
  safeAlter(db, 'ALTER TABLE worksheet_library ADD COLUMN answer_key_json TEXT');

  safeAlter(
    db,
    'ALTER TABLE live_sessions ADD COLUMN batch_session_id INTEGER REFERENCES batch_sessions(id) ON DELETE CASCADE'
  );
  /* SQLite ALTER ADD COLUMN does not allow non-constant DEFAULT(datetime('now')); add nullable column then backfill. */
  safeAlter(db, 'ALTER TABLE batch_sessions ADD COLUMN updated_at TEXT');
  try {
    db.prepare(
      `UPDATE batch_sessions SET updated_at = COALESCE(created_at, datetime('now')) WHERE updated_at IS NULL`
    ).run();
  } catch (_) {
    /* ignore if column missing in odd states */
  }
  try {
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_live_sessions_batch_session_id ON live_sessions(batch_session_id) WHERE batch_session_id IS NOT NULL'
    );
  } catch (_) {
    /* ignore */
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS live_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_live_chat_session_id ON live_chat_messages(live_session_id, id);

    CREATE TABLE IF NOT EXISTS live_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_live_reactions_session_id ON live_reactions(live_session_id, id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS live_session_recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      agora_resource_id TEXT,
      agora_sid TEXT,
      recording_uid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'starting' CHECK(status IN ('starting', 'recording', 'stopping', 'stopped', 'failed', 'expired')),
      storage_prefix TEXT,
      cdn_urls_json TEXT,
      file_list_json TEXT,
      started_at TEXT,
      stopped_at TEXT,
      expires_at TEXT,
      error_text TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_live_recording_session_status ON live_session_recordings(live_session_id, status);
    CREATE INDEX IF NOT EXISTS idx_live_recording_batch ON live_session_recordings(batch_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_live_recording_expires ON live_session_recordings(expires_at);

    CREATE TABLE IF NOT EXISTS video_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS course_combos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS course_combo_members (
      combo_id INTEGER NOT NULL REFERENCES course_combos(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      UNIQUE(combo_id, course_id)
    );

    CREATE TABLE IF NOT EXISTS billing_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK(scope IN ('course','combo')),
      course_id INTEGER REFERENCES courses(id),
      combo_id INTEGER REFERENCES course_combos(id),
      package_kind TEXT NOT NULL CHECK(package_kind IN ('subscription','renewal')),
      duration_unit TEXT NOT NULL CHECK(duration_unit IN ('day','month','year')),
      duration_count INTEGER NOT NULL DEFAULT 1,
      fee_inr REAL NOT NULL DEFAULT 0,
      discount_inr REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      CHECK (
        (scope = 'course' AND course_id IS NOT NULL AND combo_id IS NULL)
        OR (scope = 'combo' AND combo_id IS NOT NULL AND course_id IS NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_billing_pkg_course_kind ON billing_packages(course_id, package_kind, is_active);
    CREATE INDEX IF NOT EXISTS idx_billing_pkg_combo_kind ON billing_packages(combo_id, package_kind, is_active);

    CREATE TABLE IF NOT EXISTS course_access_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      starts_at_ms INTEGER NOT NULL,
      ends_at_ms INTEGER,
      grace_ends_at_ms INTEGER,
      billing_package_id INTEGER REFERENCES billing_packages(id),
      batch_id INTEGER REFERENCES batches(id),
      combo_id INTEGER REFERENCES course_combos(id),
      razorpay_order_id TEXT,
      payment_id TEXT,
      revoked_at_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_access_grants_user_course ON course_access_grants(user_id, course_id);

    CREATE TABLE IF NOT EXISTS razorpay_billing_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      razorpay_order_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_kind TEXT NOT NULL CHECK(order_kind IN ('subscribe','renewal','combo')),
      billing_package_id INTEGER NOT NULL REFERENCES billing_packages(id),
      course_id INTEGER REFERENCES courses(id),
      combo_id INTEGER REFERENCES course_combos(id),
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','paid','failed')),
      payment_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_bill_orders_payment ON razorpay_billing_orders(payment_id) WHERE payment_id IS NOT NULL;
  `);

  db.prepare('INSERT OR IGNORE INTO video_categories (name, slug) VALUES (?, ?)').run('English Grammar', 'english-grammar');
  db.prepare('INSERT OR IGNORE INTO video_categories (name, slug) VALUES (?, ?)').run('English Vocabulary', 'english-vocabulary');
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_course_enrollments_batch ON course_enrollments(batch_id)');
  } catch (_) {
    /* ignore */
  }

  migrateBatchesBatchNumber(db);
  migrateBatchCoursesTable(db);
  migrateCourseLessonsSchema(db);
  migrateUsersTableCreatorRole(db);
  migrateCourseEnrollmentsExpandSubscribe(db);
  migrateBackfillCourseAccessGrants(db);
}

/** SQLite cannot ALTER CHECK on enrollment_type — rebuild table with subscribe. */
function migrateCourseEnrollmentsExpandSubscribe(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='course_enrollments'").get();
  if (!row?.sql) return;
  if (String(row.sql).includes("'subscribe'")) return;

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE course_enrollments__sub_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        enrollment_type TEXT NOT NULL CHECK(enrollment_type IN ('free','apply','purchase','subscribe')) DEFAULT 'free',
        status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
        requested_at TEXT DEFAULT (datetime('now')),
        approved_at TEXT,
        approved_by INTEGER REFERENCES users(id),
        notes TEXT,
        batch_id INTEGER REFERENCES batches(id),
        UNIQUE(user_id, course_id)
      );
    `);
    db.exec(`
      INSERT INTO course_enrollments__sub_next (id, user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by, notes, batch_id)
      SELECT id, user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by, notes, batch_id
      FROM course_enrollments;
    `);
    db.exec('DROP TABLE course_enrollments');
    db.exec('ALTER TABLE course_enrollments__sub_next RENAME TO course_enrollments');
    db.exec('CREATE INDEX IF NOT EXISTS idx_course_enrollments_user ON course_enrollments(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_course_enrollments_course ON course_enrollments(course_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_course_enrollments_batch ON course_enrollments(batch_id)');
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function migrateBackfillCourseAccessGrants(db) {
  const col = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='course_access_grants'").get();
  if (!col) return;
  const rows = db
    .prepare(
      `SELECT user_id, course_id, enrollment_type FROM course_enrollments
       WHERE status = 'approved' AND enrollment_type IN ('free','purchase')`
    )
    .all();
  const existsStmt = db.prepare(
    `SELECT 1 FROM course_access_grants
     WHERE user_id = ? AND course_id = ? AND source = ? AND revoked_at_ms IS NULL AND ends_at_ms IS NULL`
  );
  const ins = db.prepare(
    `INSERT INTO course_access_grants (
      user_id, course_id, source, starts_at_ms, ends_at_ms, grace_ends_at_ms,
      billing_package_id, batch_id, combo_id, razorpay_order_id, payment_id, revoked_at_ms
    ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
  );
  const nowMs = Date.now();
  for (const r of rows) {
    const src = r.enrollment_type === 'purchase' ? 'purchase' : 'free';
    if (existsStmt.get(r.user_id, r.course_id, src)) continue;
    ins.run(r.user_id, r.course_id, src, nowMs);
  }
}

/** Many-to-many batches ↔ courses with optional subscription package per course (session syllabus stays batches.course_id = first row). */
function migrateBatchCoursesTable(db) {
  const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='batch_courses'").get();
  if (t) return;
  db.exec(`
    CREATE TABLE batch_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      billing_package_id INTEGER REFERENCES billing_packages(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      UNIQUE(batch_id, course_id)
    );
    CREATE INDEX IF NOT EXISTS idx_batch_courses_batch ON batch_courses(batch_id);
  `);
  const ins = db.prepare(`
    INSERT OR IGNORE INTO batch_courses (batch_id, course_id, billing_package_id, sort_order)
    VALUES (?, ?, ?, 0)
  `);
  const rows = db
    .prepare(
      'SELECT id AS batch_id, course_id, subscription_package_id FROM batches WHERE course_id IS NOT NULL',
    )
    .all();
  for (const r of rows) {
    ins.run(r.batch_id, r.course_id, r.subscription_package_id ?? null);
  }
}

/** Unique batch number per session_type (group vs one_to_one). */
function migrateBatchesBatchNumber(db) {
  const cols = db.prepare('PRAGMA table_info(batches)').all();
  if (!cols.some((c) => c.name === 'batch_number')) return;

  const idx = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_batches_session_type_batch_number'")
    .get();
  if (idx) return;

  const rows = db.prepare('SELECT id, session_type FROM batches ORDER BY session_type, id').all();
  let prevType = null;
  let seq = 0;
  const upd = db.prepare('UPDATE batches SET batch_number = ? WHERE id = ?');
  for (const r of rows) {
    if (r.session_type !== prevType) {
      prevType = r.session_type;
      seq = 0;
    }
    seq += 1;
    upd.run(seq, r.id);
  }

  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_session_type_batch_number ON batches(session_type, batch_number)'
  );
}

/** Nullable lesson_id + drop UNIQUE(course_id, lesson_id) so the same template can repeat on different days. */
function migrateCourseLessonsSchema(db) {
  const cols = db.prepare('PRAGMA table_info(course_lessons)').all();
  if (!cols.length) return;
  const lessonCol = cols.find((c) => c.name === 'lesson_id');
  const lessonNotNull = lessonCol && Number(lessonCol.notnull) === 1;
  const sqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='course_lessons'").get();
  const sql = String(sqlRow?.sql || '');
  const hasLessonPairUnique = sql.includes('UNIQUE(course_id, lesson_id)');

  if (!lessonNotNull && !hasLessonPairUnique) return;

  const { syncCourseLessonSlots } = require('../lib/syncCourseLessonSlots');

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS course_lessons__next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lesson_library(id) ON DELETE CASCADE,
        day_number INTEGER NOT NULL,
        sequence_in_day INTEGER NOT NULL DEFAULT 1,
        UNIQUE(course_id, day_number, sequence_in_day)
      );
    `);
    db.exec(`
      INSERT INTO course_lessons__next (id, course_id, lesson_id, day_number, sequence_in_day)
      SELECT id, course_id, lesson_id, day_number, sequence_in_day FROM course_lessons;
    `);
    db.exec('DROP TABLE course_lessons;');
    db.exec('ALTER TABLE course_lessons__next RENAME TO course_lessons;');
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_course_lessons_course_day ON course_lessons(course_id, day_number, sequence_in_day);'
    );

    const ids = db.prepare('SELECT id FROM courses').all();
    for (const { id } of ids) syncCourseLessonSlots(id);
  } finally {
    db.pragma('foreign_keys = ON');
  }
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
