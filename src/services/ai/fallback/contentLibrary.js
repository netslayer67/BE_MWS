const STORY_DEFAULT_ARC = {
    title: 'Steady Awareness',
    chapter: 'Noticing subtle shifts',
    narrative: 'You are tracking your inner climate with honesty, which creates space for calm adjustments.',
    arc: 'stabilizing',
    inflection: 'gentle',
    confidence: 78,
    colorTone: 'amber'
};

const STORY_ANCHORS = [
    { arc: 'ascending', tone: 'emerald', label: 'Momentum Rising' },
    { arc: 'stabilizing', tone: 'amber', label: 'Holding Ground' },
    { arc: 'softening', tone: 'rose', label: 'Gentle Recovery' },
    { arc: 'recharging', tone: 'indigo', label: 'Quiet Restoration' }
];

const DISPLAY_THEMES = [
    {
        name: 'aurora',
        gradientCss: 'linear-gradient(135deg, rgba(253, 242, 248, 0.9) 0%, rgba(224, 242, 254, 0.85) 47%, rgba(237, 233, 254, 0.9) 100%)',
        glassColor: 'rgba(255, 255, 255, 0.85)',
        borderColor: 'rgba(255, 255, 255, 0.35)',
        accent: '#f43f5e',
        mood: 'warming'
    },
    {
        name: 'lilac-dawn',
        gradientCss: 'linear-gradient(135deg, rgba(245, 243, 255, 0.92) 0%, rgba(224, 242, 254, 0.85) 55%, rgba(253, 242, 248, 0.88) 100%)',
        glassColor: 'rgba(250, 250, 255, 0.82)',
        borderColor: 'rgba(99, 102, 241, 0.35)',
        accent: '#6366f1',
        mood: 'balancing'
    },
    {
        name: 'serene-mint',
        gradientCss: 'linear-gradient(135deg, rgba(236, 252, 203, 0.9) 0%, rgba(224, 242, 254, 0.8) 42%, rgba(254, 249, 195, 0.85) 100%)',
        glassColor: 'rgba(255, 255, 255, 0.88)',
        borderColor: 'rgba(16, 185, 129, 0.3)',
        accent: '#10b981',
        mood: 'soothing'
    }
];

const INSIGHT_CHIP_EXTRAS = [
    { label: 'micro-rest ready', type: 'ritual' },
    { label: 'pattern tracking', type: 'trend' },
    { label: 'kindness quota', type: 'self-care' },
    { label: 'signal honest', type: 'reflection' }
];

const RECOMMENDED_RITUALS = [
    {
        name: 'Micro-Journaling Burst',
        duration: '6 minutes',
        description: 'Free-write three sentences: (1) What I am sensing in my body, (2) What my mind is repeating, (3) What I choose to believe right now.'
    },
    {
        name: 'Breath + Intention Ladder',
        duration: '5 minutes',
        description: 'Inhale hope, exhale tension. With each breath ladder, whisper a word you need (e.g., calm, clarity, courage).'
    },
    {
        name: 'Movement Reset',
        duration: '8 minutes',
        description: 'Gentle stretching while naming one thing you are releasing and one thing you are inviting with each movement.'
    },
    {
        name: 'Connection Ping',
        duration: '4 minutes',
        description: 'Send a short voice note or message to someone you trust. Share gratitude or a micro-update to stay anchored.'
    },
    {
        name: 'Focus Ritual',
        duration: '10 minutes',
        description: 'Break work into a "sprint + soothe" cycle: 8 minutes focused effort, followed by 2 minutes of grounding.'
    },
    {
        name: 'Sensory Reset Walk',
        duration: '7 minutes',
        description: 'Visit the nearest window or outdoor spot and identify five colors or textures. Let your breath follow what you notice.'
    },
    {
        name: 'Mindful Beverage Ceremony',
        duration: '5 minutes',
        description: 'Prepare tea, coffee, or water slowly. Notice aroma, warmth, and taste as a devotion to slowing your nervous system.'
    },
    {
        name: 'Gratitude Voice Memo',
        duration: '3 minutes',
        description: 'Record a brief memo thanking future-you for something you are doing today. Replay later when you need encouragement.'
    }
];

const MICRO_HABITS = [
    'Drink water mindfully while repeating a calming mantra.',
    'Write one sentence of appreciation about yourself on a sticky note.',
    'Step outside for 120 seconds and simply observe the horizon.',
    'Use a colored highlighter to mark moments of hope in your notes.',
    'Adopt a "one-tab" rule for 15 minutes to reduce cognitive load.',
    'Queue a song that matches your mood and breathe with the rhythm.',
    'Stretch your wrists and jaw every time you send three messages.',
    'Replace doom-scroll breaks with one photo from your happy album.',
    'Stack gratitude onto an existing habit-say thank you each time you wash your hands.'
];

const SUPPORT_RECOMMENDATION_BASE = [
    'Share a low-stakes update to maintain relational warmth.',
    'Ask specifically for listening, advice, or accountability to get the support you need.',
    'Consider scheduling a shared mindful moment-two minutes of silence together can be grounding.',
    'Send a "just thinking of you" note to remind both of you that connection is alive.',
    'Trade a playlist or podcast episode to spark conversation from a gentle place.'
];

const SELF_REFLECTION_PROMPTS = [
    'What is one gentle truth I am willing to acknowledge about today?',
    'Which emotion feels loudest, and what message might it be sending?',
    'Where in my body is my stress or hope sitting right now?',
    'What would "2% more ease" look like in the next hour?',
    'Who or what reminded me that I am not alone?',
    'If I could name today\'s chapter, what would it be called and why?',
    'When did I feel even a tiny spark of joy, curiosity, or relief today?',
    'What support would future-me thank me for requesting in this moment?'
];

