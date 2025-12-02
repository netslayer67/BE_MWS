const CLASS_ASSIGNMENTS = {
    "Abu Bakar Ali, S.Sos I": ["Grade 7 - Homeroom"],
    "Afiyanti Hardiansari": ["Kindergarten - Milky Way"],
    "Alifananda Dhaffa Hanif Musyafa, S.Pd": ["Grade 9 - Special Education"],
    "Almia Ester Kristiyany Sinabang, S.Pd": ["Grade 1 - Centaurus"],
    "Anggie Ayu Setya Pradini, S.Pd": ["Grade 8 - Special Education"],
    "Annisa Fitri Tanjung": ["Grade 4 - Pinwheel"],
    "Aria Wisnuwardana, S.TP": ["Junior High - Grades 7-9"],
    "Auliya Hasanatin Suwisto, S.IKom": ["Grade 2 - Fireworks"],
    "Ayunda Primaputri": ["Kindergarten - Bear Paw"],
    "Bela Kartika Sari": ["Grade 2 - Fireworks"],
    "Berliana Gustina Siregar": ["Grade 3 - Andromeda"],
    "Chantika Nur Febryanti": ["Elementary - Math & Integral"],
    "Devi Agriani, S.Pd.": ["Grade 6 - Perseus"],
    "Devi Larasati": ["Grade 2 - Fireworks"],
    "Dien Islami": ["Grade 3 - Andromeda"],
    "Dini Meilani Pramesti": ["Grade 2 - Skyrocket"],
    "Diya Pratiwi, S.S": ["Kindergarten - Milky Way"],
    "Fadholi Akbar": ["Grade 5 - Spindle"],
    "Ferlyna Balqis": ["Kindergarten - Starlight"],
    "Fransiska Evasari, S.Pd": ["Grade 4 - Topsy Turvy"],
    "Galen Rasendriya": ["Grade 3 - Sombrero"],
    "Gundah Basiswi, S.Pd": ["Grade 1 - Barnard"],
    "Hadi": ["Junior High - Performing Arts"],
    "Himawan Rizky Syaputra": ["Junior High - Coding"],
    "Iis Asifah": ["Grade 4 - Pinwheel"],
    "Ika Rahayu": ["Grade 3 - Andromeda"],
    "Kholida Widyawati, S.Sos, MA": ["Elementary - Grades 1-6"],
    "Krisalyssa Esna Rehulina Tarigan, S.K.Pm": ["Grade 1 - Barnard"],
    "Latifah Nur Restiningtyas, S.Pd": ["Kindergarten - PreK to K2"],
    "Maria Rosa Apriliana Jaftoran": ["Grade 2 - Skyrocket"],
    "Nadia": ["Grade 7 - English"],
    "Nanda Citra Ryani, S.IP": ["Kindergarten - Starlight"],
    "Nathasya Christine Prabowo, S.Si": ["Grade 4 - Pinwheel"],
    "Nazmi Kusumawantari": ["Grade 5 - Spindle"],
    "Nayandra Hasan Sudra": ["Junior High - Makerspace"],
    "Najmi Silmi Mafaza": ["Junior High - Math"],
    "Novan Syaiful Rahman": ["Grade 7 - Special Education"],
    "Novia Syifaputri Ramadhan": ["Grade 1 - Centaurus"],
    "Nurul Widyaningtyas Agustin": ["Kindergarten - Bear Paw"],
    "Pipiet Anggreiny, S.TP": ["Grade 6 - Perseus"],
    "Pricilla Cecil Leander, S.Pd": ["Grade 3 - Sombrero"],
    "Prisy Dewanti": ["Grade 4 - Topsy Turvy"],
    "Putri Fitriyani, S.Pd": ["Grade 3 - Andromeda"],
    "Raisa Ramadhani": ["Grade 3 - Sombrero"],
    "Restia Widiasari": ["Grade 2 - Skyrocket"],
    "Reza Rizky Prayudha": ["Grade 2 - Fireworks"],
    "Rifqi Satria Permana, S.Pd": ["Grade 8 - Physical Education"],
    "Rike Rahmawati S.Pd": ["Grade 4 - Topsy Turvy"],
    "Risma Ayu Angelita": ["Grade 4 - Pinwheel"],
    "Risma Galuh Pitaloka Fahdin": ["Grade 4 - Topsy Turvy"],
    "Rizki Nurul Hayati": ["Grade 8 - Science"],
    "Robby Noer Abjuny": ["Grade 5 - Spindle"],
    "Romasta Oryza Sativa Siagian, S.Pd": ["Grade 1 - Barnard"],
    "Salsabila Dhiyaussyifa Laela": ["Grade 3 - Sombrero"],
    "Tiastiningrum Nugrahanti, S.Pd": ["Grade 9 - Special Education"],
    "Tri Ayu Lestari": ["Grade 5 - Spindle"],
    "Tria Fadilla": ["Grade 2 - Skyrocket"],
    "Vicki Aprinando": ["Grade 9 - Homeroom"],
    "Vinka Erawati, S.Pd": ["Kindergarten - Special Education"],
    "Yohana Setia Risli": ["Kindergarten - Starlight"],
    "Yosafat Imanuel Parlindungan": ["Grade 7 - Music"],
    "Zavier Cloudya Mashareen": ["Grade 1 - Centaurus"],
    "Zolla Firmalia Rossa": ["Grade 9 - Art"]
};

const parseAssignmentLabel = (label = "", role = "") => {
    const cleaned = label.replace(/\s+/g, " ").trim();
    if (!cleaned) return null;
    let grade = cleaned;
    let className;

    if (cleaned.includes("-")) {
        const [left, right] = cleaned.split("-").map((chunk) => chunk.trim());
        grade = left || cleaned;
        className = right || undefined;
    } else if (/^kindy|^kindergarten/i.test(cleaned)) {
        grade = "Kindergarten";
        className = cleaned.replace(/^(kindy|kindergarten)/i, "").trim() || undefined;
    } else if (/^grade\s+\d+/i.test(cleaned)) {
        const match = cleaned.match(/^(Grade\s+\d+)(.*)$/i);
        grade = match[1].trim();
        className = match[2]?.trim() || undefined;
    } else if (/junior high/i.test(cleaned)) {
        grade = "Junior High";
        className = cleaned.replace(/junior high/i, "").trim() || undefined;
    } else if (/elementary/i.test(cleaned)) {
        grade = "Elementary";
        className = cleaned.replace(/elementary/i, "").trim() || undefined;
    }

    const normalizedRole = (role || "").toLowerCase();
    const derivedRole = normalizedRole.includes("principal")
        ? "Principal"
        : normalizedRole.includes("special education")
            ? "Special Education Teacher"
            : normalizedRole.includes("homeroom")
                ? "Homeroom Teacher"
                : "Subject Teacher";

    return {
        grade: grade.trim(),
        className: className || undefined,
        subject: className || grade.trim(),
        role: derivedRole
    };
};

module.exports = {
    CLASS_ASSIGNMENTS,
    parseAssignmentLabel
};
