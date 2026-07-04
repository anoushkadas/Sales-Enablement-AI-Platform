// =====================================================================
// DATABASE — real persistence via Postgres (Neon free tier recommended;
// see README). This replaces the old "everything resets on refresh"
// behavior for users, lesson plans, roadmap items, and assignments.
//
// Uses the plain `pg` package with a connection pool — no ORM, so the
// SQL is visible and easy to audit/modify directly.
// =====================================================================

const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set. Roadmap, lesson plans, manager assignments, deals, and history will not persist. See README Part 3.");
}

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function query(text, params) {
  if (!pool) throw new Error("Database is not configured (missing DATABASE_URL).");
  return pool.query(text, params);
}

// ---------------------------------------------------------------------
// Schema setup — runs every server start. Each statement is safe to
// re-run (CREATE TABLE IF NOT EXISTS), so this is also how the schema
// gets created the very first time, with no manual migration step.
// ---------------------------------------------------------------------
async function ensureSchema() {
  if (!pool) return;

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'rep' CHECK (role IN ('rep', 'manager')),
      manager_email TEXT REFERENCES users(email),
      display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS lesson_plans (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      title TEXT NOT NULL,
      topic TEXT,
      parts JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS roadmap_items (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      lesson_plan_id INTEGER REFERENCES lesson_plans(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT,
      status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'done')),
      assigned_by TEXT REFERENCES users(email),
      due_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Migration for tables created before due_date existed — ADD COLUMN
  // IF NOT EXISTS is safe to run every startup, on every environment.
  await query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS due_date DATE;`);

  await query(`
    CREATE TABLE IF NOT EXISTS deals (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      name TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'Planning',
      value NUMERIC NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Migration: add the new deal fields if this table already existed
  // from before (CREATE TABLE IF NOT EXISTS above won't add columns to
  // a table that's already there). Each ADD COLUMN IF NOT EXISTS is
  // safe to run on every server start, whether the column exists yet
  // or not.
  await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS company TEXT;`);
  await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS deal_owner TEXT;`);
  await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS people_involved JSONB NOT NULL DEFAULT '[]';`);
  await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS timeline_date DATE;`);
  await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'medium';`);
  await query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';`);
  // Constraints added separately (not inline on the column) so they're
  // safe to re-run — Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so
  // we check pg_constraint first.
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_priority_check') THEN
        ALTER TABLE deals ADD CONSTRAINT deals_priority_check CHECK (priority IN ('low', 'medium', 'high'));
      END IF;
    END $$;
  `);
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_status_check') THEN
        ALTER TABLE deals ADD CONSTRAINT deals_status_check CHECK (status IN ('open', 'won', 'lost', 'on_hold'));
      END IF;
    END $$;
  `);
  // Old columns (industry, industry_detail, tech_stack, competitors,
  // stakeholders, closes) are left in place rather than dropped, even
  // though the current UI no longer uses them — dropping columns on an
  // existing table is destructive and not worth the risk for a cleanup
  // that has no functional benefit. They're simply unused going forward.

  await query(`
    CREATE TABLE IF NOT EXISTS deal_documents (
      id SERIAL PRIMARY KEY,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      owner_email TEXT NOT NULL REFERENCES users(email),
      display_name TEXT NOT NULL,
      gemini_file_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS history_log (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      tag TEXT NOT NULL DEFAULT 'General',
      deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS generated_content (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      title TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK (file_type IN ('pptx', 'docx')),
      filename TEXT NOT NULL,
      file_data BYTEA NOT NULL,
      deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Note: ADK conversation session tables are NOT created here. We use
  // @iqai/adk's createPostgresSessionService(DATABASE_URL), which
  // creates and manages its own tables automatically on first use
  // (confirmed in official docs: "Creates tables automatically on first
  // use (sessions, events, state data)"). Hand-writing that schema here
  // would create a second, competing definition of the same tables —
  // see server/adk-session-service.js for where this actually gets set
  // up.

  await query(`
    CREATE TABLE IF NOT EXISTS lesson_notes (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      roadmap_item_id INTEGER REFERENCES roadmap_items(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      note_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS lesson_quiz_attempts (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      roadmap_item_id INTEGER NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Saved searches — named bookmarks of a search query + tag filter
  // combination in History & lookups, so reps can resurface the same
  // search instantly rather than re-type it mid-call.
  await query(`
    CREATE TABLE IF NOT EXISTS saved_searches (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      name TEXT NOT NULL,
      query TEXT NOT NULL DEFAULT '',
      tag_filter TEXT NOT NULL DEFAULT 'All',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Onboarding tracks — manager-created sequences of lesson topics,
  // assigned as an ordered set to specific reps. Each track has ordered
  // steps; reps work through them in sequence.
  await query(`
    CREATE TABLE IF NOT EXISTS onboarding_tracks (
      id SERIAL PRIMARY KEY,
      created_by TEXT NOT NULL REFERENCES users(email),
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS onboarding_track_items (
      id SERIAL PRIMARY KEY,
      track_id INTEGER NOT NULL REFERENCES onboarding_tracks(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      topic TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS onboarding_track_assignments (
      id SERIAL PRIMARY KEY,
      track_id INTEGER NOT NULL REFERENCES onboarding_tracks(id) ON DELETE CASCADE,
      assignee_email TEXT NOT NULL REFERENCES users(email),
      assigned_by TEXT NOT NULL REFERENCES users(email),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(track_id, assignee_email)
    );
  `);

  // Badge/completion tracking — a single timestamp column on roadmap
  // items records when a rep earned a completion badge for a lesson
  // (set when all quiz attempts for that item show a passing score, or
  // when manually marked done). Kept on the existing table rather than
  // a separate table since it's a 1:1 property of the item.
  await query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS badge_earned_at TIMESTAMPTZ;`);
  await query(`ALTER TABLE roadmap_items ADD COLUMN IF NOT EXISTS quiz_questions JSONB;`);

  // Learning path certificates — awarded when a rep completes ALL
  // parts of a lesson plan (every roadmap_item from that plan has
  // badge_earned_at set, meaning each part's quiz was passed).
  await query(`
    CREATE TABLE IF NOT EXISTS learning_path_certificates (
      id SERIAL PRIMARY KEY,
      owner_email TEXT NOT NULL REFERENCES users(email),
      lesson_plan_id INTEGER REFERENCES lesson_plans(id) ON DELETE SET NULL,
      lesson_plan_title TEXT NOT NULL,
      earned_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log("Database schema ready.");
}

// ---------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------

// Called on every successful sign-in. Creates the user row on first
// sign-in only; never overwrites an existing role/manager assignment.
async function upsertUserOnSignIn(email, displayName) {
  await query(
    `INSERT INTO users (email, display_name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)`,
    [email, displayName || null]
  );
}

async function getUser(email) {
  const res = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  return res.rows[0] || null;
}

async function listAllUsers() {
  const res = await query(`SELECT email, role, manager_email, display_name FROM users ORDER BY email ASC`);
  return res.rows;
}

async function setUserRole(email, role) {
  if (role !== "rep" && role !== "manager") throw new Error("Invalid role.");
  await query(`UPDATE users SET role = $2 WHERE email = $1`, [email, role]);
}

async function setUserManager(email, managerEmail) {
  await query(`UPDATE users SET manager_email = $2 WHERE email = $1`, [email, managerEmail || null]);
}

async function listReportsOf(managerEmail) {
  const res = await query(
    `SELECT email, role, manager_email, display_name FROM users WHERE manager_email = $1 ORDER BY email ASC`,
    [managerEmail]
  );
  return res.rows;
}

// ---------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------

async function saveLessonPlan(ownerEmail, title, topic, parts) {
  const res = await query(
    `INSERT INTO lesson_plans (owner_email, title, topic, parts) VALUES ($1, $2, $3, $4) RETURNING *`,
    [ownerEmail, title, topic || null, JSON.stringify(parts)]
  );
  return res.rows[0];
}

async function getLessonPlan(id) {
  const res = await query(`SELECT * FROM lesson_plans WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------
// Roadmap items
// ---------------------------------------------------------------------

// node-postgres returns DATE columns as JS Date objects by default, which
// serialize to a full ISO timestamp ("2026-07-01T00:00:00.000Z") once sent
// as JSON — not the plain "2026-07-01" the frontend's <input type="date">
// and display pills expect. Normalize at the boundary so nothing
// downstream has to guess about format.
function normalizeDateField(row, field) {
  if (row[field] instanceof Date) {
    row[field] = row[field].toISOString().slice(0, 10);
  }
  return row;
}

async function addRoadmapItems(ownerEmail, lessonPlanId, items, assignedBy) {
  const inserted = [];
  for (const item of items) {
    const res = await query(
      `INSERT INTO roadmap_items (owner_email, lesson_plan_id, title, summary, content, quiz_questions, assigned_by, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [ownerEmail, lessonPlanId || null, item.title, item.summary || null, item.content || null, item.quiz ? JSON.stringify(item.quiz) : null, assignedBy || null, item.dueDate || null]
    );
    inserted.push(normalizeDateField(res.rows[0], "due_date"));
  }
  return inserted;
}

async function listRoadmapItems(ownerEmail, sortBy) {
  // sortBy: 'due_date' | 'assigned_date' (default) | 'status'
  // Validated against an allowlist before ever touching SQL — orderClause
  // below is always one of three fixed strings, never built from sortBy
  // directly, but we still reject anything unexpected up front.
  if (sortBy && !["due_date", "assigned_date", "status"].includes(sortBy)) {
    throw new Error("Invalid sort option.");
  }
  let orderClause;
  if (sortBy === "due_date") {
    // Items with no due date sort to the end regardless of direction.
    orderClause = `due_date IS NULL, due_date ASC, created_at DESC`;
  } else if (sortBy === "status") {
    orderClause = `CASE status WHEN 'in_progress' THEN 0 WHEN 'not_started' THEN 1 ELSE 2 END, created_at DESC`;
  } else {
    orderClause = `created_at DESC`; // assigned/created date, newest first
  }
  const res = await query(`SELECT * FROM roadmap_items WHERE owner_email = $1 ORDER BY ${orderClause}`, [ownerEmail]);
  return res.rows.map(row => normalizeDateField(row, "due_date"));
}

async function countRoadmapItemsByStatus(ownerEmail) {
  const res = await query(
    `SELECT status, COUNT(*)::int AS count FROM roadmap_items WHERE owner_email = $1 GROUP BY status`,
    [ownerEmail]
  );
  const counts = { not_started: 0, in_progress: 0, done: 0 };
  res.rows.forEach(row => { counts[row.status] = row.count; });

  // Overdue: not done, and due_date has already passed. A separate
  // query (not folded into the GROUP BY above) since "overdue" is a
  // date comparison cutting across statuses, not a status itself.
  const overdueRes = await query(
    `SELECT COUNT(*)::int AS count FROM roadmap_items
     WHERE owner_email = $1 AND status != 'done' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`,
    [ownerEmail]
  );
  counts.overdue = overdueRes.rows[0] ? overdueRes.rows[0].count : 0;

  return counts;
}

async function listOverdueRoadmapItems(ownerEmail) {
  const res = await query(
    `SELECT * FROM roadmap_items
     WHERE owner_email = $1 AND status != 'done' AND due_date IS NOT NULL AND due_date < CURRENT_DATE
     ORDER BY due_date ASC`,
    [ownerEmail]
  );
  return res.rows.map(row => normalizeDateField(row, "due_date"));
}

async function updateRoadmapItemStatus(id, ownerEmail, status) {
  if (!["not_started", "in_progress", "done"].includes(status)) throw new Error("Invalid status.");
  const res = await query(
    `UPDATE roadmap_items SET status = $3, updated_at = now() WHERE id = $1 AND owner_email = $2 RETURNING *`,
    [id, ownerEmail, status]
  );
  return res.rows[0] || null;
}

async function updateRoadmapItemDueDate(id, ownerEmail, dueDate) {
  const res = await query(
    `UPDATE roadmap_items SET due_date = $3, updated_at = now() WHERE id = $1 AND owner_email = $2 RETURNING *`,
    [id, ownerEmail, dueDate || null]
  );
  return res.rows[0] ? normalizeDateField(res.rows[0], "due_date") : null;
}

// ---------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------

async function createDeal(ownerEmail, deal) {
  const res = await query(
    `INSERT INTO deals
       (owner_email, name, company, deal_owner, people_involved, value, timeline_date, priority, status, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      ownerEmail,
      deal.name,
      deal.company || null,
      deal.dealOwner || null,
      JSON.stringify(deal.peopleInvolved || []),
      deal.value || 0,
      deal.timelineDate || null,
      deal.priority || "medium",
      deal.status || "open",
      deal.notes || null,
    ]
  );
  return res.rows[0];
}

async function listDeals(ownerEmail) {
  const res = await query(`SELECT * FROM deals WHERE owner_email = $1 ORDER BY created_at DESC`, [ownerEmail]);
  return res.rows;
}

async function getDeal(id, ownerEmail) {
  const res = await query(`SELECT * FROM deals WHERE id = $1 AND owner_email = $2`, [id, ownerEmail]);
  return res.rows[0] || null;
}

async function updateDeal(id, ownerEmail, fields) {
  // Only allow updating a known, safe set of columns — never build SQL
  // from arbitrary client-provided keys.
  const allowed = ["name", "company", "deal_owner", "value", "timeline_date", "priority", "status", "notes"];
  const sets = [];
  const values = [id, ownerEmail];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (fields.peopleInvolved !== undefined) {
    values.push(JSON.stringify(fields.peopleInvolved));
    sets.push(`people_involved = $${values.length}`);
  }
  if (sets.length === 0) return getDeal(id, ownerEmail);
  const res = await query(
    `UPDATE deals SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND owner_email = $2 RETURNING *`,
    values
  );
  return res.rows[0] || null;
}

async function deleteDeal(id, ownerEmail) {
  await query(`DELETE FROM deals WHERE id = $1 AND owner_email = $2`, [id, ownerEmail]);
}

// ---------------------------------------------------------------------
// Deal documents — metadata only; actual file content lives in the
// Gemini File Search store (see server.js uploadToFileSearchStore).
// This table just tracks which documents belong to which deal so the
// UI can list them and so deal-aware prompts can mention them.
// ---------------------------------------------------------------------

async function addDealDocument(dealId, ownerEmail, displayName, geminiFileName) {
  const res = await query(
    `INSERT INTO deal_documents (deal_id, owner_email, display_name, gemini_file_name) VALUES ($1, $2, $3, $4) RETURNING *`,
    [dealId, ownerEmail, displayName, geminiFileName || null]
  );
  return res.rows[0];
}

async function listDealDocuments(dealId, ownerEmail) {
  const res = await query(
    `SELECT * FROM deal_documents WHERE deal_id = $1 AND owner_email = $2 ORDER BY created_at DESC`,
    [dealId, ownerEmail]
  );
  return res.rows;
}

// ---------------------------------------------------------------------
// History log
// ---------------------------------------------------------------------

async function addHistoryEntry(ownerEmail, question, answer, tag, dealId) {
  const res = await query(
    `INSERT INTO history_log (owner_email, question, answer, tag, deal_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [ownerEmail, question, answer, tag || "General", dealId || null]
  );
  return res.rows[0];
}

async function listHistory(ownerEmail, limit) {
  const res = await query(
    `SELECT * FROM history_log WHERE owner_email = $1 ORDER BY created_at DESC LIMIT $2`,
    [ownerEmail, limit || 200]
  );
  return res.rows;
}

// ---------------------------------------------------------------------
// Generated content — saved PPTX/DOCX files so they can be re-downloaded
// later from the History page's "Generated content" view, instead of
// only existing as a one-time download response.
// ---------------------------------------------------------------------

async function saveGeneratedContent(ownerEmail, title, fileType, filename, fileBuffer, dealId) {
  const res = await query(
    `INSERT INTO generated_content (owner_email, title, file_type, filename, file_data, deal_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, owner_email, title, file_type, filename, deal_id, created_at`,
    [ownerEmail, title, fileType, filename, fileBuffer, dealId || null]
  );
  return res.rows[0];
}

// List metadata only — never pull the actual file bytes for a list view,
// since that would mean downloading every file's full content just to
// show a library page. The file itself is fetched separately, on demand,
// only when the user clicks download.
async function listGeneratedContent(ownerEmail) {
  const res = await query(
    `SELECT id, owner_email, title, file_type, filename, deal_id, created_at
     FROM generated_content WHERE owner_email = $1 ORDER BY created_at DESC`,
    [ownerEmail]
  );
  return res.rows;
}

async function getGeneratedContentFile(id, ownerEmail) {
  const res = await query(
    `SELECT * FROM generated_content WHERE id = $1 AND owner_email = $2`,
    [id, ownerEmail]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------
// Lesson notes — free-text notes a rep takes while reading a saved
// roadmap item, tagged with the topic they came from so the Notes tab
// can list "what I wrote" next to "what it was about."
// ---------------------------------------------------------------------
async function addLessonNote(ownerEmail, roadmapItemId, topic, noteText) {
  const res = await query(
    `INSERT INTO lesson_notes (owner_email, roadmap_item_id, topic, note_text) VALUES ($1, $2, $3, $4) RETURNING *`,
    [ownerEmail, roadmapItemId || null, topic, noteText]
  );
  return res.rows[0];
}

async function listLessonNotes(ownerEmail) {
  const res = await query(
    `SELECT * FROM lesson_notes WHERE owner_email = $1 ORDER BY created_at DESC`,
    [ownerEmail]
  );
  return res.rows;
}

async function deleteLessonNote(id, ownerEmail) {
  await query(`DELETE FROM lesson_notes WHERE id = $1 AND owner_email = $2`, [id, ownerEmail]);
}

// ---------------------------------------------------------------------
// Lesson quiz attempts — score history for the mini per-lesson quiz,
// separate from the standalone Test mode's quizzes (test-flow.js),
// which aren't tied to a specific saved roadmap item.
// ---------------------------------------------------------------------
async function addLessonQuizAttempt(ownerEmail, roadmapItemId, score, total) {
  const res = await query(
    `INSERT INTO lesson_quiz_attempts (owner_email, roadmap_item_id, score, total) VALUES ($1, $2, $3, $4) RETURNING *`,
    [ownerEmail, roadmapItemId, score, total]
  );
  return res.rows[0];
}

async function getLatestQuizAttempt(roadmapItemId, ownerEmail) {
  const res = await query(
    `SELECT * FROM lesson_quiz_attempts WHERE roadmap_item_id = $1 AND owner_email = $2 ORDER BY created_at DESC LIMIT 1`,
    [roadmapItemId, ownerEmail]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------
// Manager visibility — every roadmap item a manager has assigned,
// across all of their reports, with each report's current status. This
// is a manager-side view; listRoadmapItems (above) stays the rep-side
// "my own roadmap" view and is unchanged.
// ---------------------------------------------------------------------
async function listAssignmentsByManager(managerEmail) {
  const res = await query(
    `SELECT ri.*, u.display_name AS report_display_name
     FROM roadmap_items ri
     JOIN users u ON u.email = ri.owner_email
     WHERE ri.assigned_by = $1
     ORDER BY
       CASE WHEN ri.due_date IS NOT NULL AND ri.due_date < CURRENT_DATE AND ri.status != 'done' THEN 0 ELSE 1 END,
       ri.due_date ASC NULLS LAST,
       ri.created_at DESC`,
    [managerEmail]
  );
  return res.rows.map(row => normalizeDateField(row, "due_date"));
}

// ---------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------
async function listSavedSearches(ownerEmail) {
  const res = await query(
    `SELECT * FROM saved_searches WHERE owner_email = $1 ORDER BY created_at DESC`,
    [ownerEmail]
  );
  return res.rows;
}

async function createSavedSearch(ownerEmail, name, searchQuery, tagFilter) {
  const res = await query(
    `INSERT INTO saved_searches (owner_email, name, query, tag_filter) VALUES ($1, $2, $3, $4) RETURNING *`,
    [ownerEmail, name, searchQuery || "", tagFilter || "All"]
  );
  return res.rows[0];
}

async function deleteSavedSearch(id, ownerEmail) {
  await query(`DELETE FROM saved_searches WHERE id = $1 AND owner_email = $2`, [id, ownerEmail]);
}

// ---------------------------------------------------------------------
// Onboarding tracks
// ---------------------------------------------------------------------
async function createOnboardingTrack(createdBy, name, description, topics) {
  const trackRes = await query(
    `INSERT INTO onboarding_tracks (created_by, name, description) VALUES ($1, $2, $3) RETURNING *`,
    [createdBy, name, description || null]
  );
  const track = trackRes.rows[0];
  for (let i = 0; i < topics.length; i++) {
    await query(
      `INSERT INTO onboarding_track_items (track_id, position, topic) VALUES ($1, $2, $3)`,
      [track.id, i + 1, topics[i]]
    );
  }
  return track;
}

async function listOnboardingTracks(managerEmail) {
  const res = await query(
    `SELECT t.*, array_agg(i.topic ORDER BY i.position) AS topics
     FROM onboarding_tracks t
     LEFT JOIN onboarding_track_items i ON i.track_id = t.id
     WHERE t.created_by = $1
     GROUP BY t.id ORDER BY t.created_at DESC`,
    [managerEmail]
  );
  return res.rows;
}

async function assignOnboardingTrack(trackId, assigneeEmail, assignedBy) {
  await query(
    `INSERT INTO onboarding_track_assignments (track_id, assignee_email, assigned_by)
     VALUES ($1, $2, $3) ON CONFLICT (track_id, assignee_email) DO NOTHING`,
    [trackId, assigneeEmail, assignedBy]
  );
}

async function getOnboardingTrackProgress(trackId, assigneeEmail) {
  const trackRes = await query(
    `SELECT i.topic, r.status, r.badge_earned_at
     FROM onboarding_track_items i
     LEFT JOIN roadmap_items r ON r.owner_email = $2 AND r.title = i.topic
     WHERE i.track_id = $1 ORDER BY i.position`,
    [trackId, assigneeEmail]
  );
  return trackRes.rows;
}

// ---------------------------------------------------------------------
// Badge earning — called when a rep completes a quiz with a passing
// score (>= 2/3) or manually marks a roadmap item done. Sets
// badge_earned_at on the item if not already set.
// ---------------------------------------------------------------------
async function awardBadge(roadmapItemId, ownerEmail) {
  const res = await query(
    `UPDATE roadmap_items SET badge_earned_at = now()
     WHERE id = $1 AND owner_email = $2 AND badge_earned_at IS NULL
     RETURNING *`,
    [roadmapItemId, ownerEmail]
  );
  return res.rows[0] || null;
}

async function getBadges(ownerEmail) {
  const res = await query(
    `SELECT id, title, badge_earned_at FROM roadmap_items
     WHERE owner_email = $1 AND badge_earned_at IS NOT NULL
     ORDER BY badge_earned_at DESC`,
    [ownerEmail]
  );
  return res.rows;
}

// Check if all parts of a lesson plan are complete, and award a
// certificate if so. Called after every quiz submission.
async function checkAndAwardCertificate(ownerEmail, lessonPlanId) {
  if (!lessonPlanId) return null;
  // Count total parts in the plan vs how many have been completed
  const res = await query(
    `SELECT COUNT(*) AS total,
            COUNT(badge_earned_at) AS completed
     FROM roadmap_items
     WHERE owner_email = $1 AND lesson_plan_id = $2`,
    [ownerEmail, lessonPlanId]
  );
  const { total, completed } = res.rows[0];
  if (parseInt(total) === 0 || parseInt(completed) < parseInt(total)) return null;

  // All parts done — check if cert already exists
  const existing = await query(
    `SELECT id FROM learning_path_certificates WHERE owner_email = $1 AND lesson_plan_id = $2`,
    [ownerEmail, lessonPlanId]
  );
  if (existing.rows.length > 0) return null; // already awarded

  const planRes = await query(`SELECT title FROM lesson_plans WHERE id = $1`, [lessonPlanId]);
  const title = planRes.rows[0] ? planRes.rows[0].title : "Learning Path";
  const certRes = await query(
    `INSERT INTO learning_path_certificates (owner_email, lesson_plan_id, lesson_plan_title) VALUES ($1, $2, $3) RETURNING *`,
    [ownerEmail, lessonPlanId, title]
  );
  return certRes.rows[0];
}

async function getCertificates(ownerEmail) {
  const res = await query(
    `SELECT * FROM learning_path_certificates WHERE owner_email = $1 ORDER BY earned_at DESC`,
    [ownerEmail]
  );
  return res.rows;
}

async function listAllQuizAttempts(ownerEmail) {
  const res = await query(
    `SELECT qa.*, ri.title AS lesson_title
     FROM lesson_quiz_attempts qa
     JOIN roadmap_items ri ON ri.id = qa.roadmap_item_id
     WHERE qa.owner_email = $1 ORDER BY qa.created_at DESC LIMIT 100`,
    [ownerEmail]
  );
  return res.rows;
}

module.exports = {
  pool,
  ensureSchema,
  upsertUserOnSignIn,
  getUser,
  listAllUsers,
  setUserRole,
  setUserManager,
  listReportsOf,
  saveLessonPlan,
  getLessonPlan,
  addRoadmapItems,
  listRoadmapItems,
  countRoadmapItemsByStatus,
  listOverdueRoadmapItems,
  updateRoadmapItemStatus,
  updateRoadmapItemDueDate,
  createDeal,
  listDeals,
  getDeal,
  updateDeal,
  deleteDeal,
  addDealDocument,
  listDealDocuments,
  addHistoryEntry,
  listHistory,
  saveGeneratedContent,
  listGeneratedContent,
  getGeneratedContentFile,
  addLessonNote,
  listLessonNotes,
  deleteLessonNote,
  addLessonQuizAttempt,
  getLatestQuizAttempt,
  listAssignmentsByManager,
  listSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
  createOnboardingTrack,
  listOnboardingTracks,
  assignOnboardingTrack,
  getOnboardingTrackProgress,
  awardBadge,
  getBadges,
  checkAndAwardCertificate,
  getCertificates,
  listAllQuizAttempts,
};