const GROUNDING_PRACTICES = [
    'Box breathing (inhale 4, hold 4, exhale 4) for five cycles.',
    'Progressive muscle relaxation starting from your toes to your forehead.',
    'Name five things you can see, four you can touch, three you can hear, two you can smell, one you can taste.',
    'Hold a warm mug with both hands and focus on the sensation.',
    'Walk barefoot indoors for one minute to reconnect with the present.',
    'Trace the outline of your hand slowly while repeating an affirmation.',
    'Place one hand on your chest, one on your stomach, and hum softly to vibrate calm through your body.',
    'Rinse your wrists under cool water and imagine it carrying away static thoughts.'
];

const GRATITUDE_AFFIRMATIONS = [
    'I honor the part of me that keeps showing up.',
    'I am allowed to take up space with my emotions.',
    'Progress can be microscopic and still meaningful.',
    'Every breath is a quiet vote for my well-being.',
    'I can be both a work in progress and worthy of kindness.',
    'I nurture others by remembering to nurture myself.',
    'Even my pauses are purposeful.',
    'My feelings are information, not instructions.'
];

const ENERGY_FORECAST_TIPS = [
    'Honor micro-rests between tasks to preserve momentum.',
    'Alternate focused work with sensory breaks (sound, scent, or touch).',
    'Choose one task to simplify or delegate to create breathing space.',
    'Schedule a five-minute ritual to celebrate small completions.',
    'Invite natural light or music to nudge your nervous system toward calm activation.',
    'Pair hydration with two shoulder rolls to release static energy.',
    'Color-code your to-dos by effort so you can match energy to the right item.'
];

const COMPASSIONATE_CHECKPOINTS = [
    'Pause before lunch to acknowledge one thing you handled with courage.',
    'At 3 PM, ask yourself "What would make the rest of the day 10% kinder?"',
    'Before bedtime, write down a thought you are releasing.',
    'Send a quick appreciation message to someone who crossed your mind today.',
    'Celebrate one boundary you protected, even if tiny.',
    'Choose a mantra for the evening commute or wind-down ritual and repeat it three times.'
];

const BREATH_PATTERNS = [
    {
        name: '4-7-8 Flow',
        description: 'Inhale 4, hold 7, exhale 8. Repeat four cycles to soften the nervous system.'
    },
    {
        name: 'Tidal Breath',
        description: 'Breathe in through the nose, out through the mouth with a sigh; imagine a wave washing stress away.'
    },
    {
        name: 'Heart Coherence',
        description: 'Inhale 5 seconds imagining gratitude, exhale 5 seconds sending compassion inward.'
    },
    {
        name: 'Box Breath with Intention',
        description: 'On each side of the box, whisper a supportive word: inhale "calm", hold "safe", exhale "release", hold "renew".'
    },
    {
        name: 'Stair-Step Breath',
        description: 'Take two short inhales through the nose, one long exhale through the mouth to regulate alertness without overwhelm.'
    }
];

const NERVOUS_SYSTEM_SUPPORT_BASE = [
    {
        title: 'Temperature Reset',
        prompt: 'Splash cool water on your wrists or place a warm pack on your chest to remind your body it is safe.'
    },
    {
        title: 'Sensory Anchor',
        prompt: 'Choose a grounding object (stone, fabric, ring) and describe its texture aloud for 30 seconds.'
    },
    {
        title: 'Auditory Hug',
        prompt: 'Play a 60-second track of rainfall or white noise and match your breath to the sound.'
    },
    {
        title: 'Vagus Tap',
        prompt: 'Gently tap along your collarbone while breathing slowly to stimulate calm.'
    }
];

const FOCUS_ANCHORS = [
    'Set a 15-minute timer labeled "move one pebble" and work solely on a single micro-task.',
    'Write the next step on a sticky note and place it at eye level-physical cues cut through fog.',
    'Use the "read aloud" feature on a doc to convert visual fatigue into auditory focus.',
    'Swap to a standing or walking call for your next meeting to inject kinesthetic energy.',
    'Try the 3-2-1 method: name three priorities, two stretch goals, one thing you\'ll intentionally postpone.'
];

const REST_OPTIONS = {
    maintenance: [
        'Block a protected evening for playful downtime-no productivity allowed.',
        'Schedule a "lights down" reminder 30 minutes earlier tonight to signal calm.'
    ],
    repair: [
        'Try a 20-minute afternoon lie-down (eyes closed, no phone) to repay sleep debt.',
        'Eat something warm and grounding before bed (soup, tea, or warm milk).'
    ],
    rescue: [
        'Ask someone you trust to help with one obligation so you can sleep without guilt.',
        'If nights are restless, pencil in a 15-minute nap or meditation break tomorrow.'
    ]
};

module.exports = {
    STORY_DEFAULT_ARC,
    STORY_ANCHORS,
    DISPLAY_THEMES,
    INSIGHT_CHIP_EXTRAS,
    RECOMMENDED_RITUALS,
    MICRO_HABITS,
    SUPPORT_RECOMMENDATION_BASE,
    SELF_REFLECTION_PROMPTS,
    GROUNDING_PRACTICES,
    GRATITUDE_AFFIRMATIONS,
    ENERGY_FORECAST_TIPS,
    COMPASSIONATE_CHECKPOINTS,
    BREATH_PATTERNS,
    NERVOUS_SYSTEM_SUPPORT_BASE,
    FOCUS_ANCHORS,
    REST_OPTIONS
};
