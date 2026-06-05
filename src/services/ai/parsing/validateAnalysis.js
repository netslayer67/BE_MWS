function validateAnalysis(analysis, checkinData = {}) {
    // Ensure required fields exist, add defaults for missing ones
    const requiredFields = ['emotionalState', 'presenceState', 'capacityState', 'recommendations', 'psychologicalInsights', 'needsSupport'];

    for (const field of requiredFields) {
        if (!(field in analysis)) {
            throw new Error(`Missing required field: ${field} `);
        }
    }

    // Add default motivationalMessage if missing
    if (!analysis.motivationalMessage) {
        analysis.motivationalMessage = "You are capable of amazing things! Keep believing in yourself and your journey.";
    }

    // Validate enums
    const validEmotionalStates = ['positive', 'challenging', 'balanced', 'depleted'];
    const validPresenceStates = ['high', 'moderate', 'low'];
    const validCapacityStates = ['high', 'moderate', 'low'];

    if (!validEmotionalStates.includes(analysis.emotionalState)) {
        analysis.emotionalState = 'balanced';
    }
    if (!validPresenceStates.includes(analysis.presenceState)) {
        analysis.presenceState = 'moderate';
    }
    if (!validCapacityStates.includes(analysis.capacityState)) {
        analysis.capacityState = 'moderate';
    }

    // Ensure recommendations is an array
    if (!Array.isArray(analysis.recommendations)) {
        analysis.recommendations = [];
    }

    // Normalize existing recs and trim to avoid bloat
    analysis.recommendations = analysis.recommendations
        .filter(r => r && r.title && r.description)
        .slice(0, 4);

    // Ensure a minimum of 4 personalized recommendations
    const isStudent = checkinData?.userRole === 'student';

    const basePool = isStudent
        ? [
            {
                title: '2-Minute Breathing Reset',
                description: 'Breathe in for 4 counts, breathe out for 6 counts, and repeat 5 times.',
                priority: 'medium',
                category: 'mindfulness'
            },
            {
                title: 'Water + Stretch Break',
                description: 'Take a short break, drink water, and stretch your shoulders for one minute.',
                priority: 'medium',
                category: 'self-care'
            },
            {
                title: 'One Small School Task',
                description: 'Pick one easy task (5-10 minutes) and finish it to build momentum.',
                priority: 'low',
                category: 'school'
            },
            {
                title: 'Talk to a Trusted Adult',
                description: 'Tell your homeroom teacher, SE teacher, principal, or school psychologist how you feel.',
                priority: 'high',
                category: 'connection'
            },
            {
                title: 'Feelings Journal',
                description: 'Write 2-3 sentences: “What I feel”, “Why I feel it”, and “What can help now”.',
                priority: 'low',
                category: 'reflection'
            },
            {
                title: '3 Good Things',
                description: 'Write 3 good things from today, even small ones, to support a calm mindset.',
                priority: 'low',
                category: 'mindset'
            }
        ]
        : [
            {
                title: 'Grounding Breath',
                description: 'Take 3–5 deep breaths. Inhale for 4s, exhale for 6s to settle your nervous system.',
                priority: 'medium',
                category: 'mindfulness'
            },
            {
                title: 'Micro Break',
                description: 'Step away for 3 minutes. Stretch shoulders and neck, hydrate, and reset your posture.',
                priority: 'medium',
                category: 'recovery'
            },
            {
                title: 'Focused One‑Task',
                description: 'Choose one small task and complete it end‑to‑end to regain focus and momentum.',
                priority: 'low',
                category: 'focus'
            },
            {
                title: 'Support Check‑in',
                description: 'Message a trusted colleague or supervisor to share how you are and what support would help.',
                priority: 'high',
                category: 'support'
            },
            {
                title: 'Reflective Journal',
                description: 'Write 3 lines about what you’re feeling and 1 helpful next step you can take today.',
                priority: 'low',
                category: 'reflection'
            },
            {
                title: 'Gratitude Scan',
                description: 'List 2 small things you appreciate right now to broaden perspective and ease tension.',
                priority: 'low',
                category: 'mindset'
            }
        ];

    const titles = new Set(analysis.recommendations.map(r => String(r.title).toLowerCase()));

    // Bias selection based on states
    const wantSupport = !!analysis.needsSupport;
    const presenceLow = analysis.presenceState === 'low';
    const capacityLow = analysis.capacityState === 'low';
    const emotionalChallenging = analysis.emotionalState === 'challenging' || analysis.emotionalState === 'depleted';

    const prioritized = [];
    if (wantSupport) prioritized.push(isStudent ? 'Talk to a Trusted Adult' : 'Support Check‑in');
    if (presenceLow) prioritized.push('Grounding Breath', 'Focused One‑Task');
    if (capacityLow) prioritized.push('Micro Break');
    if (emotionalChallenging) prioritized.push('Reflective Journal');

    const poolByTitle = Object.fromEntries(basePool.map(r => [r.title, r]));

    for (const t of prioritized) {
        if (analysis.recommendations.length >= 4) break;
        if (t && poolByTitle[t] && !titles.has(t.toLowerCase())) {
            analysis.recommendations.push(poolByTitle[t]);
            titles.add(t.toLowerCase());
        }
    }

    // Fill remaining slots from pool, preserving diversity
    for (const rec of basePool) {
        if (analysis.recommendations.length >= 4) break;
        if (!titles.has(rec.title.toLowerCase())) {
            analysis.recommendations.push(rec);
            titles.add(rec.title.toLowerCase());
        }
    }

    // Numeric-first sanity check for needsSupport.
    //
    // Hard data (presenceLevel + capacityLevel + the user's own words) is more
    // trustworthy than the AI's secondary mood labels, which can contradict the
    // numbers (e.g. AI emits emotionalState: "neutral" while the user rated 9/9
    // on both axes). The previous override required ALL five conditions to align
    // before it would correct a false-positive flag, so a single off-label was
    // enough to let needsSupport=true leak through. The rules below replace that
    // with deterministic, numeric-first thresholds plus an explicit-distress
    // text safety net for the mid-range.
    const presence = Number(checkinData?.presenceLevel);
    const capacity = Number(checkinData?.capacityLevel);
    const hasPresence = Number.isFinite(presence);
    const hasCapacity = Number.isFinite(capacity);

    // 1. Hard floor — both scores are healthy → never flag.
    if (hasPresence && hasCapacity && presence >= 7 && capacity >= 7) {
        analysis.needsSupport = false;
    }
    // 2. Hard ceiling — either score is in the warning band → always flag.
    else if ((hasPresence && presence <= 4) || (hasCapacity && capacity <= 4)) {
        analysis.needsSupport = true;
    }
    // 3. Mid range (5-6 on both) — defer to the AI flag, but never miss
    //    an explicit cry for help in the user's own words.
    else {
        const detailsText = [
            checkinData?.details,
            checkinData?.aiSummary,
            ...(Array.isArray(checkinData?.selectedMoods) ? checkinData.selectedMoods : [])
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

        const explicitDistressKeywords =
            /\b(crisis|burn(?:ed|ing)?\s*out|exhaust(?:ed|ion)?|overwhelm(?:ed|ing)?|panic|hopeless|suicid|self[-\s]?harm|can(?:'t|not)\s+cope|breaking\s*down|need\s+help|harm(?:ing|ed)?\s+myself)\b/;

        if (explicitDistressKeywords.test(detailsText)) {
            analysis.needsSupport = true;
        } else {
            // Coerce whatever the AI returned to a clean boolean so downstream
            // consumers never see truthy strings or null.
            analysis.needsSupport = Boolean(analysis.needsSupport);
        }
    }

    // Ensure confidence is a number
    analysis.confidence = typeof analysis.confidence === 'number'
        ? Math.min(100, Math.max(0, analysis.confidence))
        : 75;

    return analysis;
}

module.exports = validateAnalysis;
