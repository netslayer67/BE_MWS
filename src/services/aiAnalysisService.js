const googleAI = require('../config/googleAI');

class AIAnalysisService {
    async analyzeEmotionalCheckin(checkinData) {
        const startTime = Date.now();

        try {
            const prompt = this.buildPsychologyPrompt(checkinData);
            console.log('🤖 Sending to AI:', prompt.substring(0, 200) + '...');
            const aiResponse = await googleAI.generateContent(prompt);
            console.log('🤖 AI Response received');
            const analysis = this.parseAIResponse(aiResponse, checkinData);

            console.log('✅ AI Analysis successful');
            return {
                ...analysis,
                processingTime: Date.now() - startTime
            };
        } catch (error) {
            console.error('❌ AI Analysis failed:', error.message);
            console.log('🔄 Using enhanced fallback analysis');
            return this.enhancedFallbackAnalysis(checkinData, startTime);
        }
    }

    buildPsychologyPrompt(data) {
        const moodText = data.selectedMoods.length > 0
            ? data.selectedMoods.join(', ')
            : 'No specific moods selected';

        // Resolve support contact details if user ID is provided
        let supportContactText = 'None specified';
        if (data.supportContactUserId) {
            // This would be resolved asynchronously in the controller
            // For now, we'll use a placeholder that AI can understand
            supportContactText = 'A specific staff member has been selected for support';
        }

        return `You are a seasoned psychologist and certified life coach specializing in emotional well-being within educational settings. Your expertise is sought to analyze an emotional check-in submitted by an educational staff member, aiming to provide nuanced, supportive, and empowering feedback.

Please structure your response to include the following elements:

- Emotional Assessment: Identify and interpret key emotional themes, stressors, and strengths evident in the check-in.

- Empathetic Validation: Offer compassionate acknowledgment of their feelings and experiences, fostering a sense of understanding and psychological safety.

- Motivational Guidance: Suggest practical strategies and mindset shifts that promote resilience, self-efficacy, and sustained motivation in their professional role.

- Actionable Recommendations: Propose specific, achievable steps or resources that support emotional regulation, work-life balance, and personal growth.

- Encouragement of Reflection: Invite the staff member to engage in ongoing self-reflection and self-care practices to maintain emotional well-being.

Leverage your extensive clinical experience and coaching acumen to craft insights that not only validate but also empower the individual, facilitating their emotional growth and professional fulfillment within the educational environment.

EMOTIONAL CHECK-IN DATA:
- Weather/Mood Metaphor: ${data.weatherType}
- Selected Moods: ${moodText}
- Detailed Thoughts: ${data.details || 'No additional details provided'}
- Presence Level (1-10): ${data.presenceLevel}
- Capacity Level (1-10): ${data.capacityLevel}
- Support Contact: ${supportContactText}

Please provide a comprehensive psychological analysis in VALID JSON format ONLY. Do not include any text before or after the JSON. The response must be parseable JSON:

{
  "emotionalState": "positive|challenging|balanced|depleted",
  "presenceState": "high|moderate|low",
  "capacityState": "high|moderate|low",
  "recommendations": [
    {
      "title": "Brief title",
      "description": "Detailed recommendation",
      "priority": "high|medium|low",
      "category": "mindfulness|social|professional|self-care"
    }
  ],
  "psychologicalInsights": "Write a supportive, motivational message (1-3 sentences) that acknowledges their feelings, celebrates their strengths, and offers hope. Make it personal, warm, and empowering. Include specific encouragement based on their weather metaphor and mood selections. Add a simple mindfulness breathing tip like: 'Try the Belly Breathing technique: Place one hand on your belly and one on your chest. Breathe in slowly through your nose for 4 counts, feeling your belly rise. Hold for 4 counts, then exhale through your mouth for 4 counts, feeling your belly fall. Repeat 3-5 times.' or 'Try the 4-7-8 Breathing Exercise: Inhale quietly through your nose for 4 seconds, hold your breath for 7 seconds, then exhale completely through your mouth for 8 seconds. This helps calm your nervous system.' or 'Try Balloon Breathing: Imagine your belly is a balloon. Breathe in through your nose and imagine the balloon filling with air, then breathe out through your mouth and imagine the balloon deflating. Repeat 5 times.'",
  "motivationalMessage": "Write a powerful, uplifting message (1-2 sentences) with positive affirmations, gratitude reminders, or inspirational words that can immediately boost their mood and energy.",
  "needsSupport": true|false,
  "confidence": 85
}

IMPORTANT: Focus on being EXTREMELY supportive, motivational, and uplifting. Use positive psychology principles. Include elements like:
- Gratitude and appreciation
- Recognition of their efforts and resilience
- Hope and possibility
- Gentle encouragement
- Positive reframing
- Self-compassion reminders

Make the psychological insights and motivational message feel like a warm, supportive conversation from a trusted friend who believes in them.

CRITICAL: Return ONLY valid JSON. No markdown, no explanations, no additional text. Just the JSON object.`;
    }

