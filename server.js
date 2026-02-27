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

// ─── Jira Webhook ─────────────────────────────────────────────────────────────
//
// Jira sends a POST to /webhook/jira every time an issue transitions.
// We only care about transitions TO the column defined in JIRA_PRODUCTION_COLUMN.
//
app.post('/webhook/jira', async (req, res) => {
  try {
    const payload = req.body;

    // Jira webhook secret validation (optional but recommended)
    const secret = req.headers['x-hub-signature'] || req.query.token;
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    // We only handle issue transitions
    if (payload.webhookEvent !== 'jira:issue_updated') {
      return res.status(200).json({ ignored: true });
    }

    const transition = payload.changelog?.items?.find(i => i.field === 'status');
    if (!transition) {
      return res.status(200).json({ ignored: true, reason: 'No status change' });
    }

    const targetColumn = process.env.JIRA_PRODUCTION_COLUMN || 'In Production';
    const toStatus = transition.toString;

    if (toStatus !== targetColumn) {
      return res.status(200).json({ ignored: true, reason: `Status "${toStatus}" is not "${targetColumn}"` });
    }

    // Extract issue data
    const issue = payload.issue;
    const name     = issue.fields.summary;
    const jiraKey  = issue.key;
    const jiraUrl  = `${process.env.JIRA_BASE_URL}/browse/${jiraKey}`;
    const owner    = issue.fields.assignee?.displayName || null;
    const date     = new Date().toISOString().split('T')[0]; // today

    // Avoid duplicates (same Jira issue transitioned twice)
    const existing = await pool.query('SELECT id FROM deploys WHERE jira_key = $1', [jiraKey]);
    if (existing.rows.length > 0) {
      return res.status(200).json({ ignored: true, reason: 'Already registered' });
    }

    await pool.query(
      'INSERT INTO deploys (name, date, env, owner, jira_key, jira_url) VALUES ($1, $2, $3, $4, $5, $6)',
      [name, date, 'prod', owner, jiraKey, jiraUrl]
    );

    console.log(`✓ Deploy registered from Jira: [${jiraKey}] ${name}`);
    res.status(201).json({ ok: true, jiraKey, name });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
});
