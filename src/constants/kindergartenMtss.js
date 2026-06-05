const KINDERGARTEN_SIGNAL_LEVELS = [
    { value: 'emerging', label: 'Emerging' },
    { value: 'developing', label: 'Developing' },
    { value: 'consistent', label: 'Consistent' }
];

const KINDERGARTEN_WEEKLY_FOCUS_OPTIONS = [
    { value: 'continue', label: 'Continue' },
    { value: 'try', label: 'Try' },
    { value: 'support_needed', label: 'Support Needed' }
];

const KINDERGARTEN_INTERVENTION_BANK = {
    emotional_regulation: {
        label: 'Emotional Regulation',
        strategies: [
            { id: 'first_then_board', title: 'First-Then Board', signals: ['emerging', 'developing'] },
            { id: 'cozy_corner', title: 'Cozy Corner Reset', signals: ['emerging', 'developing'] },
            { id: 'breathing_bubbles', title: 'Breathing Bubbles', signals: ['emerging', 'developing', 'consistent'] },
            { id: 'emotion_menu', title: 'Emotion Menu Cards', signals: ['developing', 'consistent'] }
        ]
    },
    language: {
        label: 'Language & Communication',
        strategies: [
            { id: 'visual_schedule', title: 'Visual Schedule Prompts', signals: ['emerging', 'developing'] },
            { id: 'two_step_cards', title: '2-Step Instruction Cards', signals: ['emerging', 'developing'] },
            { id: 'talk_draw_journal', title: 'Talk & Draw Journal', signals: ['developing', 'consistent'] },
            { id: 'peer_modeling', title: 'Peer Language Modeling', signals: ['developing', 'consistent'] }
        ]
    },
    social: {
        label: 'Social',
        strategies: [
            { id: 'social_script_cards', title: 'Social Script Cards', signals: ['emerging', 'developing'] },
            { id: 'buddy_system', title: 'Buddy System', signals: ['developing', 'consistent'] },
            { id: 'problem_solving_wheel', title: 'Problem-Solving Wheel', signals: ['developing', 'consistent'] },
            { id: 'circle_practice', title: 'Circle Practice Routine', signals: ['emerging', 'developing'] }
        ]
    },
    motor: {
        label: 'Motor Skills',
        strategies: [
            { id: 'finger_gym', title: 'Finger Gym Warm-Up', signals: ['emerging', 'developing'] },
            { id: 'adapted_tools', title: 'Adapted Tools (Chunky Crayons)', signals: ['emerging', 'developing'] },
            { id: 'movement_break', title: 'Movement Break', signals: ['developing', 'consistent'] },
            { id: 'sensory_station', title: 'Sensory Station Rotation', signals: ['emerging', 'developing', 'consistent'] }
        ]
    },
    independence: {
        label: 'Independence',
        strategies: [
            { id: 'picture_checklist', title: 'Picture Checklist', signals: ['emerging', 'developing'] },
            { id: 'transition_warning', title: 'Transition Warning (5/2 min)', signals: ['emerging', 'developing'] },
            { id: 'first_then_routine', title: 'First-Then Routine Cards', signals: ['emerging', 'developing'] },
            { id: 'independent_start_cue', title: 'Independent Start Cue', signals: ['developing', 'consistent'] }
        ]
    }
};

module.exports = {
    KINDERGARTEN_SIGNAL_LEVELS,
    KINDERGARTEN_WEEKLY_FOCUS_OPTIONS,
    KINDERGARTEN_INTERVENTION_BANK
};
