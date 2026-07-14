-- PostgreSQL Database Schema for College Portal
-- Replaces client-side localStorage structures

-- 1. Users Table (Admin, Teacher, Student roles)
CREATE TABLE users (
    username VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(30),
    
    -- Student Specific Columns
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
    
    -- Dynamic JSON structures matching app.js StateManager keys
    attendance JSONB DEFAULT '{}'::JSONB,
    fee_status JSONB DEFAULT '{}'::JSONB,
    grades JSONB DEFAULT '[]'::JSONB,
    
    -- Teacher Specific Details
    department VARCHAR(100),
    office VARCHAR(100),
    classes TEXT[], -- e.g. ['CS-A', 'CS-B']
    subjects TEXT[], -- e.g. ['Statistics', 'Business Management']
    schedule JSONB DEFAULT '[]'::JSONB
);

-- 2. Subjects Table
CREATE TABLE subjects (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    program VARCHAR(50) NOT NULL,
    year VARCHAR(20) NOT NULL,
    semester VARCHAR(20) NOT NULL,
    CONSTRAINT uq_subject_record UNIQUE (name, program, year, semester)
);

-- 3. Attendance Codes (Active Generation Logs)
CREATE TABLE attendance_codes (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(10) NOT NULL,
    division VARCHAR(50) NOT NULL,
    date VARCHAR(20) NOT NULL,
    capacity INTEGER NOT NULL,
    subject VARCHAR(150) NOT NULL,
    used_by TEXT[] DEFAULT '{}'::TEXT[]
);

-- 4. Circulars / Notifications
CREATE TABLE circulars (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(50) NOT NULL,
    date VARCHAR(20) NOT NULL,
    author VARCHAR(100) NOT NULL
);

-- 5. Assignments Table
CREATE TABLE assignments (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    course_code VARCHAR(50),
    due_date VARCHAR(20) NOT NULL,
    description TEXT,
    submissions JSONB DEFAULT '[]'::JSONB
);

-- 6. Study Materials
CREATE TABLE study_materials (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    subject VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    link VARCHAR(255) NOT NULL,
    uploaded_by VARCHAR(100) NOT NULL
);

-- 7. Leaves
CREATE TABLE leaves (
    id VARCHAR(50) PRIMARY KEY,
    student_username VARCHAR(50) REFERENCES users(username) ON DELETE CASCADE,
    student_name VARCHAR(100) NOT NULL,
    subject VARCHAR(50),
    start_date VARCHAR(20) NOT NULL,
    end_date VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending'
);

-- 8. Placements Table
CREATE TABLE placements (
    id VARCHAR(50) PRIMARY KEY,
    company VARCHAR(150) NOT NULL,
    role VARCHAR(150) NOT NULL,
    package VARCHAR(50) NOT NULL,
    eligibility TEXT,
    deadline VARCHAR(20) NOT NULL
);

-- 9. Messages Table
CREATE TABLE messages (
    id VARCHAR(50) PRIMARY KEY,
    sender VARCHAR(50) NOT NULL,
    receiver VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    timestamp VARCHAR(50) NOT NULL
);

-- Create performance indexes for lookup operations
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_subjects_sem ON subjects (program, year, semester);
CREATE INDEX idx_messages_chat ON messages (sender, receiver);