    parseAIResponse(aiResponse, checkinData) {
        try {
            console.log('🔍 Raw AI Response:', aiResponse);

            // Check if AI response was cut off due to token limits
            const candidate = aiResponse.candidates?.[0];
            if (candidate?.finishReason === 'MAX_TOKENS') {
                console.warn('⚠️ AI response was truncated due to token limit');
                throw new Error('AI response incomplete - token limit reached');
            }

            // Handle the new Google Gen AI SDK response format
            // Extract text from candidates[0].content.parts[0].text
            const aiText = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
                aiResponse.candidates?.[0]?.content?.text;

            if (!aiText) {
                console.warn('⚠️ No text content found in AI response');
                throw new Error('No text content found in AI response');
            }

            console.log('📝 AI Text Content:', aiText);

            // Remove markdown code blocks if present
            const cleanText = aiText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            console.log('🧹 Cleaned Text:', cleanText);

            // Try to parse the cleaned JSON
            const parsed = JSON.parse(cleanText);
            console.log('✅ Successfully parsed AI response');

            // Ensure motivationalMessage exists, add default if missing
            if (!parsed.motivationalMessage) {
                parsed.motivationalMessage = "You are capable of amazing things! Keep believing in yourself and your journey.";
            }

            return this.validateAnalysis(parsed);

        } catch (error) {
            console.error('❌ Failed to parse AI response:', error.message);
            console.log('🔄 Falling back to enhanced analysis');
            const fallback = this.enhancedFallbackAnalysis(checkinData);
            // Ensure fallback includes motivationalMessage
            if (!fallback.motivationalMessage) {
                fallback.motivationalMessage = "You are capable of amazing things! Keep believing in yourself and your journey.";
            }
            return fallback;
        }
    }

