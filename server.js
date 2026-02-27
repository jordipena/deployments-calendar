require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database ────────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deploys (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      date      DATE NOT NULL,
      env       TEXT NOT NULL DEFAULT 'prod',
      owner     TEXT,
      notes     TEXT,
      jira_key  TEXT,
      jira_url  TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log('✓ Database ready');
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Jira Polling ─────────────────────────────────────────────────────────────
//
// Every 2 minutes, queries Jira API for issues that transitioned to DONE
// recently, and registers them as deploys if not already present.
//
async function pollJira() {
  const baseUrl    = process.env.JIRA_BASE_URL;
  const email      = process.env.JIRA_EMAIL;
  const apiToken   = process.env.JIRA_API_TOKEN;
  const project    = process.env.JIRA_PROJECT_KEY;
  const statusName = process.env.JIRA_PRODUCTION_COLUMN || 'Done';

  if (!baseUrl || !email || !apiToken || !project) {
    console.log('⚠ Jira polling skipped — missing env vars');
    return;
  }

  try {
    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

    // Search issues moved to the target status in the last 10 minutes
    const jql = encodeURIComponent(
      `project = "${project}" AND status = "${statusName}" AND status changed to "${statusName}" after "-10m"`
    );

    const url = `${baseUrl}/rest/api/3/search?jql=${jql}&fields=summary,assignee,statuscategorychangedate`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('✗ Jira API error:', response.status, await response.text());
      return;
    }

    const data = await response.json();
    const issues = data.issues || [];

    for (const issue of issues) {
      const jiraKey = issue.key;

      // Skip if already registered
      const existing = await pool.query('SELECT id FROM deploys WHERE jira_key = $1', [jiraKey]);
      if (existing.rows.length > 0) continue;

      const name     = issue.fields.summary;
      const owner    = issue.fields.assignee?.displayName || null;
      const jiraUrl  = `${baseUrl}/browse/${jiraKey}`;
      const date     = new Date().toISOString().split('T')[0];

      await pool.query(
        'INSERT INTO deploys (name, date, env, owner, jira_key, jira_url) VALUES ($1, $2, $3, $4, $5, $6)',
        [name, date, 'prod', owner, jiraKey, jiraUrl]
      );

      console.log(`✓ Deploy registered from Jira polling: [${jiraKey}] ${name}`);
    }

  } catch (err) {
    console.error('✗ Jira polling error:', err.message);
  }
}

// Run every 2 minutes
const POLL_INTERVAL_MS = 2 * 60 * 1000;

// ─── REST API ─────────────────────────────────────────────────────────────────

// GET /api/deploys?year=2026&month=3
app.get('/api/deploys', async (req, res) => {
  try {
    const { year, month } = req.query;
    let query = 'SELECT * FROM deploys';
    const params = [];

    if (year && month) {
      query += ' WHERE EXTRACT(YEAR FROM date) = $1 AND EXTRACT(MONTH FROM date) = $2';
      params.push(year, month);
    }

    query += ' ORDER BY date ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deploys  — manual entry from the UI
app.post('/api/deploys', async (req, res) => {
  try {
    const { name, date, env, owner, notes } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date are required' });

    const result = await pool.query(
      'INSERT INTO deploys (name, date, env, owner, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, date, env || 'prod', owner || null, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/deploys/:id
app.delete('/api/deploys/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM deploys WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

initDB().then(() => {
  app.listen(PORT, () => console.log(`✓ Server running on port ${PORT}`));
  pollJira();
  setInterval(pollJira, POLL_INTERVAL_MS);
  console.log(`✓ Jira polling started (every ${POLL_INTERVAL_MS / 1000}s)`);
});
