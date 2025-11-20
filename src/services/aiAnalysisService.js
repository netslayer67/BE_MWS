const googleAI = require('../config/googleAI');
const cacheService = require('../services/cacheService');

class AIAnalysisService {
    constructor() {
        this.requestQueue = [];
        this.isProcessing = false;
        this.minDelay = 1500;
        this.lastRequestTime = 0;
    }

    async analyzeEmotionalCheckin(checkinData) {
        const startTime = Date.now();
        const cacheKey = this.generateCacheKey(checkinData);

        // Check cache first
        const cachedResult = cacheService.getCheckinAnalysis(cacheKey);
        if (cachedResult) {
            console.log('✅ Using cached AI analysis');
            return {
                ...cachedResult,
                cached: true,
                processingTime: Date.now() - startTime
            };
        }

        // Add to queue for batch processing
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                checkinData,
                cacheKey,
                startTime,
                resolve,
                reject
            });

            // Start processing if not already running
            if (!this.isProcessing) {
                this.processQueue();
            }
        });
    }

    generateCacheKey(checkinData) {
        // Create a unique key based on check-in content
        const content = `${checkinData.weatherType}-${checkinData.selectedMoods?.join(',')}-${checkinData.presenceLevel}-${checkinData.capacityLevel}-${checkinData.details || ''}`;
        return `ai_analysis_${Buffer.from(content).toString('base64').substring(0, 32)}`;
    }

    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) return;

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const { checkinData, cacheKey, startTime, resolve, reject } = this.requestQueue.shift();

            try {
                // Implement rate limiting
                const now = Date.now();
                const timeSinceLastRequest = now - this.lastRequestTime;
                if (timeSinceLastRequest < this.minDelay) {
                    await new Promise(resolve => setTimeout(resolve, this.minDelay - timeSinceLastRequest));
                }

                // Determine context based on user role (if available)
                const context = checkinData.userRole === 'head_unit' || checkinData.userRole === 'directorate' ||
                    checkinData.userRole === 'admin' || checkinData.userRole === 'superadmin'
                    ? 'manager' : 'employee';

                const prompt = this.buildPsychologyPrompt(checkinData, context);
                console.log(`🤖 Sending to AI (${context} context):`, prompt.substring(0, 200) + '...');

                const aiResponse = await googleAI.generateContent(prompt);
                console.log('🤖 AI Response received');

                const analysis = this.parseAIResponse(aiResponse, checkinData);
                this.lastRequestTime = Date.now();

                // Cache the result
                cacheService.setCheckinAnalysis(cacheKey, analysis); // Cache for 1 week (default)

                console.log('✅ AI Analysis successful and cached');

                resolve({
                    ...analysis,
                    processingTime: Date.now() - startTime
                });

            } catch (error) {
                console.error('❌ AI Analysis failed:', error.message);

                // Check for quota/rate limit errors
                if (error.message.includes('429') || error.message.includes('Too Many Requests') ||
                    error.message.includes('quota') || error.message.includes('exceeded')) {
                    console.log('🚫 AI quota exceeded - using fallback analysis');

                    // Use fallback analysis for quota exceeded
                    let fallbackResult = this.enhancedFallbackAnalysis(checkinData, startTime);

                    // For quota exceeded, remove template-based recommendations to maintain AI-only standard
                    fallbackResult.recommendations = [];

                    // Add metadata to indicate these are not AI recommendations
                    fallbackResult.isAIRecommendations = false;
                    fallbackResult.aiUnavailable = true;
                    fallbackResult.quotaExceeded = true;

                    cacheService.setCheckinAnalysis(cacheKey, fallbackResult); // Cache fallback for 1 week

                    resolve({
                        ...fallbackResult,
                        fallback: true,
                        quotaExceeded: true
                    });
                    continue;
                }

                // For other AI errors, use fallback
                console.log('⚠️ AI service error - using fallback analysis');
                let fallbackResult = this.enhancedFallbackAnalysis(checkinData, startTime);

                // For fallback analysis, remove template-based recommendations to maintain AI-only standard
                fallbackResult.recommendations = [];

                // Add metadata to indicate these are not AI recommendations
                fallbackResult.isAIRecommendations = false;
                fallbackResult.aiUnavailable = true;

                cacheService.setCheckinAnalysis(cacheKey, fallbackResult); // Cache fallback for 1 week

                resolve({
                    ...fallbackResult,
                    fallback: true,
                    error: error.message
                });
            }
        }

        this.isProcessing = false;
    }

    buildPsychologyPrompt(data, context = 'employee') {
        // Enhanced support detection with historical context
        const hasHistoricalContext = data.historicalPatterns ? true : false;
        const recentDeviations = data.historicalPatterns?.recentDeviations || [];
        const baselineStability = data.historicalPatterns?.baselineStability || 0.5;

        const moodText = data.selectedMoods?.join(', ') || 'not specified';
        const weatherText = data.weatherType || 'not specified';
        const presenceText = `${data.presenceLevel}/10`;
        const capacityText = `${data.capacityLevel}/10`;

        // Declare prompt variable at the top level
        let prompt;

        // Different prompts based on context (employee self-assessment vs manager/supervisor view)
        if (context === 'manager') {
            // Manager/Supervisor perspective - more analytical, focused on team management
            prompt = `You are a workplace wellness consultant analyzing an employee's emotional check-in data from a management perspective. Provide insights for supervisors and HR professionals to support their team members effectively.

EMPLOYEE DATA:
- Weather/Mood Metaphor: ${weatherText}
- Selected Moods: ${moodText}
- Presence Level: ${presenceText}
- Capacity Level: ${capacityText}
- Additional Details: ${data.details || 'None provided'}

${hasHistoricalContext ? `
HISTORICAL PATTERNS:
- Baseline Stability: ${Math.round(baselineStability * 100)}%
- Recent Changes: ${recentDeviations.length > 0 ? recentDeviations.join(', ') : 'Stable patterns'}
- Trend Analysis: ${data.historicalPatterns?.patternAnalysis || 'Limited data available'}
` : ''}

MANAGEMENT ANALYSIS FRAMEWORK:
1. Assess employee's current workplace readiness and engagement
2. Evaluate potential impact on team performance and collaboration
3. Identify patterns that may require managerial intervention
4. Consider organizational support needs and resource allocation
5. Determine appropriate supervisory response based on:
   - Performance readiness indicators (presence/capacity levels)
   - Team impact potential (low engagement may affect others)
   - Escalation triggers (severe indicators requiring immediate action)

SUPERVISORY RESPONSE GUIDELINES:
- IMMEDIATE INTERVENTION: presence/capacity ≤3, concerning patterns, potential team impact
- MONITOR CLOSELY: presence/capacity 4-5, inconsistent patterns, gradual changes
- BUSINESS AS USUAL: presence/capacity ≥6, stable positive indicators, no concerns

RESPONSE FORMAT (JSON only):
{
  "emotionalState": "positive|challenging|balanced|depleted",
  "presenceState": "high|moderate|low",
  "capacityState": "high|moderate|low",
  "recommendations": [
    {
      "title": "Management Action",
      "description": "Specific supervisory steps or interventions",
      "priority": "high|medium|low",
      "category": "immediate|monitoring|preventive"
    }
  ],
  "psychologicalInsights": "Management-focused analysis of employee's workplace emotional state, team impact, and recommended supervisory approach",
  "motivationalMessage": "Professional guidance for managers on how to support this employee effectively",
  "needsSupport": true/false,
  "confidence": 0-100,
  "supportReasoning": "Management rationale for support needs and intervention level",
  "historicalContextUsed": true/false
}

IMPORTANT FOR MANAGEMENT:
- Focus on workplace impact and team dynamics
- Provide actionable management strategies
- Consider both employee well-being and organizational productivity
- Be specific about intervention triggers and response levels
- needsSupport should be true if presence/capacity ≤4 OR concerning patterns OR potential team impact`;
        } else {
            // Employee self-assessment perspective - more personal, supportive
            prompt = `You are an empathetic psychologist providing personal emotional wellness guidance. Help this individual understand their emotional state and support their personal growth journey.

PERSONAL EMOTIONAL CHECK-IN DATA:
- Weather/Mood Metaphor: ${weatherText}
- Current Feelings: ${moodText}
- Presence Level: ${presenceText}
- Capacity Level: ${capacityText}
- Personal Reflections: ${data.details || 'No additional reflections shared'}

${hasHistoricalContext ? `
YOUR EMOTIONAL JOURNEY:
- Your Baseline Patterns: ${Math.round(baselineStability * 100)}% consistency
- Recent Changes: ${recentDeviations.length > 0 ? recentDeviations.join(', ') : 'Your patterns have been quite stable'}
- Personal Growth Insights: ${data.historicalPatterns?.patternAnalysis || 'Building your emotional awareness journey'}
` : ''}

PERSONAL WELLNESS ANALYSIS:
1. Reflect on your current emotional weather and how it feels
2. Consider how your presence and capacity align with your daily life
3. Explore what your mood selections and weather metaphor tell you about yourself
4. ${hasHistoricalContext ? 'Notice patterns in your emotional journey and personal growth' : 'Begin building awareness of your emotional patterns'}
5. Identify personal support needs based on:
   - Your current emotional comfort (presence/capacity levels)
   - How you're feeling in this moment
   - ${hasHistoricalContext ? 'Your personal growth patterns and changes' : 'Your authentic emotional experience'}

SELF-CARE GUIDANCE:
- GENTLE SUPPORT: presence/capacity ≤4, feeling challenged, ready for self-compassion
- SELF-AWARENESS: presence/capacity 5-7, exploring feelings, building emotional intelligence
- PERSONAL GROWTH: presence/capacity ≥8, feeling strong, celebrating your journey

RESPONSE FORMAT (JSON only):
{
  "emotionalState": "positive|challenging|balanced|depleted",
  "presenceState": "high|moderate|low",
  "capacityState": "high|moderate|low",
  "recommendations": [
    {
      "title": "Self-Care Step",
      "description": "Personal, actionable self-care or reflection activity",
      "priority": "high|medium|low",
      "category": "immediate|monitoring|preventive"
    }
  ],
  "psychologicalInsights": "Personal reflection on emotional state, self-awareness insights, and gentle guidance for emotional wellness",
  "motivationalMessage": "Warm, personal encouragement celebrating your emotional awareness and personal growth",
  "needsSupport": true/false,
  "confidence": 0-100,
  "supportReasoning": "Personal rationale for self-care needs and next steps",
  "historicalContextUsed": true/false
}

IMPORTANT FOR PERSONAL GROWTH:
- Focus on self-compassion and personal understanding
- Celebrate emotional awareness as a strength
- Provide gentle, non-judgmental guidance
- Encourage authentic self-expression
- needsSupport should be true if presence/capacity ≤4 OR feeling challenged OR seeking personal growth support`;
        }

        // Ensure prompt is always defined
        if (!prompt) {
            throw new Error('Failed to generate prompt for AI analysis');
        }

        return prompt;
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

            // Fix malformed JSON that includes markdown/code wrappers
            let cleanText = aiText.trim();

            // Strip fenced code blocks such as ```json ... ```
            if (cleanText.startsWith('```')) {
                cleanText = cleanText
                    .replace(/^```(?:json)?/i, '')
                    .replace(/```$/i, '')
                    .trim();
                console.log('?? Stripped markdown fences');
            }

            // Remove "json" word at the beginning if present
            if (cleanText.toLowerCase().startsWith('json')) {
                cleanText = cleanText.substring(4).trim();
                console.log('?? Removed json wrapper');
            }

            // When AI wraps JSON with extra prose, keep only the object portion
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanText = cleanText.substring(firstBrace, lastBrace + 1).trim();
            }

            console.log('?? Cleaned Text:', cleanText);

            // Try to parse the cleaned JSON
            const parsed = JSON.parse(cleanText);
            console.log('✅ Successfully parsed AI response');

            // Ensure motivationalMessage exists and is not the forbidden template
            if (!parsed.motivationalMessage || parsed.motivationalMessage.includes("Whatever you're experiencing")) {
                throw new Error('AI generated invalid motivational message - template detected');
            }

            return this.validateAnalysis(parsed);

        } catch (error) {
            console.error('❌ Failed to parse AI response:', error.message);
            console.error('❌ Full error details:', error);

            // Log the problematic content for debugging
            if (error.message.includes('Unexpected token')) {
                const candidate = aiResponse.candidates?.[0];
                const problematicText = candidate?.content?.parts?.[0]?.text || candidate?.content?.text;
                console.error('❌ Problematic text that failed to parse:', problematicText);
            }

            throw new Error(`AI response parsing failed: ${error.message} `);
        }
    }

    validateAnalysis(analysis) {
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
        const basePool = [
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
        if (wantSupport) prioritized.push('Support Check‑in');
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
                ? ` ${personalElements[userSpecificElement % personalElements.length]} `
                : '';

            // Ultra-motivational messages with gratitude and empowerment - NOW WITH VARIATIONS
            const messageVariations = {
                sunny_positive: [
                    `🌞 WOW! Your radiant energy is absolutely contagious!${personalMessage} Right now, take a moment to feel grateful for this beautiful state of being.You're not just happy - you're a walking blessing who makes the world brighter just by being yourself.Keep shining, superstar! ✨`,
                    `🌞 Your sunny disposition is like a beacon of pure joy!${personalMessage} Feel the gratitude for this incredible energy you bring to every moment.You're not just feeling good - you're SPREADING goodness everywhere you go! What a beautiful gift you are! ☀️`,
                    `🌞 BRILLIANT! Your positive energy is absolutely magnetic!${personalMessage} Take a deep breath and feel grateful for this wonderful state.You're not just happy - you're a source of light and warmth for everyone around you! Keep radiating that beautiful energy! 🌟`
                ],
                rainbow_positive: [
                    `🌈 Oh my goodness, what a spectacular rainbow of joy you're radiating!${personalMessage} Each color in your emotional spectrum is a testament to your incredible resilience and depth. Feel the gratitude for this moment of beauty - YOU created this! You're absolutely magnificent! 💖`,
                    `🌈 What a stunning display of emotional beauty you're showing!${personalMessage} Your rainbow of feelings represents such depth and wisdom. Feel grateful for this colorful journey - you're painting the world with your unique light! What a masterpiece you are! 🎨`,
                    `🌈 INCREDIBLE! Your emotional rainbow is absolutely breathtaking!${personalMessage} Each hue tells a story of your strength and growth.Feel the gratitude for this beautiful spectrum - you're not just experiencing emotions, you're creating art with them! 🌈✨`
                ],
                challenging: [
                    `💪 Listen to me: You are STRONGER than any storm that rages around you!${personalMessage} This tough moment ? It's just weather passing through. Feel deep gratitude for your courage in facing it head-on. You're building unbreakable strength, and I am so incredibly proud of you! You've overcome harder things before, and you'll triumph again! 🌟`,
                    `💪 You possess an inner strength that's absolutely remarkable!${personalMessage} These challenging feelings? They're temporary clouds in your sky.Feel grateful for your resilience - you're not just surviving, you're growing stronger with every breath! What a warrior you are! ⚔️`,
                    `💪 Your courage in facing these emotions is truly heroic!${personalMessage} Remember that every storm eventually passes, and you're building character that will serve you beautifully. Feel the gratitude for your bravery - you're stronger than you know! 💪🌟`
                ],
                tired_overwhelmed: [
                    `😴 Sweet friend, your body and spirit are whispering 'rest' - and that's wisdom speaking!${personalMessage} Feel immense gratitude for all you've accomplished today.You're not weak for needing rest; you're wise for honoring your limits.Tomorrow brings fresh strength, and you're absolutely capable of amazing things! 💤✨`,
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
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });

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
