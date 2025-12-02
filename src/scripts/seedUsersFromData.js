const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const { CLASS_ASSIGNMENTS, parseAssignmentLabel } = require('./data/classAssignments');
require('dotenv').config();

// Sample user data based on provided CSV (used as fallback if JSON seed file is missing)
const DEFAULT_USER_DATA = [
    {
        email: 'abdul.mansyur@millennia21.id',
        password: 'password123',
        name: 'Abdul Mansyur',
        username: 'Mansyur',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-10-09'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'abdullah@millennia21.id',
        password: 'password123',
        name: 'Abdullah, SE, MM',
        username: 'Abdul',
        role: 'staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Staff Resources',
        employmentStatus: 'Permanent',
        joinDate: new Date('2005-01-31'),
        gender: 'M'
    },
    {
        email: 'abu@millennia21.id',
        password: 'password123',
        name: 'Abu Bakar Ali, S.Sos I',
        username: 'Abu',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2002-06-03'),
        gender: 'M'
    },
    {
        email: 'adibah.hana@millennia21.id',
        password: 'password123',
        name: 'Adibah Hana Widjaya',
        username: 'Adibah',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Librarian',
        employmentStatus: 'Contract',
        joinDate: new Date('2025-02-07'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'adiya.herisa@millennia21.id',
        password: 'password123',
        name: 'Adiya Herisa',
        username: 'Adiya',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Perawat',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-09-04'),
        gender: 'F'
    },
    {
        email: 'afiyanti.hardiansari@millennia21.id',
        password: 'password123',
        name: 'Afiyanti Hardiansari',
        username: 'Afi',
        role: 'teacher',
        department: 'Kindergarten',
        jobLevel: 'Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2025-04-08'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'dodi@millennia21.id',
        password: 'password123',
        name: 'Ahmad Haikal',
        username: 'Dody',
        role: 'head_unit',
        department: 'Operational',
        jobLevel: 'Head Unit',
        unit: 'Operational',
        jobPosition: 'Head of Operational',
        employmentStatus: 'Permanent',
        joinDate: new Date('2017-11-14'),
        gender: 'M'
    },
    {
        email: 'dhaffa@millennia21.id',
        password: 'password123',
        name: 'Alifananda Dhaffa Hanif Musyafa, S.Pd',
        username: 'Dhaffa',
        role: 'se_teacher',
        department: 'Junior High',
        jobLevel: 'SE Teacher',
        unit: 'Junior High',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2023-12-23'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'almia@millennia21.id',
        password: 'password123',
        name: 'Almia Ester Kristiyany Sinabang, S.Pd',
        username: 'Almia',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2021-06-28'),
        gender: 'F'
    },
    {
        email: 'anggie@millennia21.id',
        password: 'password123',
        name: 'Anggie Ayu Setya Pradini, S.Pd',
        username: 'Anggie',
        role: 'se_teacher',
        department: 'Junior High',
        jobLevel: 'SE Teacher',
        unit: 'Junior High',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-07-17'),
        gender: 'F'
    },
    {
        email: 'annisa.fitri@millennia21.id',
        password: 'password123',
        name: 'Annisa Fitri Tanjung',
        username: 'Ardi',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'ardiansyah@millennia21.id',
        password: 'password123',
        name: 'Ardiansyah',
        username: 'Ardi',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'PLH',
        employmentStatus: 'Permanent',
        joinDate: new Date('2018-03-01'),
        gender: 'M'
    },
    {
        email: 'aria@millennia21.id',
        password: 'password123',
        name: 'Aria Wisnuwardana, S.TP',
        username: 'Aria',
        role: 'head_unit',
        department: 'Junior High',
        jobLevel: 'Head Unit',
        unit: 'Junior High',
        jobPosition: 'Principal of Junior High',
        employmentStatus: 'Permanent',
        joinDate: new Date('2006-03-27'),
        gender: 'M'
    },
    {
        email: 'alinsuwisto@millennia21.id',
        password: 'password123',
        name: 'Auliya Hasanatin Suwisto, S.IKom',
        username: 'Alin',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-10-24'),
        gender: 'F'
    },
    {
        email: 'aprimaputri@millennia21.id',
        password: 'password123',
        name: 'Ayunda Primaputri',
        username: 'Ayunda',
        role: 'teacher',
        department: 'Kindergarten',
        jobLevel: 'Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'wina@millennia21.id',
        password: 'password123',
        name: 'Azalia Magdalena Septianti Tambunan',
        username: 'Wina',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: "School's Psychologist",
        employmentStatus: 'Contract',
        joinDate: new Date('2025-02-03'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'belakartika@millennia21.id',
        password: 'password123',
        name: 'Bela Kartika Sari',
        username: 'Bela',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'nana@millennia21.id',
        password: 'password123',
        name: 'Berliana Gustina Siregar',
        username: 'Nana',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2025-04-08'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'derry@millennia21.id',
        password: 'password123',
        name: 'Derry Parmanto, S.S',
        username: 'Derry',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Staff Admin',
        employmentStatus: 'Permanent',
        joinDate: new Date('2018-11-15'),
        gender: 'M'
    },
    {
        email: 'devi.agriani@millennia21.id',
        password: 'password123',
        name: 'Devi Agriani, S.Pd.',
        username: 'Devi',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'devilarasati@millennia21.id',
        password: 'password123',
        name: 'Devi Larasati',
        username: 'Laras',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'dien@millennia21.id',
        password: 'password123',
        name: 'Dien Islami',
        username: 'Dien',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'dina@millennia21.id',
        password: 'password123',
        name: 'Dina',
        username: 'Dina',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Girl',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-05-25'),
        gender: 'F'
    },
    {
        email: 'dinimeilani@millennia21.id',
        password: 'password123',
        name: 'Dini Meilani Pramesti',
        username: 'Dini',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'diya@millennia21.id',
        password: 'password123',
        name: 'Diya Pratiwi, S.S',
        username: 'Diya',
        role: 'teacher',
        department: 'Kindergarten',
        jobLevel: 'Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2021-04-01'),
        gender: 'F'
    },
    {
        email: 'dona@millennia21.id',
        password: 'password123',
        name: 'Dona',
        username: 'Dona',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Girl',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-07-26'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'akbarfadholi98@millennia21.id',
        password: 'password123',
        name: 'Fadholi Akbar',
        username: 'Fadholi',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'fasa@millennia21.id',
        password: 'password123',
        name: 'Faqiha Salma Achmada S.Psi.',
        username: 'Fasa',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2025-04-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'aya@millennia21.id',
        password: 'password123',
        name: 'Farhah Alya Nabilah',
        username: 'Aya',
        role: 'staff',
        department: 'Kindergarten',
        jobLevel: 'Staff',
        unit: 'Kindergarten',
        jobPosition: 'Secretary',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-18'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'jo@millennia21.id',
        password: 'password123',
        name: 'Fayza Julia Pramesti Hapsari Prayoga',
        username: 'Jo',
        role: 'staff',
        department: 'Pelangi',
        jobLevel: 'Staff',
        unit: 'Pelangi',
        jobPosition: 'Admin Pelangi / Secretary',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-08-15'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'ferlyna.balqis@millennia21.id',
        password: 'password123',
        name: 'Ferlyna Balqis',
        username: 'Balqis',
        role: 'se_teacher',
        department: 'Kindergarten',
        jobLevel: 'SE Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2025-04-08'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'fransiskaeva@millennia21.id',
        password: 'password123',
        name: 'Fransiska Evasari, S.Pd',
        username: 'Eva',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2021-06-28'),
        gender: 'F'
    },
    {
        email: 'galen@millennia21.id',
        password: 'password123',
        name: 'Galen Rasendriya',
        username: 'Galen',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-28'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'gundah@millennia21.id',
        password: 'password123',
        name: 'Gundah Basiswi, S.Pd',
        username: 'Gundah',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-07-17'),
        gender: 'F'
    },
    {
        email: 'hadi@millennia21.id',
        password: 'password123',
        name: 'Hadi',
        username: 'Hadi',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Performing Art Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'hana.fajria@millennia21.id',
        password: 'password123',
        name: 'Hana Nuzula Fajria, S.Pd',
        username: 'Hana',
        role: 'head_unit',
        department: 'Pelangi',
        jobLevel: 'Head Unit',
        unit: 'Pelangi',
        jobPosition: 'Head of Pelangi',
        employmentStatus: 'Permanent',
        joinDate: new Date('2019-09-02'),
        gender: 'F'
    },
    {
        email: 'himawan@millennia21.id',
        password: 'password123',
        name: 'Himawan Rizky Syaputra',
        username: 'Himawan',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Coding Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'iis@millennia21.id',
        password: 'password123',
        name: 'Iis Asifah',
        username: 'Iis',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'ikarahayu@millennia21.id',
        password: 'password123',
        name: 'Ika Rahayu',
        username: 'Ika',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'irawan@millennia21.id',
        password: 'password123',
        name: 'Irawan',
        username: 'Iwan',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Driver',
        employmentStatus: 'Permanent',
        joinDate: new Date('2017-03-02'),
        gender: 'M'
    },
    {
        email: 'khairul@millennia21.id',
        password: 'password123',
        name: 'Khairul Anwar',
        username: 'Irul',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Permanent',
        joinDate: new Date('2019-06-17'),
        gender: 'M'
    },
    {
        email: 'kholida@millennia21.id',
        password: 'password123',
        name: 'Kholida Widyawati, S.Sos, MA',
        username: 'Kholi',
        role: 'head_unit',
        department: 'Elementary',
        jobLevel: 'Head Unit',
        unit: 'Elementary',
        jobPosition: 'Principal of Elementary',
        employmentStatus: 'Permanent',
        joinDate: new Date('2019-02-25'),
        gender: 'F'
    },
    {
        email: 'alys@millennia21.id',
        password: 'password123',
        name: 'Krisalyssa Esna Rehulina Tarigan, S.K.Pm',
        username: 'Alys',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2023-07-17'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'sandi@millennia21.id',
        password: 'password123',
        name: 'Kurnia Sandi',
        username: 'Sandi',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Permanent',
        joinDate: new Date('2018-09-24'),
        gender: 'M'
    },
    {
        email: 'latifah@millennia21.id',
        password: 'password123',
        name: 'Latifah Nur Restiningtyas, S.Pd',
        username: 'Latifah',
        role: 'head_unit',
        department: 'Kindergarten',
        jobLevel: 'Head Unit',
        unit: 'Kindergarten',
        jobPosition: 'Principal of Kindergarten',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-07-18'),
        gender: 'F'
    },
    {
        email: 'mahrukh@millennia21.id',
        password: 'password123',
        name: 'Mahrukh Bashir',
        username: 'Ms. Mahrukh',
        role: 'directorate',
        department: 'Directorate',
        jobLevel: 'Director',
        unit: 'Directorate',
        jobPosition: 'Academic Director',
        employmentStatus: 'Permanent',
        joinDate: new Date('2009-10-01'),
        gender: 'F'
    },
    {
        email: 'maria@millennia21.id',
        password: 'password123',
        name: 'Maria Rosa Apriliana Jaftoran',
        username: 'Maria',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-07-18'),
        gender: 'F'
    },
    {
        email: 'maulida.yunita@millennia21.id',
        password: 'password123',
        name: 'Maulida Yunita',
        username: 'Nita',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Librarian',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-08-25'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'muhammad.farhan@millennia21.id',
        password: 'password123',
        name: 'Muhammad Farhan Sholeh Ramadhika',
        username: 'Farhan',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Design & Social Media',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-08-25'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'fathan.qalbi@millennia21.id',
        password: 'password123',
        name: 'Muhammad Fathan Qorib',
        username: 'Fathan',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-02-23'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'awal@millennia21.id',
        password: 'password123',
        name: 'Muhammad Gibran Al Wali',
        username: 'Awal / Gibran',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'PLH',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-18'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'ananta@millennia21.id',
        password: 'password123',
        name: 'Muhammad Rayhan Ananta',
        username: 'Ananta',
        role: 'support_staff',
        department: 'MAD Lab',
        jobLevel: 'Support Staff',
        unit: 'MAD Lab',
        jobPosition: 'IT Support',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'mukron@millennia21.id',
        password: 'password123',
        name: 'Mukron',
        username: 'Mukron',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'PLH',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-08-28'),
        gender: 'M'
    },
    {
        email: 'nadiamws@millennia21.id',
        password: 'password123',
        name: 'Nadia',
        username: 'Nadia',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'English Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-11-18'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'nanda@millennia21.id',
        password: 'password123',
        name: 'Nanda Citra Ryani, S.IP',
        username: 'Nanda',
        role: 'teacher',
        department: 'Kindergarten',
        jobLevel: 'Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2019-04-01'),
        gender: 'F'
    },
    {
        email: 'nathasya@millennia21.id',
        password: 'password123',
        name: 'Nathasya Christine Prabowo, S.Si',
        username: 'Thasya',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2023-07-17'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'kusumawantari@millennia21.id',
        password: 'password123',
        name: 'Nazmi Kusumawantari',
        username: 'Mima',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-11-06'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'made@millennia21.id',
        password: 'password123',
        name: 'Ni Made Ayu Juwitasari',
        username: 'Made',
        role: 'staff',
        department: 'Elementary',
        jobLevel: 'Staff',
        unit: 'Elementary',
        jobPosition: 'Secretary',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-07-29'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'nopi@millennia21.id',
        password: 'password123',
        name: 'Nopi Puji Astuti',
        username: 'Nopi',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Girl',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-10-30'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'novan@millennia21.id',
        password: 'password123',
        name: 'Novan Syaiful Rahman',
        username: 'Novan',
        role: 'se_teacher',
        department: 'Junior High',
        jobLevel: 'SE Teacher',
        unit: 'Junior High',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'novi@millennia21.id',
        password: 'password123',
        name: 'Novia Anggraeni',
        username: 'Novi',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Staff Research & Development',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-08-15'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'novia@millennia21.id',
        password: 'password123',
        name: 'Novia Syifaputri Ramadhan',
        username: 'Novia',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-08-11'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'ismail@millennia21.id',
        password: 'password123',
        name: 'Nur Muhamad Ismail',
        username: 'Ismail',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Staff HCM',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-08'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'widya@millennia21.id',
        password: 'password123',
        name: 'Nurul Widyaningtyas Agustin',
        username: 'Widya',
        role: 'teacher',
        department: 'Kindergarten',
        jobLevel: 'Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-09-03'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'pipiet@millennia21.id',
        password: 'password123',
        name: 'Pipiet Anggreiny, S.TP',
        username: 'Pipiet',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-07-17'),
        gender: 'F'
    },
    {
        email: 'cecil@millennia21.id',
        password: 'password123',
        name: 'Pricilla Cecil Leander, S.Pd',
        username: 'Cecil',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-08-21'),
        gender: 'F'
    },
    {
        email: 'prisy@millennia21.id',
        password: 'password123',
        name: 'Prisy Dewanti',
        username: 'Prisy',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'putri.fitriyani@millennia21.id',
        password: 'password123',
        name: 'Putri Fitriyani, S.Pd',
        username: 'Putri',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-07-18'),
        gender: 'F'
    },
    {
        email: 'raisa@millennia21.id',
        password: 'password123',
        name: 'Raisa Ramadhani',
        username: 'Raisa',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-14'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'ratna@millennia21.id',
        password: 'password123',
        name: 'Ratna Merlangen',
        username: 'Ratna',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Director Secretary',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-03-06'),
        gender: 'F'
    },
    {
        email: 'restia.widiasari@millennia21.id',
        password: 'password123',
        name: 'Restia Widiasari',
        username: 'Echi',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-09-02'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'rezarizky@millennia21.id',
        password: 'password123',
        name: 'Reza Rizky Prayudha',
        username: 'Reza',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-07-15'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'rifqi.satria@millennia21.id',
        password: 'password123',
        name: 'Rifqi Satria Permana, S.Pd',
        username: 'Rifqi',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Physical Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-10-07'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'rike@millennia21.id',
        password: 'password123',
        name: 'Rike Rahmawati S.Pd',
        username: 'Rike',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-01-23'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'risma.angelita@millennia21.id',
        password: 'password123',
        name: 'Risma Ayu Angelita',
        username: 'Risma',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'risma.galuh@millennia21.id',
        password: 'password123',
        name: 'Risma Galuh Pitaloka Fahdin',
        username: 'Galuh',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-08-11'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'rizkinurul@millennia21.id',
        password: 'password123',
        name: 'Rizki Nurul Hayati',
        username: 'Kiki',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Science Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-09-04'),
        gender: 'F'
    },
    {
        email: 'robby@millennia21.id',
        password: 'password123',
        name: 'Robby Anggara',
        username: 'Robby',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-19'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'robby.noer@millennia21.id',
        password: 'password123',
        name: 'Robby Noer Abjuny',
        username: 'Robby',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-08'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'robiatul@millennia21.id',
        password: 'password123',
        name: 'Robiatul Adawiah',
        username: 'Lia',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Girl',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-07-10'),
        gender: 'F'
    },
    {
        email: 'rohmatulloh@millennia21.id',
        password: 'password123',
        name: 'Rohmatulloh',
        username: 'Roy',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-04-03'),
        gender: 'M'
    },
    {
        email: 'roma@millennia21.id',
        password: 'password123',
        name: 'Romasta Oryza Sativa Siagian, S.Pd',
        username: 'Tata',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-07-18'),
        gender: 'F'
    },
    {
        email: 'salsabiladhiyaussyifa@millennia21.id',
        password: 'password123',
        name: 'Salsabila Dhiyaussyifa Laela',
        username: 'Sabil',
        role: 'se_teacher',
        department: 'Elementary',
        jobLevel: 'SE Teacher',
        unit: 'Elementary',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'sarahyuliana@millennia21.id',
        password: 'password123',
        name: 'Sarah Yuliana, SE',
        username: 'Sarah',
        role: 'head_unit',
        department: 'Finance',
        jobLevel: 'Head Unit',
        unit: 'Finance',
        jobPosition: 'Head of Finance',
        employmentStatus: 'Permanent',
        joinDate: new Date('2020-06-24'),
        gender: 'F'
    },
    {
        email: 'rain@millennia21.id',
        password: 'password123',
        name: 'Shahrani Fatimah Azzahrah',
        username: 'Rain',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Staff HCM',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-09-02'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'susantika@millennia21.id',
        password: 'password123',
        name: 'Susantika Nilasari',
        username: 'Nila',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Staff CRM',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-11-01'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'tiastiningrum@millennia21.id',
        password: 'password123',
        name: 'Tiastiningrum Nugrahanti, S.Pd',
        username: 'Tyas',
        role: 'se_teacher',
        department: 'Junior High',
        jobLevel: 'SE Teacher',
        unit: 'Junior High',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-08-21'),
        gender: 'F'
    },
    {
        email: 'hanny@millennia21.id',
        password: 'password123',
        name: 'Tien Hadiningsih, S.S',
        username: 'Hanny',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Staff CRM',
        employmentStatus: 'Permanent',
        joinDate: new Date('2015-07-27'),
        gender: 'F'
    },
    {
        email: 'triayulestari@millennia21.id',
        password: 'password123',
        name: 'Tri Ayu Lestari',
        username: 'Ayu',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-07-15'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'triafadilla@millennia21.id',
        password: 'password123',
        name: 'Tria Fadilla',
        username: 'Tria',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-06-24'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'udom@millennia21.id',
        password: 'password123',
        name: 'Udom Anatapong',
        username: 'Udom',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Driver',
        employmentStatus: 'Permanent',
        joinDate: new Date('2017-09-06'),
        gender: 'M'
    },
    {
        email: 'usep@millennia21.id',
        password: 'password123',
        name: 'Usep Saefurohman',
        username: 'Usep',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Driver',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-07-17'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'vickiaprinando@millennia21.id',
        password: 'password123',
        name: 'Vicki Aprinando',
        username: 'Nando',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-08-02'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'vinka@millennia21.id',
        password: 'password123',
        name: 'Vinka Erawati, S.Pd',
        username: 'Vinka',
        role: 'se_teacher',
        department: 'Kindergarten',
        jobLevel: 'SE Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Special Education Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2019-07-09'),
        gender: 'F'
    },
    {
        email: 'yohana@millennia21.id',
        password: 'password123',
        name: 'Yohana Setia Risli',
        username: 'Yoh/Yohana',
        role: 'teacher',
        department: 'Kindergarten',
        jobLevel: 'Teacher',
        unit: 'Kindergarten',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2023-02-20'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'yosafat@millennia21.id',
        password: 'password123',
        name: 'Yosafat Imanuel Parlindungan',
        username: 'Yosa',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Music Teacher',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-01-23'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'oudy@millennia21.id',
        password: 'password123',
        name: 'Zavier Cloudya Mashareen',
        username: 'Oudy',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Homeroom Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2022-10-17'),
        gender: 'F'
    },
    {
        email: 'zolla@millennia21.id',
        password: 'password123',
        name: 'Zolla Firmalia Rossa',
        username: 'Zolla',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Art Teacher',
        employmentStatus: 'Permanent',
        joinDate: new Date('2023-05-02'),
        gender: 'F'
    },
    {
        email: 'yeti@millennia21.id',
        password: 'password123',
        name: 'Yeti',
        username: 'Yeti',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Girl',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-18'),
        endDate: new Date('2025-12-22'),
        gender: 'F'
    },
    {
        email: 'danu@millennia21.id',
        password: 'password123',
        name: 'Danu Irwansyah',
        username: 'Danu',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Driver',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-22'),
        endDate: new Date('2025-12-22'),
        gender: 'M'
    },
    {
        email: 'ari.wibowo@millennia21.id',
        password: 'password123',
        name: 'Ari Wibowo',
        username: 'Ari',
        role: 'staff',
        department: 'MAD Lab',
        jobLevel: 'Staff',
        unit: 'MAD Lab',
        jobPosition: 'Junior Full Stack Web Developer',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-25'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'kiki@millennia21.id',
        password: 'password123',
        name: 'Rizki Amalia Fatikhah',
        username: 'Kiki',
        role: 'staff',
        department: 'Directorate',
        jobLevel: 'Staff',
        unit: 'Directorate',
        jobPosition: 'Training Development',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-08'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'ian.ahmad@millennia21.id',
        password: 'password123',
        name: 'Ian Ahmad Fauzi',
        username: 'Ian',
        role: 'staff',
        department: 'Finance',
        jobLevel: 'Staff',
        unit: 'Finance',
        jobPosition: 'Staff Finance',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-08'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'andre@millennia21.id',
        password: 'password123',
        name: 'Andrean Hadinata',
        username: 'Andre',
        role: 'staff',
        department: 'Junior High',
        jobLevel: 'Staff',
        unit: 'Junior High',
        jobPosition: 'Secretary',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-01'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },
    {
        email: 'chaca@millennia21.id',
        password: 'password123',
        name: 'Chantika Nur Febryanti',
        username: 'Chaca',
        role: 'teacher',
        department: 'Elementary',
        jobLevel: 'Teacher',
        unit: 'Elementary',
        jobPosition: 'Integral & Math Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-09-29'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'sisil@millennia21.id',
        password: 'password123',
        name: 'Najmi Silmi Mafaza',
        username: 'Sisil',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Math Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-20'),
        endDate: new Date('2026-06-22'),
        gender: 'F'
    },
    {
        email: 'nayandra@millennia21.id',
        password: 'password123',
        name: 'Nayandra Hasan Sudra',
        username: 'Hasan',
        role: 'teacher',
        department: 'Junior High',
        jobLevel: 'Teacher',
        unit: 'Junior High',
        jobPosition: 'Makerspace Teacher',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-01'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },

    // Tambahan 6 user paling akhir dari tabel (yang tidak ada di array awal):
    {
        email: 'radit@millennia21.id',
        password: 'password123',
        name: 'Raditya Saputra',
        username: 'Radit',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-20'),
        endDate: new Date('2026-01-20'),
        gender: 'M'
    },
    {
        email: 'wahyu@millennia21.id',
        password: 'password123',
        name: 'Wahyu Ramadhan',
        username: 'Wahyu',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'PLH',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-20'),
        endDate: new Date('2026-01-20'),
        gender: 'M'
    },
    {
        email: 'denis@millennia21.id',
        password: 'password123',
        name: 'Denis Septian',
        username: 'Denis',
        role: 'support_staff',
        department: 'Operational',
        jobLevel: 'Support Staff',
        unit: 'Operational',
        jobPosition: 'Office Boy',
        employmentStatus: 'Probation',
        joinDate: new Date('2025-10-24'),
        endDate: new Date('2026-03-22'),
        gender: 'M'
    },
    {
        email: 'faisal@millennia21.id',
        password: 'password123',
        name: 'Faisal Nur Hidayat',
        username: 'Faisal',
        role: 'head_unit',
        department: 'MAD Lab',
        jobLevel: 'Head Unit',
        unit: 'MAD Lab',
        jobPosition: 'Head of IT',
        employmentStatus: 'Contract',
        joinDate: new Date('2024-07-15'),
        endDate: new Date('2026-06-22'),
        gender: 'M'
    },

];

const DEFAULT_USER_SEED_FILE = process.env.SEED_USERS_FILE || path.resolve(__dirname, '../../../test.users.json');

const convertExtendedJsonValue = (input) => {
    if (Array.isArray(input)) {
        return input.map(convertExtendedJsonValue);
    }

    if (input && typeof input === 'object') {
        if (Object.prototype.hasOwnProperty.call(input, '$oid')) {
            return new mongoose.Types.ObjectId(input.$oid);
        }

        if (Object.prototype.hasOwnProperty.call(input, '$date')) {
            return new Date(input.$date);
        }

        return Object.entries(input).reduce((acc, [key, value]) => {
            acc[key] = convertExtendedJsonValue(value);
            return acc;
        }, {});
    }

    return input;
};

const normalizeUserDocument = (doc = {}) => {
    const normalized = convertExtendedJsonValue(doc);

    if (normalized.gender === 'M') normalized.gender = 'male';
    if (normalized.gender === 'F') normalized.gender = 'female';

    if (Array.isArray(normalized.classes) && normalized.classes.length === 0) {
        delete normalized.classes;
    }

    return normalized;
};

const loadUsersFromSeedFile = () => {
    const filePath = DEFAULT_USER_SEED_FILE;

    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: Seed file not found at ${filePath}. Falling back to inline dataset.`);
        return [];
    }

    try {
        const fileContents = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(fileContents);

        if (!Array.isArray(parsed)) {
            console.warn(`Warning: Seed file ${filePath} does not contain an array. Falling back to inline dataset.`);
            return [];
        }

        return parsed.map(normalizeUserDocument);
    } catch (error) {
        console.warn(`Warning: Unable to parse ${filePath}. Falling back to inline dataset.`, error.message);
        return [];
    }
};

const loadedFileUsers = loadUsersFromSeedFile();
const USING_EXTERNAL_SEED_DATA = loadedFileUsers.length > 0;
const userData = USING_EXTERNAL_SEED_DATA ? loadedFileUsers : DEFAULT_USER_DATA;
const SEED_SOURCE_LABEL = USING_EXTERNAL_SEED_DATA ? DEFAULT_USER_SEED_FILE : 'inline fallback dataset';

// Fallback grade mapping to auto-attach classes to teachers/principals based on provided roster info.
const TEACHER_GRADE_MAP = {
    // Junior High homerooms / specialists
    'abu bakar ali, s.sos i': ['Grade 7'],
    'yosa': ['Grade 7'],
    'nadia': ['Grade 7'],
    'novan syaiful rahman': ['Grade 7'],
    'rifqi satria permana, s.pd': ['Grade 8'],
    'rizki nurul hayati': ['Grade 8'],
    'anggie ayu setya pradini, s.pd': ['Grade 8'],
    'alifananda dhaffa hanif musyafa, s.pd': ['Grade 9'],
    'tiastiningrum nugrahanti, s.pd': ['Grade 9'],
    'vicki aprinando': ['Grade 9'],
    'zolla firmalia rossa': ['Grade 9'],
    'hasan': ['Grade 7', 'Grade 8', 'Grade 9'],
    'hadi': ['Grade 7', 'Grade 8', 'Grade 9'],
    'himawan': ['Grade 7', 'Grade 8', 'Grade 9'],
    'aria wisnuwardana, s.tp': ['Grade 7', 'Grade 8', 'Grade 9'],

    // Elementary homerooms & SE teachers
    'gundah basiswi, s.pd': ['Grade 1'],
    'krisalyssa esna rehulina tarigan, s.k.pm': ['Grade 1'],
    'almia ester kristiyany sinabang, s.pd': ['Grade 1'],
    'romasta oryza sativa siagian, s.pd': ['Grade 1'],
    'zavier cloudya mashareen': ['Grade 1'],
    'novia syifaputri ramadhan': ['Grade 1'],

    'auliya hasanatin suwisto, s.ikom': ['Grade 2'],
    'bela kartika sari': ['Grade 2'],
    'maria rosa apriliana jaftoran': ['Grade 2'],
    'tria fadilla': ['Grade 2'],
    'devi larasati': ['Grade 2'],
    'dini meilani pramesti': ['Grade 2'],
    'restia widiasari': ['Grade 2'],
    'reza rizky prayudha': ['Grade 2'],

    'berliana gustina siregar': ['Grade 3'],
    'raisa ramadhani': ['Grade 3'],
    'pricilla cecil leander, s.pd': ['Grade 3'],
    'putri fitriyani, s.pd': ['Grade 3'],
    'galen rasendriya': ['Grade 3'],
    'salsabila dhiyaussyifa laela': ['Grade 3'],
    'dien islami': ['Grade 3'],
    'ika rahayu': ['Grade 3'],

    'fransiska evasari, s.pd': ['Grade 4'],
    'nathasya christine prabowo, s.si': ['Grade 4'],
    'rike rahmawati s.pd': ['Grade 4'],
    'prisy dewanti': ['Grade 4'],
    'risma ayu angelita': ['Grade 4'],
    'risma galuh pitaloka fahdin': ['Grade 4'],
    'annisa fitri tanjung': ['Grade 4'],
    'iis asifah': ['Grade 4'],

    'tri ayu lestari': ['Grade 5'],
    'robby noer abjuny': ['Grade 5'],
    'nazmi kusumawantari': ['Grade 5'],
    'fadholi akbar': ['Grade 5'],

    'devi agriani, s.pd.': ['Grade 6'],
    'pipiet anggreiny, s.tp': ['Grade 6'],

    // Kindergarten homerooms / SE
    'afiyanti hardiansari': ['Kindergarten K1'],
    'ayunda primaputri': ['Kindergarten K1'],
    'diya pratiwi, s.s': ['Kindergarten K1'],
    'nanda citra ryani, s.ip': ['Kindergarten K1'],
    'nurul widyaningtyas agustin': ['Kindergarten K1'],
    'yohana setia risli': ['Kindergarten K1'],
    'ferlyna balqis': ['Kindergarten K1'],
    'vinka erawati, s.pd': ['Kindergarten K1'],

    // Principals by unit
    'kholida widyawati, s.sos, ma': ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6'],
    'latifah nur restiningtyas, s.pd': ['Kindergarten Pre-K', 'Kindergarten K1', 'Kindergarten K2'],
};

const deriveClassRole = (roleLabel = '', fallbackLabel = '') => {
    const source = (roleLabel || fallbackLabel || '').toLowerCase();

    if (source.includes('principal')) return 'Principal';
    if (source.includes('special education') || source.includes('se teacher')) return 'Special Education Teacher';
    if (source.includes('homeroom')) return 'Homeroom Teacher';

    return 'Subject Teacher';
};

const buildClasses = (user) => {
    if (!['teacher', 'se_teacher', 'head_unit'].includes(user.role)) return undefined;
    const key = (user.name || user.username || '').toLowerCase();
    const grades = TEACHER_GRADE_MAP[key];
    if (!grades || !grades.length) return undefined;
    const classRole = deriveClassRole(user.jobPosition, user.jobLevel);
    return grades.map((grade) => ({ grade, role: classRole }));
};

const HASHED_PASSWORD_REGEX = /^\$2[aby]\$/i;

const ensureHashedPassword = async (password) => {
    if (!password) return undefined;
    if (HASHED_PASSWORD_REGEX.test(password)) {
        return password;
    }
    return bcrypt.hash(password, 12);
};

const normalizeGenderValue = (value) => {
    if (!value) return 'other';
    const normalized = value.toString().toLowerCase();
    if (normalized === 'm' || normalized === 'male') return 'male';
    if (normalized === 'f' || normalized === 'female') return 'female';
    return normalized;
};

const calculateWorkingPeriod = (joinDate, referenceDate = new Date()) => {
    if (!joinDate) return undefined;
    const start = new Date(joinDate);
    const end = new Date(referenceDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;

    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();

    if (days < 0) {
        months -= 1;
        const lastMonth = new Date(end.getFullYear(), end.getMonth(), 0);
        days += lastMonth.getDate();
    }

    if (months < 0) {
        years -= 1;
        months += 12;
    }

    return {
        years: Math.max(years, 0),
        months: Math.max(months, 0),
        days: Math.max(days, 0)
    };
};

const toObjectId = (value) => {
    if (!value) return undefined;
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (typeof value === 'string' && value.trim()) {
        return new mongoose.Types.ObjectId(value.trim());
    }
    if (typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '$oid')) {
        return new mongoose.Types.ObjectId(value.$oid);
    }
    return value;
};

const prepareUserDocument = async (userDataItem) => {
    const sanitized = { ...userDataItem };

    sanitized._id = toObjectId(sanitized._id) || new mongoose.Types.ObjectId();
    sanitized.reportsTo = toObjectId(sanitized.reportsTo);

    if (Array.isArray(sanitized.subordinates) && sanitized.subordinates.length) {
        sanitized.subordinates = sanitized.subordinates
            .map((subordinate) => toObjectId(subordinate))
            .filter(Boolean);
    } else {
        sanitized.subordinates = sanitized.subordinates || [];
    }

    if (sanitized.email) {
        sanitized.email = sanitized.email.toLowerCase();
    }
    if (!sanitized.username && sanitized.email) {
        sanitized.username = sanitized.email.split('@')[0];
    }

    const existingClasses = Array.isArray(sanitized.classes) && sanitized.classes.length ? sanitized.classes : undefined;
    const derivedClasses = existingClasses || buildClasses(sanitized);
    if (derivedClasses && derivedClasses.length) {
        sanitized.classes = derivedClasses.map((assignment) => ({
            ...assignment,
            role: deriveClassRole(assignment.role, sanitized.jobPosition)
        }));
    } else {
        delete sanitized.classes;
    }

    sanitized.gender = normalizeGenderValue(sanitized.gender);

    if (!sanitized.workingPeriod && sanitized.joinDate) {
        sanitized.workingPeriod = calculateWorkingPeriod(sanitized.joinDate);
    }

    sanitized.isActive = typeof sanitized.isActive === 'boolean' ? sanitized.isActive : true;
    sanitized.emailVerified = typeof sanitized.emailVerified === 'boolean' ? sanitized.emailVerified : true;

    sanitized.password = await ensureHashedPassword(sanitized.password || 'password123');

    const now = new Date();
    sanitized.createdAt = sanitized.createdAt || now;
    sanitized.updatedAt = sanitized.updatedAt || now;

    delete sanitized.__v;

    return sanitized;
};

// Attach class info from CLASS_ASSIGNMENTS; fallback to TEACHER_GRADE_MAP when needed
userData.forEach((entry) => {
    const assignments = CLASS_ASSIGNMENTS[entry.name];
    if (assignments && assignments.length) {
        const parsed = assignments
            .map((label) => parseAssignmentLabel(label, entry.jobPosition))
            .filter(Boolean);
        if (parsed.length) {
            entry.classes = parsed;
            return;
        }
    }
    // Fallback: build classes from grade map if not already set
    const built = buildClasses(entry);
    if (built) {
        entry.classes = built;
    }
});

const seedUsersFromData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Seeding users from provided data...');
        console.log('Seed source: ' + SEED_SOURCE_LABEL);

        await User.deleteMany({});
        console.log('Cleared existing users');

        const usersToInsert = [];

        for (const userDataItem of userData) {
            const preparedUser = await prepareUserDocument(userDataItem);
            usersToInsert.push(preparedUser);
            console.log('Prepared user: ' + preparedUser.email + ' (' + preparedUser.role + ')');
        }

        if (usersToInsert.length) {
            await User.insertMany(usersToInsert, { ordered: true });
        }

        console.log('User seeding completed successfully!');
        console.log('Total users created: ' + usersToInsert.length);

        const directorateUsers = await User.find({ role: 'directorate' });
        console.log('Directorate members:', directorateUsers.map((u) => u.name));
    } catch (error) {
        console.error('Error seeding users:', error);
    } finally {
        await mongoose.connection.close();
        console.log('Database connection closed');
    }
};

// Run seeder if called directly
if (require.main === module) {
    seedUsersFromData();
}

module.exports = seedUsersFromData;


