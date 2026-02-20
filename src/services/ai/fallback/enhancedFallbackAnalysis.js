function enhancedFallbackAnalysis(checkinData, startTime = Date.now()) {
    console.log('Using enhanced fallback analysis for check-in data');

    const presenceLevel = checkinData.presenceLevel;
    const capacityLevel = checkinData.capacityLevel;
    const weatherType = checkinData.weatherType;
    const moods = checkinData.selectedMoods || [];
    const details = checkinData.details || '';
    const supportContact = checkinData.supportContact || '';

    // Add randomization and personalization elements
    const randomSeed = Date.now() % 100; // Simple randomization based on timestamp
    const userSpecificElement = (presenceLevel + capacityLevel + randomSeed) % 5; // 0-4 variation

    // Ultra-motivational messages with gratitude and empowerment - NOW PERSONALIZED!
    const getMotivationalMessage = () => {
        const positiveMoods = ['happy', 'excited', 'calm', 'hopeful'];
        const challengingMoods = ['sad', 'anxious', 'angry', 'tired', 'lonely', 'bored', 'overwhelmed', 'scattered'];

        const hasPositiveMoods = moods.some(mood => positiveMoods.includes(mood));
        const hasChallengingMoods = moods.some(mood => challengingMoods.includes(mood));

        // Create personalized variations based on user input
        const personalElements = [];

        // Add details-based personalization with more variety
        if (details.toLowerCase().includes('meeting') || details.toLowerCase().includes('productive')) {
            personalElements.push("Your dedication to meaningful work is truly inspiring!");
            personalElements.push("What a productive session you've had - that's real accomplishment!");
            personalElements.push("Your focus and productivity are absolutely commendable!");
        }
        if (details.toLowerCase().includes('great') || details.toLowerCase().includes('good')) {
            personalElements.push("That positive mindset of yours is a gift to everyone around you!");
            personalElements.push("Your optimistic outlook is truly refreshing!");
            personalElements.push("What a beautiful positive energy you're bringing today!");
        }
        if (details.toLowerCase().includes('tired') || details.toLowerCase().includes('exhausted')) {
            personalElements.push("It's so brave of you to acknowledge when you need rest!");
            personalElements.push("Your wisdom in recognizing fatigue shows real self-awareness!");
            personalElements.push("Taking care of yourself when tired is true strength!");
        }
        if (details.toLowerCase().includes('stress') || details.toLowerCase().includes('overwhelmed')) {
            personalElements.push("Facing stress head-on takes incredible courage!");
            personalElements.push("Your resilience in challenging times is remarkable!");
            personalElements.push("You're handling this with such grace and wisdom!");
        }
        if (supportContact) {
            personalElements.push(`Having ${supportContact} in your corner shows such wisdom in building your support network!`);
            personalElements.push(`Choosing ${supportContact} as your support shows you value meaningful connections!`);
            personalElements.push(`${supportContact} must be so grateful to be part of your support system!`);
        }

        // Add level-based personalization
        if (presenceLevel >= 8) {
            personalElements.push("Your strong presence is like a lighthouse guiding others!");
        }
        if (capacityLevel >= 8) {
            personalElements.push("Your high capacity for handling life's demands is remarkable!");
        }

        const personalMessage = personalElements.length > 0
            ? ` ${personalElements[userSpecificElement % personalElements.length]} `
            : '';

        // Ultra-motivational messages with gratitude and empowerment - NOW WITH VARIATIONS
        const messageVariations = {
            sunny_positive: [
                `?? WOW! Your radiant energy is absolutely contagious!${personalMessage} Right now, take a moment to feel grateful for this beautiful state of being.You're not just happy - you're a walking blessing who makes the world brighter just by being yourself.Keep shining, superstar! ?`,
                `?? Your sunny disposition is like a beacon of pure joy!${personalMessage} Feel the gratitude for this incredible energy you bring to every moment.You're not just feeling good - you're SPREADING goodness everywhere you go! What a beautiful gift you are! ??`,
                `?? BRILLIANT! Your positive energy is absolutely magnetic!${personalMessage} Take a deep breath and feel grateful for this wonderful state.You're not just happy - you're a source of light and warmth for everyone around you! Keep radiating that beautiful energy! ??`
            ],
            steady_positive: [
                `?? That calm confidence you're carrying is such a gift!${personalMessage} Appreciate how grounded and steady you feel right now—this balance is something you've cultivated with care.`,
                `?? Your steady glow is inspiring!${personalMessage} Take pride in this quiet strength; you're showing that consistency can feel just as powerful as fireworks.`,
                `?? What a beautifully composed energy you bring today!${personalMessage} Savor this steady momentum—it proves how aligned your mind and heart are right now.`
            ],
            rainbow_positive: [
                `?? Oh my goodness, what a spectacular rainbow of joy you're radiating!${personalMessage} Each color in your emotional spectrum is a testament to your incredible resilience and depth. Feel the gratitude for this moment of beauty - YOU created this! You're absolutely magnificent! ??`,
                `?? What a stunning display of emotional beauty you're showing!${personalMessage} Your rainbow of feelings represents such depth and wisdom. Feel grateful for this colorful journey - you're painting the world with your unique light! What a masterpiece you are! ??`,
                `?? INCREDIBLE! Your emotional rainbow is absolutely breathtaking!${personalMessage} Each hue tells a story of your strength and growth.Feel the gratitude for this beautiful spectrum - you're not just experiencing emotions, you're creating art with them! ???`
            ],
            challenging: [
                `?? Listen to me: You are STRONGER than any storm that rages around you!${personalMessage} This tough moment ? It's just weather passing through. Feel deep gratitude for your courage in facing it head-on. You're building unbreakable strength, and I am so incredibly proud of you! You've overcome harder things before, and you'll triumph again! ??`,
                `?? You possess an inner strength that's absolutely remarkable!${personalMessage} These challenging feelings? They're temporary clouds in your sky.Feel grateful for your resilience - you're not just surviving, you're growing stronger with every breath! What a warrior you are! ??`,
                `?? Your courage in facing these emotions is truly heroic!${personalMessage} Remember that every storm eventually passes, and you're building character that will serve you beautifully. Feel the gratitude for your bravery - you're stronger than you know! ????`
            ],
            tired_overwhelmed: [
                `?? Sweet friend, your body and spirit are whispering 'rest' - and that's wisdom speaking!${personalMessage} Feel immense gratitude for all you've accomplished today.You're not weak for needing rest; you're wise for honoring your limits.Tomorrow brings fresh strength, and you're absolutely capable of amazing things! ???`,
                `?? Your wisdom in recognizing when to rest is absolutely beautiful!${personalMessage} Feel grateful for everything you've achieved - it's okay to pause and recharge. You're not stopping, you're strategically refueling for even greater accomplishments! What smart self-care! ??`,
                `?? How wise you are to listen to your body's signals!${personalMessage} Feel deep gratitude for your accomplishments today. Rest isn't weakness - it's your superpower for sustainable strength. You're absolutely capable of amazing things tomorrow! ????`
            ],
            lonely_sad: [
                `?? Oh precious heart, your feelings are so valid, and you're so incredibly loved!${personalMessage} Take a moment to feel grateful for the connections in your life, even the quiet ones. You're never truly alone - your spirit touches so many lives. Keep reaching out; you're worthy of deep, beautiful connections! ??`,
                `?? Your heart is so precious and worthy of all the love in the world!${personalMessage} Feel grateful for the quiet strength within you. Even in stillness, you're connected to something much larger. You're not alone - you're deeply loved and cherished! ????`,
                `?? What a beautiful, sensitive heart you have!${personalMessage} Feel the gratitude for your capacity to feel deeply. Your emotions connect you to the human experience in meaningful ways. You're worthy of love, support, and beautiful connections! ????`
            ],
            creative_charge: [
                `?? That creative spark of yours is electric!${personalMessage} Honor the ideas flowing through you—they're evidence of your brave, imaginative spirit.`,
                `?? Your imagination is wide awake today!${personalMessage} Lean into that momentum; you're crafting something uniquely yours and that's thrilling.`,
                `?? What a brilliant creative pulse you're feeling!${personalMessage} Capture even the smallest idea—it could be the seed of something extraordinary.`
            ],
            default: [
                `? Every single emotion you experience is a precious part of your beautiful journey!${personalMessage} Feel deep gratitude for your courage in checking in with yourself. You're not just existing - you're consciously growing, healing, and becoming more authentically YOU. That's absolutely magical! ??`,
                `? Thank you for honoring your inner world today.${personalMessage} Your willingness to notice and name your feelings is transforming you from the inside out.`,
                `? What a courageous heart you have.${personalMessage} Showing up for yourself like this is proof that you are committed to living with intention and grace.`,
                `? Your emotional honesty is breathtaking.${personalMessage} Keep listening inward—this kind of awareness becomes a compass for an aligned, meaningful life.`
            ]
        };


        // Select message based on conditions with randomization
        let messageKey = 'default';
        if (weatherType === 'sunny' && hasPositiveMoods) messageKey = 'sunny_positive';
        else if (weatherType === 'rainbow' && hasPositiveMoods) messageKey = 'rainbow_positive';
        else if (hasPositiveMoods) messageKey = 'steady_positive';
        else if (hasChallengingMoods && capacityLevel <= 5) messageKey = 'challenging';
        else if (moods.includes('tired') || moods.includes('overwhelmed')) messageKey = 'tired_overwhelmed';
        else if (moods.includes('lonely') || moods.includes('sad')) messageKey = 'lonely_sad';
        else if (moods.includes('creative') || moods.includes('curious')) messageKey = 'creative_charge';

        const variations = messageVariations[messageKey] || messageVariations.default || [
            `✨ Every single emotion you experience is a precious part of your beautiful journey!${personalMessage} Feel deep gratitude for your courage in checking in with yourself. You're not just existing - you're consciously growing, healing, and becoming more authentically YOU. That's absolutely magical! 🌸`
        ];

        return variations[userSpecificElement % variations.length];
    };

    const getPsychologicalInsights = () => {
        if (presenceLevel >= 8 && capacityLevel >= 8) {
            return "🌟 ABSOLUTELY SPECTACULAR! You're demonstrating extraordinary emotional intelligence and resilience! Your ability to maintain such high presence and capacity amidst life's challenges shows you have an inner strength that's truly remarkable. You're not just coping - you're absolutely THRIVING and inspiring others to do the same! What an incredible role model you are! 💫";
        } else if (presenceLevel >= 6 && capacityLevel >= 6) {
            return "🎯 You're showing such beautiful balance and wisdom in how you navigate your emotional world! This conscious choice to check in with yourself regularly demonstrates profound self-awareness and self-compassion. You're building emotional intelligence that will serve you magnificently throughout your life. Keep nurturing this beautiful practice! 🌸";
        } else if (presenceLevel <= 4 || capacityLevel <= 4) {
            return "💝 Oh brave and beautiful soul, it's incredibly courageous of you to acknowledge these challenging feelings. This awareness itself is a tremendous sign of strength, not weakness! Remember that every emotion is valid, and reaching out for support is the wisest, most compassionate choice you can make. You're worthy of all the love and support in the world! 🤗";
        } else {
            return "✨ Your commitment to emotional wellness through these regular check-ins is absolutely transformative! Every step you take toward understanding and honoring your emotions builds greater emotional intelligence, resilience, and self-compassion. You're investing in yourself in the most beautiful way possible. What a gift you're giving to your future self! 🎁";
        }
    };

    const getRecommendations = () => {
        const recommendations = [];

        if (capacityLevel <= 6) {
            recommendations.push({
                title: "Practice Self-Compassion",
                description: "Be gentle with yourself today. Remember that you're doing your best, and that's enough. Treat yourself with the same kindness you'd offer a dear friend.",
                priority: "high",
                category: "self-care"
            });
        }

        if (presenceLevel <= 6) {
            recommendations.push({
                title: "Grounding Exercise",
                description: "Try the 5-4-3-2-1 technique: Name 5 things you can see, 4 you can touch, 3 you can hear, 2 you can smell, and 1 you can taste. This brings you back to the present moment.",
                priority: "high",
                category: "mindfulness"
            });
        }

        if (moods.includes('tired') || moods.includes('overwhelmed')) {
            recommendations.push({
                title: "Energy Reset",
                description: "Take three deep breaths, then list three things you're grateful for right now. Gratitude has the power to instantly shift your energy and perspective.",
                priority: "medium",
                category: "mindfulness"
            });
        }

        // Add more recommendations to reach 4
        if (moods.includes('anxious') || moods.includes('stressed')) {
            recommendations.push({
                title: "Breathing Break",
                description: "Try the 4-7-8 breathing technique: Inhale for 4 seconds, hold for 7 seconds, exhale for 8 seconds. This helps calm your nervous system and reduce anxiety.",
                priority: "high",
                category: "mindfulness"
            });
        }

        if (moods.includes('sad') || moods.includes('lonely')) {
            recommendations.push({
                title: "Connection Practice",
                description: "Reach out to someone you trust, even for a brief conversation. Human connection is a powerful antidote to feelings of isolation.",
                priority: "medium",
                category: "social"
            });
        }

        if (recommendations.length === 0) {
            recommendations.push({
                title: "Celebrate Your Awareness",
                description: "Give yourself credit for taking time to check in with your emotions. This self-awareness is a superpower that will serve you throughout your life.",
                priority: "medium",
                category: "self-care"
            });
        }

        return recommendations.slice(0, 4); // Limit to 4 recommendations
    };

    return {
        emotionalState: presenceLevel >= 7 && capacityLevel >= 7 ? 'positive' :
            presenceLevel <= 4 || capacityLevel <= 4 ? 'challenging' : 'balanced',
        presenceState: presenceLevel >= 7 ? 'high' : presenceLevel >= 4 ? 'moderate' : 'low',
        capacityState: capacityLevel >= 7 ? 'high' : capacityLevel >= 4 ? 'moderate' : 'low',
        recommendations: [], // Empty recommendations - only AI should provide these
        psychologicalInsights: getPsychologicalInsights(),
        motivationalMessage: getMotivationalMessage(),
        needsSupport: capacityLevel <= 4 || presenceLevel <= 4,
        confidence: 100, // Maximum confidence for ultra-motivational fallback
        processingTime: Date.now() - startTime,
        isAIRecommendations: false, // Indicate these are not AI-generated
        aiUnavailable: true // Flag that AI service was unavailable
    };
}

module.exports = enhancedFallbackAnalysis;