    validateAnalysis(analysis) {
        // Ensure required fields exist, add defaults for missing ones
        const requiredFields = ['emotionalState', 'presenceState', 'capacityState', 'recommendations', 'psychologicalInsights', 'needsSupport'];

        for (const field of requiredFields) {
            if (!(field in analysis)) {
                throw new Error(`Missing required field: ${field}`);
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

        // Limit recommendations to 4
        analysis.recommendations = analysis.recommendations.slice(0, 4);

        // Ensure confidence is a number
        analysis.confidence = typeof analysis.confidence === 'number'
            ? Math.min(100, Math.max(0, analysis.confidence))
            : 75;

        return analysis;
    }

    parseTextResponse(aiText, checkinData) {
        // Simple text parsing fallback
        const text = aiText.toLowerCase();

        let emotionalState = 'balanced';
        if (text.includes('positive') || text.includes('good') || text.includes('happy')) {
            emotionalState = 'positive';
        } else if (text.includes('challenging') || text.includes('difficult') || text.includes('stress')) {
            emotionalState = 'challenging';
        } else if (text.includes('depleted') || text.includes('exhausted')) {
            emotionalState = 'depleted';
        }

        return {
            emotionalState,
            presenceState: checkinData.presenceLevel >= 7 ? 'high' : checkinData.presenceLevel >= 4 ? 'moderate' : 'low',
            capacityState: checkinData.capacityLevel >= 7 ? 'high' : checkinData.capacityLevel >= 4 ? 'moderate' : 'low',
            recommendations: [
                {
                    title: "Practice Mindfulness",
                    description: "Take a few moments to breathe deeply and center yourself",
                    priority: "medium",
                    category: "mindfulness"
                }
            ],
            psychologicalInsights: "Your check-in shows you're actively engaging with your emotional well-being, which is a positive step toward mental health awareness.",
            motivationalMessage: "You are capable of amazing things! Keep believing in yourself and your journey.",
            needsSupport: checkinData.capacityLevel <= 3 || checkinData.presenceLevel <= 3,
            confidence: 70
        };
    }

    enhancedFallbackAnalysis(checkinData, startTime = Date.now()) {
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
                ? ` ${personalElements[userSpecificElement % personalElements.length]}`
                : '';

            // Ultra-motivational messages with gratitude and empowerment - NOW WITH VARIATIONS
            const messageVariations = {
                sunny_positive: [
                    `🌞 WOW! Your radiant energy is absolutely contagious!${personalMessage} Right now, take a moment to feel grateful for this beautiful state of being. You're not just happy - you're a walking blessing who makes the world brighter just by being yourself. Keep shining, superstar! ✨`,
                    `🌞 Your sunny disposition is like a beacon of pure joy!${personalMessage} Feel the gratitude for this incredible energy you bring to every moment. You're not just feeling good - you're SPREADING goodness everywhere you go! What a beautiful gift you are! ☀️`,
                    `🌞 BRILLIANT! Your positive energy is absolutely magnetic!${personalMessage} Take a deep breath and feel grateful for this wonderful state. You're not just happy - you're a source of light and warmth for everyone around you! Keep radiating that beautiful energy! 🌟`
                ],
                rainbow_positive: [
                    `🌈 Oh my goodness, what a spectacular rainbow of joy you're radiating!${personalMessage} Each color in your emotional spectrum is a testament to your incredible resilience and depth. Feel the gratitude for this moment of beauty - YOU created this! You're absolutely magnificent! 💖`,
                    `🌈 What a stunning display of emotional beauty you're showing!${personalMessage} Your rainbow of feelings represents such depth and wisdom. Feel grateful for this colorful journey - you're painting the world with your unique light! What a masterpiece you are! 🎨`,
                    `🌈 INCREDIBLE! Your emotional rainbow is absolutely breathtaking!${personalMessage} Each hue tells a story of your strength and growth. Feel the gratitude for this beautiful spectrum - you're not just experiencing emotions, you're creating art with them! 🌈✨`
                ],
                challenging: [
                    `💪 Listen to me: You are STRONGER than any storm that rages around you!${personalMessage} This tough moment? It's just weather passing through. Feel deep gratitude for your courage in facing it head-on. You're building unbreakable strength, and I am so incredibly proud of you! You've overcome harder things before, and you'll triumph again! 🌟`,
                    `💪 You possess an inner strength that's absolutely remarkable!${personalMessage} These challenging feelings? They're temporary clouds in your sky. Feel grateful for your resilience - you're not just surviving, you're growing stronger with every breath! What a warrior you are! ⚔️`,
                    `💪 Your courage in facing these emotions is truly heroic!${personalMessage} Remember that every storm eventually passes, and you're building character that will serve you beautifully. Feel the gratitude for your bravery - you're stronger than you know! 💪🌟`
                ],
                tired_overwhelmed: [
                    `😴 Sweet friend, your body and spirit are whispering 'rest' - and that's wisdom speaking!${personalMessage} Feel immense gratitude for all you've accomplished today. You're not weak for needing rest; you're wise for honoring your limits. Tomorrow brings fresh strength, and you're absolutely capable of amazing things! 💤✨`,
                    `😴 Your wisdom in recognizing when to rest is absolutely beautiful!${personalMessage} Feel grateful for everything you've achieved - it's okay to pause and recharge. You're not stopping, you're strategically refueling for even greater accomplishments! What smart self-care! 🛌`,
                    `😴 How wise you are to listen to your body's signals!${personalMessage} Feel deep gratitude for your accomplishments today. Rest isn't weakness - it's your superpower for sustainable strength. You're absolutely capable of amazing things tomorrow! 💤🌙`
                ],
                lonely_sad: [
                    `💙 Oh precious heart, your feelings are so valid, and you're so incredibly loved!${personalMessage} Take a moment to feel grateful for the connections in your life, even the quiet ones. You're never truly alone - your spirit touches so many lives. Keep reaching out; you're worthy of deep, beautiful connections! 🤗`,
                    `💙 Your heart is so precious and worthy of all the love in the world!${personalMessage} Feel grateful for the quiet strength within you. Even in stillness, you're connected to something much larger. You're not alone - you're deeply loved and cherished! 💙🤗`,
                    `💙 What a beautiful, sensitive heart you have!${personalMessage} Feel the gratitude for your capacity to feel deeply. Your emotions connect you to the human experience in meaningful ways. You're worthy of love, support, and beautiful connections! 💙🌹`
                ]
            };

            // Select message based on conditions with randomization
            let messageKey = 'default';
            if (weatherType === 'sunny' && hasPositiveMoods) messageKey = 'sunny_positive';
            else if (weatherType === 'rainbow' && hasPositiveMoods) messageKey = 'rainbow_positive';
            else if (hasChallengingMoods && capacityLevel <= 5) messageKey = 'challenging';
            else if (moods.includes('tired') || moods.includes('overwhelmed')) messageKey = 'tired_overwhelmed';
            else if (moods.includes('lonely') || moods.includes('sad')) messageKey = 'lonely_sad';

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

            if (recommendations.length === 0) {
                recommendations.push({
                    title: "Celebrate Your Awareness",
                    description: "Give yourself credit for taking time to check in with your emotions. This self-awareness is a superpower that will serve you throughout your life.",
                    priority: "medium",
                    category: "self-care"
                });
            }

            return recommendations.slice(0, 3); // Limit to 3 recommendations
        };

        return {
            emotionalState: presenceLevel >= 7 && capacityLevel >= 7 ? 'positive' :
                presenceLevel <= 4 || capacityLevel <= 4 ? 'challenging' : 'balanced',
            presenceState: presenceLevel >= 7 ? 'high' : presenceLevel >= 4 ? 'moderate' : 'low',
            capacityState: capacityLevel >= 7 ? 'high' : capacityLevel >= 4 ? 'moderate' : 'low',
            recommendations: getRecommendations(),
            psychologicalInsights: getPsychologicalInsights(),
            motivationalMessage: getMotivationalMessage(),
            needsSupport: capacityLevel <= 4 || presenceLevel <= 4,
            confidence: 100, // Maximum confidence for ultra-motivational fallback
            processingTime: Date.now() - startTime
        };
    }

    // Keep the old method for backward compatibility
    fallbackAnalysis(checkinData, startTime = Date.now()) {
        return this.enhancedFallbackAnalysis(checkinData, startTime);
    }
}

// Generate personalized greeting based on emotional check-in data
const generatePersonalizedGreeting = async (checkinData, aiAnalysis) => {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

        const prompt = `
You are an empathetic AI wellness coach. Based on this emotional check-in data, create a personalized, warm greeting (just 2-4 words) that acknowledges their current emotional state and makes them feel seen and supported.

Emotional State: ${aiAnalysis.emotionalState}
Weather Type: ${checkinData.weatherType}
Selected Moods: ${checkinData.selectedMoods.join(', ')}
Presence Level: ${checkinData.presenceLevel}/10
Capacity Level: ${checkinData.capacityLevel}/10
Details: ${checkinData.details || 'No additional details provided'}

The greeting should be:
- Personal and warm (use words like "beautiful", "brave", "wonderful", "gentle")
- Acknowledge their emotional state without being clinical
- Be encouraging and supportive
- Maximum 4 words (very short and memorable)
- End with appropriate emoji if it fits naturally

Examples:
- "Hello, beautiful soul 🌞"
- "Welcome, brave heart 💪"
- "Good to see you ✨"
- "Hello, gentle spirit 💙"

Create one short, personalized greeting:`;

        const result = await model.generateContent(prompt);
        const greeting = result.response.text().trim();

        // Clean up the response (remove quotes, extra whitespace)
        return greeting.replace(/^["']|["']$/g, '').trim();

    } catch (error) {
        console.error('Error generating personalized greeting:', error);
        // Fallback to a generic but warm greeting
        return "Welcome back, wonderful you! ✨";
    }
};

module.exports = {
    aiAnalysisService: new AIAnalysisService(),
    generatePersonalizedGreeting
};