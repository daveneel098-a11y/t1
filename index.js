const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../')));

// Initialize PostgreSQL Connection Pool
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl && dbUrl.includes('localhost') ? false : {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Database schema initialization & auto-seeding flag
let isDbInitialized = false;

async function ensureDatabaseSchema() {
  if (isDbInitialized) return;
  
  const client = await pool.connect();
  try {
    // 1. Create Tables if not exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username VARCHAR(50) PRIMARY KEY,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100),
        phone VARCHAR(30),
        program VARCHAR(100),
        year VARCHAR(20),
        semester VARCHAR(20),
        class VARCHAR(50),
        division VARCHAR(10),
        roll_no VARCHAR(50),
        spdid VARCHAR(50),
        enrolment_no VARCHAR(50),
        adm_app_no VARCHAR(50),
        admission_year VARCHAR(10),
        attendance JSONB DEFAULT '{}'::JSONB,
        fee_status JSONB DEFAULT '{}'::JSONB,
        grades JSONB DEFAULT '[]'::JSONB,
        department VARCHAR(100),
        office VARCHAR(100),
        classes TEXT[],
        subjects TEXT[],
        schedule JSONB DEFAULT '[]'::JSONB
      );

      CREATE TABLE IF NOT EXISTS subjects (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        program VARCHAR(50) NOT NULL,
        year VARCHAR(20) NOT NULL,
        semester VARCHAR(20) NOT NULL,
        UNIQUE (name, program, year, semester)
      );

      CREATE TABLE IF NOT EXISTS attendance_codes (
        id VARCHAR(50) PRIMARY KEY,
        code VARCHAR(10) NOT NULL,
        division VARCHAR(50) NOT NULL,
        date VARCHAR(20) NOT NULL,
        capacity INTEGER NOT NULL,
        subject VARCHAR(150) NOT NULL,
        used_by TEXT[] DEFAULT '{}'::TEXT[]
      );

      CREATE TABLE IF NOT EXISTS circulars (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        category VARCHAR(50) NOT NULL,
        date VARCHAR(20) NOT NULL,
        author VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        subject VARCHAR(100) NOT NULL,
        course_code VARCHAR(50),
        due_date VARCHAR(20) NOT NULL,
        description TEXT,
        submissions JSONB DEFAULT '[]'::JSONB
      );

      CREATE TABLE IF NOT EXISTS study_materials (
        id VARCHAR(50) PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        subject VARCHAR(100) NOT NULL,
        type VARCHAR(50) NOT NULL,
        link VARCHAR(255) NOT NULL,
        uploaded_by VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leaves (
        id VARCHAR(50) PRIMARY KEY,
        student_username VARCHAR(50) NOT NULL,
        student_name VARCHAR(100) NOT NULL,
        subject VARCHAR(50),
        start_date VARCHAR(20) NOT NULL,
        end_date VARCHAR(20) NOT NULL,
        reason TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'Pending'
      );

      CREATE TABLE IF NOT EXISTS placements (
        id VARCHAR(50) PRIMARY KEY,
        company VARCHAR(150) NOT NULL,
        role VARCHAR(150) NOT NULL,
        package VARCHAR(50) NOT NULL,
        eligibility TEXT,
        deadline VARCHAR(20) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(50) PRIMARY KEY,
        sender VARCHAR(50) NOT NULL,
        receiver VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        timestamp VARCHAR(50) NOT NULL
      );
    `);

    // 2. Check if users database is empty
    const res = await client.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(res.rows[0].count);

    if (userCount === 0) {
      console.log('Database empty. Seeding default admin, teacher, and student users...');
      
      // Default Admin and Teacher
      await client.query(`
        INSERT INTO users (username, password, role, name, email, phone) 
        VALUES 
          ('admin', 'admin', 'admin', 'System Admin', 'admin@tolani.edu', '9876543210'),
          ('teacher', 'teacher', 'teacher', 'Prof. Ramesh Shah', 'teacher@tolani.edu', '9876543211')
      `);

      // Read & Eval students_data.js to seed Tolani students
      try {
        const studentFilePath = path.join(__dirname, '../students_data.js');
        if (fs.existsSync(studentFilePath)) {
          const content = fs.readFileSync(studentFilePath, 'utf8');
          const evalModule = {};
          eval(content + '\nevalModule.TOLANI_STUDENTS = TOLANI_STUDENTS;');
          
          if (Array.isArray(evalModule.TOLANI_STUDENTS)) {
            for (let s of evalModule.TOLANI_STUDENTS) {
              const username = s.rollNo.toString().trim();
              const password = s.spdid.toString().trim(); // Roll No = Username, SPDID = Password
              const enrolmentNo = s.enrolmentNo || "ENR" + s.spdid;
              const admAppNo = s.admAppNo || "APP" + s.spdid;
              
              await client.query(`
                INSERT INTO users (
                  username, password, role, name, email, phone, 
                  program, year, semester, class, division, 
                  roll_no, spdid, enrolment_no, adm_app_no, admission_year, 
                  attendance, fee_status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
              `, [
                username, password, 'student', s.name, s.email || '', s.phone || '',
                'B.Com (Professional)', '3rd Year', 'Semester 5', s.class || 'Division A', 'A',
                username, s.spdid, enrolmentNo, admAppNo, '2024',
                JSON.stringify({}), JSON.stringify({ total: 6200, paid: 0, due: 6200, status: 'unpaid' })
              ]);
            }
            console.log(`Seeded ${evalModule.TOLANI_STUDENTS.length} Tolani College students successfully.`);
          }
        }
      } catch (err) {
        console.error('Seeding student data failed:', err);
      }
    }
    isDbInitialized = true;
  } finally {
    client.release();
  }
}

// Middleware to ensure DB schema checks run first
app.use(async (req, res, next) => {
  try {
    await ensureDatabaseSchema();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database connection failed: ' + err.message });
  }
});

// --- AUTHENTICATION API ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }
  
  try {
    const query = 'SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)';
    const result = await pool.query(query, [username.trim()]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    
    const user = result.rows[0];
    
    // Support plaintext passwords for seeded users AND bcrypt hashes
    let isMatch = false;
    if (password === user.password) {
      isMatch = true;
    } else {
      try {
        isMatch = await bcrypt.compare(password, user.password);
      } catch (e) {
        isMatch = false;
      }
    }
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    
    const token = jwt.sign(
      { username: user.username, role: user.role },
      process.env.JWT_SECRET || 'tcc_portal_dev_token_secret_123',
      { expiresIn: '24h' }
    );
    
    res.json({ success: true, token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- USERS API ---
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY role DESC, name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  const u = req.body;
  try {
    // Encrypt password if new
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(u.password, salt);
    
    await pool.query(`
      INSERT INTO users (
        username, password, role, name, email, phone, 
        program, year, semester, class, division, 
        roll_no, spdid, enrolment_no, adm_app_no, admission_year, 
        attendance, fee_status, department, office, classes, subjects
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    `, [
      u.username, hashedPassword, u.role, u.name, u.email || '', u.phone || '',
      u.program || '', u.year || '', u.semester || '', u.class || '', u.division || '',
      u.rollNo || '', u.spdid || '', u.enrolmentNo || '', u.admAppNo || '', u.admissionYear || '',
      JSON.stringify(u.attendance || {}), JSON.stringify(u.feeStatus || {}),
      u.department || '', u.office || '', u.classes || [], u.subjects || []
    ]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:username', async (req, res) => {
  const username = req.params.username;
  const u = req.body;
  try {
    await pool.query(`
      UPDATE users SET 
        name = $1, email = $2, phone = $3, 
        program = $4, year = $5, semester = $6, class = $7, division = $8,
        roll_no = $9, spdid = $10, enrolment_no = $11, adm_app_no = $12,
        attendance = $13, fee_status = $14, grades = $15, 
        department = $16, office = $17, classes = $18, subjects = $19
      WHERE username = $20
    `, [
      u.name, u.email || '', u.phone || '',
      u.program || '', u.year || '', u.semester || '', u.class || '', u.division || '',
      u.rollNo || '', u.spdid || '', u.enrolmentNo || '', u.admAppNo || '',
      JSON.stringify(u.attendance || {}), JSON.stringify(u.feeStatus || {}), JSON.stringify(u.grades || []),
      u.department || '', u.office || '', u.classes || [], u.subjects || [],
      username
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE username = $1', [req.params.username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/delete-all', async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE role = 'student'");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/bulk-import', async (req, res) => {
  const students = req.body;
  if (!Array.isArray(students)) {
    return res.status(400).json({ error: 'Body must be an array.' });
  }
  try {
    for (let s of students) {
      await pool.query(`
        INSERT INTO users (
          username, password, role, name, email, phone, 
          program, year, semester, class, division, 
          roll_no, spdid, enrolment_no, adm_app_no, admission_year, 
          attendance, fee_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (username) DO NOTHING
      `, [
        s.username, s.password, 'student', s.name, s.email || '', s.phone || '',
        s.program, s.year, s.semester, s.class, s.division,
        s.rollNo, s.spdid, s.enrolmentNo, s.admAppNo, s.admissionYear,
        JSON.stringify(s.attendance || {}), JSON.stringify(s.feeStatus || {})
      ]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SUBJECTS API ---
app.get('/api/subjects', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subjects ORDER BY program ASC, year ASC, name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subjects', async (req, res) => {
  const sub = req.body;
  try {
    await pool.query(`
      INSERT INTO subjects (id, name, program, year, semester) 
      VALUES ($1, $2, $3, $4, $5)
    `, [sub.id, sub.name, sub.program, sub.year, sub.semester]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/subjects/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM subjects WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ATTENDANCE CODES API ---
app.get('/api/attendance-codes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM attendance_codes');
    res.json(result.rows.map(row => ({
      id: row.id,
      code: row.code,
      division: row.division,
      date: row.date,
      capacity: row.capacity,
      subject: row.subject,
      usedBy: row.used_by
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance-codes', async (req, res) => {
  const code = req.body;
  try {
    await pool.query(`
      INSERT INTO attendance_codes (id, code, division, date, capacity, subject, used_by) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [code.id, code.code, code.division, code.date, code.capacity, code.subject, code.usedBy || []]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/attendance-codes/:code', async (req, res) => {
  try {
    await pool.query('DELETE FROM attendance_codes WHERE code = $1', [req.params.code]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance-codes/delete-all', async (req, res) => {
  try {
    await pool.query('DELETE FROM attendance_codes');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CIRCULARS API ---
app.get('/api/circulars', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM circulars ORDER BY date DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/circulars', async (req, res) => {
  const c = req.body;
  try {
    await pool.query(`
      INSERT INTO circulars (id, title, content, category, date, author) 
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [c.id, c.title, c.content, c.category, c.date, c.author]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/circulars/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM circulars WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ASSIGNMENTS API ---
app.get('/api/assignments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM assignments');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assignments', async (req, res) => {
  const a = req.body;
  try {
    await pool.query(`
      INSERT INTO assignments (id, title, subject, course_code, due_date, description, submissions) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [a.id, a.title, a.subject, a.courseCode || '', a.dueDate, a.description || '', JSON.stringify(a.submissions || [])]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assignments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM assignments WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- STUDY MATERIALS API ---
app.get('/api/study-materials', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM study_materials');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/study-materials', async (req, res) => {
  const m = req.body;
  try {
    await pool.query(`
      INSERT INTO study_materials (id, title, subject, type, link, uploaded_by) 
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [m.id, m.title, m.subject, m.type, m.link, m.uploadedBy]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/study-materials/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM study_materials WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LEAVES API ---
app.get('/api/leaves', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM leaves');
    res.json(result.rows.map(row => ({
      id: row.id,
      studentUsername: row.student_username,
      studentName: row.student_name,
      subject: row.subject,
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
      status: row.status
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/leaves', async (req, res) => {
  const l = req.body;
  try {
    await pool.query(`
      INSERT INTO leaves (id, student_username, student_name, subject, start_date, end_date, reason, status) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [l.id, l.studentUsername, l.studentName, l.subject || '', l.startDate, l.endDate, l.reason, l.status || 'Pending']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/leaves/:id', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  try {
    await pool.query('UPDATE leaves SET status = $1 WHERE id = $2', [status, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PLACEMENTS API ---
app.get('/api/placements', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM placements');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/placements', async (req, res) => {
  const p = req.body;
  try {
    await pool.query(`
      INSERT INTO placements (id, company, role, package, eligibility, deadline) 
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [p.id, p.company, p.role, p.package, p.eligibility || '', p.deadline]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/placements/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM placements WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MESSAGES API ---
app.get('/api/messages', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM messages ORDER BY timestamp ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const m = req.body;
  try {
    await pool.query(`
      INSERT INTO messages (id, sender, receiver, text, timestamp) 
      VALUES ($1, $2, $3, $4, $5)
    `, [m.id, m.sender, m.receiver, m.text, m.timestamp]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- LIVE DATABASE QUERY TERMINAL API ---
app.post('/api/database/query', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is empty.' });
  
  // Basic query command validation for terminal safety (only allow SELECT, UPDATE, DELETE)
  const cmd = query.trim().split(/\s+/)[0].toUpperCase();
  if (!['SELECT', 'UPDATE', 'DELETE'].includes(cmd)) {
    return res.json({ error: `ERROR: unsupported Postgres command "${cmd}". Supported: SELECT, UPDATE, DELETE.` });
  }

  try {
    const result = await pool.query(query);
    res.json({ success: true, result });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Listen locally if run directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Backend server listening on port ${port}`));
}

module.exports = app;
