const googleAI = require('../config/googleAI');
const cacheService = require('../services/cacheService');

class AIAnalysisService {
    constructor() {
        this.requestQueue = [];
        this.isProcessing = false;
        this.minDelay = 1500;
        this.lastRequestTime = 0;
        this.cooldownUntil = 0;
        this.cooldownDurationMs = parseInt(process.env.AI_RATE_LIMIT_COOLDOWN_MS, 10) || (5 * 60 * 1000);
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

        if (!googleAI.isAvailable()) {
            const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'ai_unavailable');
            cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
            return {
                ...fallbackResult,
                fallback: true,
                aiUnavailable: true,
                message: 'AI service unavailable - using smart fallback insights.'
            };
        }

        if (this.isInCooldown()) {
            const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'cooldown_active');
            cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
            return {
                ...fallbackResult,
                fallback: true,
                cooldownActive: true,
                cooldownMessage: this.getCooldownMessage()
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

            if (this.isInCooldown()) {
                const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'cooldown_active');
                cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                resolve({
                    ...fallbackResult,
                    fallback: true,
                    cooldownActive: true,
                    cooldownMessage: this.getCooldownMessage()
                });
                continue;
            }

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

                if (this.isRateLimitError(error)) {
                    const cooldownMs = this.scheduleCooldown();
                    const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'rate_limit');
                    fallbackResult.cooldown = {
                        durationMs: this.cooldownDurationMs,
                        remainingMs: cooldownMs
                    };
                    cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                    resolve({
                        ...fallbackResult,
                        fallback: true,
                        rateLimited: true,
                        message: this.getCooldownMessage()
                    });
                    continue;
                }

                if (this.isServiceUnavailableError(error)) {
                    const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'service_unavailable');
                    cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                    resolve({
                        ...fallbackResult,
                        fallback: true,
                        serviceUnavailable: true
                    });
                    continue;
                }

                const fallbackResult = this.generateRichFallbackResponse(checkinData, startTime, 'general_failure');
                cacheService.setCheckinAnalysis(cacheKey, fallbackResult);
                resolve({
                    ...fallbackResult,
                    fallback: true,
                    message: error.message || 'AI analysis failed - fallback data provided'
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

    // Keep the old method for backward compatibility
    fallbackAnalysis(checkinData, startTime = Date.now()) {
        return this.enhancedFallbackAnalysis(checkinData, startTime);
    }

    getFallbackAnalysis(checkinData, reason = 'manual_fallback') {
        return this.generateRichFallbackResponse(checkinData, Date.now(), reason);
    }

    generateRichFallbackResponse(checkinData, startTime, reason = 'fallback') {
        const base = this.enhancedFallbackAnalysis(checkinData, startTime);
        const seed = this.createSeed(checkinData);
        const moods = Array.isArray(checkinData.selectedMoods) ? checkinData.selectedMoods : [];
        const weather = checkinData.weatherType || 'unknown';

        const emotionalHighlights = this.buildEmotionalHighlights(moods, weather, checkinData.details, seed);
        const emotionalStoryline = this.buildEmotionalStoryline(moods, weather, checkinData.details, seed);
        const recommendedRituals = this.buildRecommendedRituals(moods, weather, seed);
        const microHabits = this.buildMicroHabits(seed);
        const supportRecommendations = this.buildSupportRecommendations(checkinData.supportContact, seed);
        const selfReflectionPrompts = this.buildSelfReflectionPrompts(moods, weather, seed);
        const groundingPractices = this.buildGroundingPractices(seed);
        const gratitudeAffirmations = this.buildGratitudeAffirmations(seed);
        const energyForecast = this.buildEnergyForecast(checkinData.presenceLevel, checkinData.capacityLevel, seed);
        const moodPulse = this.buildMoodPulseInsights(moods, seed);
        const compassionateCheckpoints = this.buildCompassionateCheckpoints(seed);
        const breathPatterns = this.buildBreathPatterns(seed);
        const nervousSystemSupports = this.buildNervousSystemSupports(seed, checkinData.presenceLevel, checkinData.capacityLevel);
        const focusAnchors = this.buildFocusAnchors(seed);
        const trendSignals = this.buildTrendSignals(moods, weather, checkinData.historicalPatterns, seed);
        const restCompass = this.buildRestCompass(seed, checkinData.capacityLevel);
        const readinessMatrix = this.buildReadinessMatrix(checkinData.presenceLevel, checkinData.capacityLevel, seed);
        const supportCompass = this.buildSupportCompass(checkinData, emotionalStoryline, readinessMatrix, seed);
        const displayHints = this.buildDisplayHints(emotionalStoryline, energyForecast, readinessMatrix, weather, seed);
        const insightChips = this.buildInsightChips(moods, weather, seed);

        const summary = this.buildFallbackSummary(moods, weather, checkinData.details);

        const structuredRecommendations = recommendedRituals.map((ritual, index) => ({
            title: ritual.name,
            description: ritual.description,
            duration: ritual.duration,
            priority: index === 0 ? 'high' : 'medium',
            category: 'supportive_ritual'
        }));

        return {
            ...base,
            summary,
            emotionalHighlights,
            resilienceScore: this.calculateResilienceScore(checkinData, seed),
            recommendedRituals,
            microHabits,
            supportRecommendations,
            selfReflectionPrompts,
            groundingPractices,
            gratitudeAffirmations,
            energyForecast,
            moodPulse,
            compassionateCheckpoints,
            breathPatterns,
            nervousSystemSupports,
            focusAnchors,
            trendSignals,
            restCompass,
            emotionalStoryline,
            readinessMatrix,
            supportCompass,
            displayHints,
            insightChips,
            recommendations: structuredRecommendations,
            metadata: {
                generatedBy: 'fallback_engine',
                timestamp: new Date().toISOString(),
                processingTime: Date.now() - startTime,
                reason
            }
        };
    }

    buildEmotionalStoryline(moods, weather, details, seed) {
        const defaultArc = {
            title: 'Steady Awareness',
            chapter: 'Noticing subtle shifts',
            narrative: 'You are tracking your inner climate with honesty, which creates space for calm adjustments.',
            arc: 'stabilizing',
            inflection: 'gentle',
            confidence: 78,
            colorTone: 'amber'
        };

        if (!moods?.length && !weather && !details) {
            return defaultArc;
        }

        const anchors = [
            { arc: 'ascending', tone: 'emerald', label: 'Momentum Rising' },
            { arc: 'stabilizing', tone: 'amber', label: 'Holding Ground' },
            { arc: 'softening', tone: 'rose', label: 'Gentle Recovery' },
            { arc: 'recharging', tone: 'indigo', label: 'Quiet Restoration' }
        ];
        const anchor = this.rotateArray(anchors, seed)[0];

        const primaryMood = moods?.[0] || 'calm curiosity';
        const narrative = details
            ? `Your note "${details.slice(0, 140)}" reads like a page from a reflective journal.`
            : `Leaning into ${primaryMood} while picturing ${weather || 'neutral skies'} shows real emotional literacy.`;

        return {
            title: anchor.label,
            chapter: `Chapter: ${primaryMood} under ${weather || 'open skies'}`,
            narrative,
            arc: anchor.arc,
            inflection: primaryMood,
            confidence: 72 + (seed % 17),
            colorTone: anchor.tone
        };
    }

    buildReadinessMatrix(presenceLevel = 5, capacityLevel = 5, seed = 1) {
        const presenceScore = Number(presenceLevel) || 0;
        const capacityScore = Number(capacityLevel) || 0;
        const overall = Math.round(((presenceScore + capacityScore) / 20) * 100);

        const lane = overall >= 80 ? 'glide'
            : overall >= 60 ? 'steady'
                : overall >= 40 ? 'sensitive'
                    : 'repair';

        const signals = [
            {
                label: 'Focus Lane',
                status: presenceScore >= 7 ? 'clear' : presenceScore >= 4 ? 'foggy' : 'dense',
                idea: presenceScore >= 6 ? 'Leverage clear hours for meaningful work.'
                    : 'Protect your first 30 minutes with a ritual before engaging others.'
            },
            {
                label: 'Energy Lane',
                status: capacityScore >= 7 ? 'charged' : capacityScore >= 4 ? 'oscillating' : 'drained',
                idea: capacityScore >= 6
                    ? 'Channel surplus energy into creative or relational work.'
                    : 'Schedule one non-negotiable rest pocket today.'
            }
        ];

        return {
            presenceScore,
            capacityScore,
            overallReadiness: overall,
            readinessLane: lane,
            signals: this.rotateArray(signals, seed)
        };
    }

    buildSupportCompass(checkinData, storyline, readinessMatrix, seed) {
        const needsSupport = readinessMatrix.overallReadiness < 55 ||
            readinessMatrix.signals.some(sig => sig.status === 'dense' || sig.status === 'drained');

        const allies = [
            'Peer ally',
            'Mentor/coach',
            'Lead teacher',
            'People operations',
            'Trusted friend'
        ];

        return {
            needsSupport,
            supportLevel: needsSupport ? 'active' : 'monitor',
            suggestedAllies: this.rotateArray(allies, seed).slice(0, 2),
            message: needsSupport
                ? 'Signal a quick check-in with someone on your support list; shared regulation accelerates recovery.'
                : 'Keep your circle updated even while things feel steady—consistency builds trust.',
            storylineContext: storyline?.title
        };
    }

    buildDisplayHints(storyline, energyForecast, readinessMatrix, weather, seed) {
        const baseThemes = [
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

        const theme = this.rotateArray(baseThemes, seed)[0];

        return {
            theme: theme.name,
            gradientCss: theme.gradientCss,
            glassClass: null,
            glassColor: theme.glassColor,
            borderColor: theme.borderColor,
            accentColor: theme.accent,
            density: readinessMatrix.overallReadiness >= 70 ? 'airy' : readinessMatrix.overallReadiness >= 45 ? 'balanced' : 'cozy',
            badges: [
                storyline?.title,
                weather ? weather.replace(/-/g, ' ') : energyForecast.descriptor
            ].filter(Boolean).slice(0, 3),
            animationAnchor: storyline?.arc === 'ascending' ? 'fade-up' : 'fade-in',
            moodIntent: theme.mood
        };
    }

    buildInsightChips(moods, weather, seed) {
        const chips = [];
        if (moods?.length) {
            chips.push(...moods.slice(0, 3).map(m => ({ label: m, type: 'mood' })));
        }
        if (weather) {
            chips.push({ label: weather, type: 'weather' });
        }
        const extras = [
            { label: 'micro-rest ready', type: 'ritual' },
            { label: 'pattern tracking', type: 'trend' },
            { label: 'kindness quota', type: 'self-care' },
            { label: 'signal honest', type: 'reflection' }
        ];
        chips.push(...this.rotateArray(extras, seed).slice(0, 2));
        return chips;
    }
    buildFallbackSummary(moods, weather, details = '') {
        const moodText = moods.length > 0
            ? `You are navigating feelings of ${moods.join(', ')}`
            : 'You are observing a complex emotional landscape';

        const weatherText = weather !== 'unknown'
            ? ` with an internal weather of ${weather}.`
            : '.';

        const detailsText = details
            ? ` The way you articulated "${details.substring(0, 180)}" shows meaningful self-awareness.`
            : ' Thank you for taking a mindful pause to check in with yourself.';

        return `${moodText}${weatherText}${detailsText}`;
    }

    buildEmotionalHighlights(moods, weather, details, seed) {
        const insights = [
            {
                title: 'Emotional Spectrum',
                insight: moods.length
                    ? `Today features a tapestry of ${moods.slice(0, 4).join(', ')}. Your ability to name these experiences builds emotional literacy.`
                    : 'Even when emotions feel muted or vague, noticing the absence of clarity is a courageous first step.',
                encouragement: 'Stay curious. Each emotion is data, not a directive.'
            },
            {
                title: 'Weather Metaphor',
                insight: weather !== 'unknown'
                    ? `The ${weather} weather imagery suggests your nervous system is paying attention to subtle shifts.`
                    : 'No weather selected today, which is perfectly okay. Some days simply observing is enough.',
                encouragement: 'Whatever the climate, you are learning to forecast and prepare.'
            },
            {
                title: 'Narrative Depth',
                insight: details
                    ? `Your reflection "${details.substring(0, 160)}" reveals thoughtful processing.`
                    : 'Even without written details, showing up signals a commitment to self-care.',
                encouragement: 'The act of naming your experience is a bold, restorative decision.'
            }
        ];

        return this.rotateArray(insights, seed);
    }

    buildRecommendedRituals(moods, weather, seed) {
        const rituals = [
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


        return this.rotateArray(rituals, seed).slice(0, 3);
    }

    buildMicroHabits(seed) {
        const habits = [
            'Drink water mindfully while repeating a calming mantra.',
            'Write one sentence of appreciation about yourself on a sticky note.',
            'Step outside for 120 seconds and simply observe the horizon.',
            'Use a colored highlighter to mark moments of hope in your notes.',
            'Adopt a "one-tab" rule for 15 minutes to reduce cognitive load.',
            'Queue a song that matches your mood and breathe with the rhythm.',
            'Stretch your wrists and jaw every time you send three messages.',
            'Replace doom-scroll breaks with one photo from your happy album.',
            'Stack gratitude onto an existing habit—say thank you each time you wash your hands.'
        ];


        return this.rotateArray(habits, seed).slice(0, 4);
    }

    buildSupportRecommendations(supportContact, seed) {
        const baseSuggestions = [
            'Share a low-stakes update to maintain relational warmth.',
            'Ask specifically for listening, advice, or accountability to get the support you need.',
            'Consider scheduling a shared mindful moment-two minutes of silence together can be grounding.',
            'Send a "just thinking of you" note to remind both of you that connection is alive.',
            'Trade a playlist or podcast episode to spark conversation from a gentle place.'
        ];


        if (supportContact) {
            baseSuggestions.unshift(`Reach out to ${supportContact} with one sentence about how you truly are—authenticity builds deeper support.`);
        }

        return this.rotateArray(baseSuggestions, seed).slice(0, 3);
    }

    buildSelfReflectionPrompts(moods, weather, seed) {
        const prompts = [
            'What is one gentle truth I am willing to acknowledge about today?',
            'Which emotion feels loudest, and what message might it be sending?',
            'Where in my body is my stress or hope sitting right now?',
            'What would "2% more ease" look like in the next hour?',
            'Who or what reminded me that I am not alone?',
            'If I could name today\'s chapter, what would it be called and why?',
            'When did I feel even a tiny spark of joy, curiosity, or relief today?',
            'What support would future-me thank me for requesting in this moment?'
        ];


        return this.rotateArray(prompts, seed).slice(0, 4);
    }

    buildGroundingPractices(seed) {
        const practices = [
            'Box breathing (inhale 4, hold 4, exhale 4) for five cycles.',
            'Progressive muscle relaxation starting from your toes to your forehead.',
            'Name five things you can see, four you can touch, three you can hear, two you can smell, one you can taste.',
            'Hold a warm mug with both hands and focus on the sensation.',
            'Walk barefoot indoors for one minute to reconnect with the present.',
            'Trace the outline of your hand slowly while repeating an affirmation.',
            'Place one hand on your chest, one on your stomach, and hum softly to vibrate calm through your body.',
            'Rinse your wrists under cool water and imagine it carrying away static thoughts.'
        ];


        return this.rotateArray(practices, seed).slice(0, 3);
    }

    buildGratitudeAffirmations(seed) {
        const affirmations = [
            'I honor the part of me that keeps showing up.',
            'I am allowed to take up space with my emotions.',
            'Progress can be microscopic and still meaningful.',
            'Every breath is a quiet vote for my well-being.',
            'I can be both a work in progress and worthy of kindness.',
            'I nurture others by remembering to nurture myself.',
            'Even my pauses are purposeful.',
            'My feelings are information, not instructions.'
        ];


        return this.rotateArray(affirmations, seed).slice(0, 3);
    }

    buildEnergyForecast(presenceLevel = 5, capacityLevel = 5, seed) {
        const avg = (Number(presenceLevel) + Number(capacityLevel)) / 2 || 0;
        const descriptor = avg >= 7 ? 'buoyant'
            : avg >= 5 ? 'steady'
                : avg >= 3 ? 'sensitive'
                    : 'delicate';
        const tips = [
            'Honor micro-rests between tasks to preserve momentum.',
            'Alternate focused work with sensory breaks (sound, scent, or touch).',
            'Choose one task to simplify or delegate to create breathing space.',
            'Schedule a five-minute ritual to celebrate small completions.',
            'Invite natural light or music to nudge your nervous system toward calm activation.',
            'Pair hydration with two shoulder rolls to release static energy.',
            'Color-code your to-dos by effort so you can match energy to the right item.'
        ];


        return {
            descriptor,
            outlook: `Your emotional energy feels ${descriptor} today. Protect what is vibrant, cradle what feels raw.`,
            tips: this.rotateArray(tips, seed).slice(0, 3)
        };
    }

    buildMoodPulseInsights(moods, seed) {
        if (!moods || moods.length === 0) {
            moods = ['calm'];
        }

        const pulseInsights = moods.map((mood, idx) => ({
            mood,
            pulse: idx % 2 === 0 ? 'ascending' : 'steady',
            suggestion: this.rotateArray([
                `Notice when ${mood} intensifies; breathe into that wave.`,
                `Document a micro-moment that sparked ${mood} today.`,
                `Pair the feeling of ${mood} with a grounding object nearby.`
            ], seed + idx)[0]
        }));

        return pulseInsights.slice(0, 5);
    }

    buildCompassionateCheckpoints(seed) {
        const checkpoints = [
            'Pause before lunch to acknowledge one thing you handled with courage.',
            'At 3 PM, ask yourself "What would make the rest of the day 10% kinder?"',
            'Before bedtime, write down a thought you are releasing.',
            'Send a quick appreciation message to someone who crossed your mind today.',
            'Celebrate one boundary you protected, even if tiny.',
            'Choose a mantra for the evening commute or wind-down ritual and repeat it three times.'
        ];


        return this.rotateArray(checkpoints, seed).slice(0, 3);
    }

    buildBreathPatterns(seed) {
        const patterns = [
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


        return this.rotateArray(patterns, seed).slice(0, 2);
    }

    buildNervousSystemSupports(seed, presence = 5, capacity = 5) {
        const tone = (Number(presence) + Number(capacity)) / 2 >= 6 ? 'steady' : 'tender';
        const supports = [
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

        if (tone === 'steady') {
            supports.push({
                title: 'Momentum Breath',
                prompt: 'Take three energizing breaths—in through the nose, out with a sigh—before re-entering focused work.'
            });
        } else {
            supports.push({
                title: 'Comfort Visualization',
                prompt: 'Picture a safe place in detail (lighting, scent, sounds) and breathe there for five inhales.'
            });
        }

        return this.rotateArray(supports, seed).slice(0, 3);
    }

    buildFocusAnchors(seed) {
        const anchors = [
            'Set a 15-minute timer labeled “move one pebble” and work solely on a single micro-task.',
            'Write the next step on a sticky note and place it at eye level—physical cues cut through fog.',
            'Use the “read aloud” feature on a doc to convert visual fatigue into auditory focus.',
            'Swap to a standing or walking call for your next meeting to inject kinesthetic energy.',
            'Try the 3-2-1 method: name three priorities, two stretch goals, one thing you’ll intentionally postpone.'
        ];

        return this.rotateArray(anchors, seed).slice(0, 3);
    }

    buildTrendSignals(moods, weather, history = {}, seed) {
        const patterns = history?.patternAnalysis || 'You are building a meaningful archive of emotional awareness.';
        const signals = [
            {
                label: 'Mood Arc',
                observation: moods.length
                    ? `Recent check-ins show ${moods.slice(0, 3).join(', ')} surfacing often—track what precedes each one.`
                    : 'Even recording “not sure” becomes valuable data; absence of clarity is still a signal.',
                action: 'Note the time of day for the next few entries to see if rhythm influences perception.'
            },
            {
                label: 'Weather Echo',
                observation: weather && weather !== 'unknown'
                    ? `Your ${weather} metaphor is appearing again; it might be a personal shorthand for a specific nervous-system state.`
                    : 'No weather metaphor was chosen, which could indicate emotional fatigue—plan for softer check-ins.',
                action: 'Pair your metaphor with a short note on body sensations to deepen your pattern library.'
            },
            {
                label: 'Baseline Whisper',
                observation: patterns,
                action: 'Celebrate one micro-choice that keeps you tethered when signals fluctuate.'
            }
        ];

        return this.rotateArray(signals, seed).slice(0, 2);
    }

    buildRestCompass(seed, capacityLevel = 5) {
        const level = Number(capacityLevel) || 0;
        const tiers = level >= 7 ? 'maintenance' : level >= 4 ? 'repair' : 'rescue';
        const options = {
            maintenance: [
                'Block a protected evening for playful downtime—no productivity allowed.',
                'Schedule a “lights down” reminder 30 minutes earlier tonight to signal calm.'
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

        const choices = options[tiers];
        return {
            mode: tiers,
            suggestions: this.rotateArray(choices, seed).slice(0, 2)
        };
    }

    calculateResilienceScore(checkinData, seed) {
        const presence = Number(checkinData.presenceLevel) || 0;
        const capacity = Number(checkinData.capacityLevel) || 0;
        const baseScore = Math.min(Math.round(((presence + capacity) / 20) * 100), 100);
        const fluctuation = (seed % 6) - 3; // -3 to +2
        const score = Math.max(Math.min(baseScore + fluctuation, 100), 15);

        return {
            value: score,
            interpretation: this.buildResilienceNarrative(presence, capacity)
        };
    }

    buildResilienceNarrative(presence, capacity) {
        const pct = Math.round(((presence + capacity) / 20) * 100);
        if (pct >= 80) return 'Your system shows remarkable resilience right now—strong presence paired with high capacity.';
        if (pct >= 60) return 'You’re managing a thoughtful balance of presence and capacity; a brief pause could elevate both.';
        if (pct >= 40) return 'Your emotional bandwidth is being tested. Gentle structure and micro-breaks can revive it.';
        return 'You’re operating under a heavy load—radical gentleness and asking for help are strategic moves.';
    }

    createSeed(checkinData) {
        const dateBucket = new Date().toISOString().slice(0, 10);
        const content = [
            checkinData.weatherType,
            ...(checkinData.selectedMoods || []),
            checkinData.presenceLevel,
            checkinData.capacityLevel,
            checkinData.details,
            checkinData.supportContact,
            dateBucket
        ].join('|');

        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            hash = (hash << 5) - hash + content.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash);
    }

    rotateArray(arr, seed) {
        if (!arr || arr.length === 0) return [];
        const rotated = [...arr];
        const shift = seed % rotated.length;
        return rotated.slice(shift).concat(rotated.slice(0, shift));
    }

    isRateLimitError(error) {
        if (!error?.message) return false;
        const message = error.message.toLowerCase();
        return message.includes('429') ||
            message.includes('too many requests') ||
            message.includes('quota') ||
            message.includes('exceeded') ||
            message.includes('rate limit');
    }

    isServiceUnavailableError(error) {
        if (!error?.message) return false;
        const message = error.message.toLowerCase();
        return message.includes('503') ||
            message.includes('service unavailable') ||
            message.includes('overloaded');
    }

    scheduleCooldown() {
        this.cooldownUntil = Date.now() + this.cooldownDurationMs;
        console.warn(`⚠️ AI service entering cooldown for ${Math.ceil(this.cooldownDurationMs / 1000)} seconds due to rate limiting.`);
        return Math.max(this.cooldownUntil - Date.now(), 0);
    }

    isInCooldown() {
        return Date.now() < this.cooldownUntil;
    }

    getCooldownMessage() {
        const remainingMs = Math.max(this.cooldownUntil - Date.now(), 0);
        const seconds = Math.ceil(remainingMs / 1000);
        if (seconds <= 0) return 'AI service cooldown complete.';
        return `AI service is cooling down due to quota limits. Please retry in ${seconds} seconds.`;
    }
}

// Generate personalized greeting based on emotional check-in data
const generatePersonalizedGreeting = async (checkinData, aiAnalysis) => {
    const moodsList = Array.isArray(checkinData.selectedMoods)
        ? checkinData.selectedMoods.filter(Boolean)
        : [];
    const joinedMoods = moodsList.length ? moodsList.join(', ') : 'not specified';

    const buildLocalGreeting = () => {
        const seeds = [
            'gentle star',
            'radiant spirit',
            'brave heart',
            'kind soul',
            'wise friend'
        ];
        const descriptor = moodsList[0] || aiAnalysis?.emotionalState || 'beautiful soul';
        const seedIndex = (descriptor.length + (Number(checkinData.presenceLevel) || 0)) % seeds.length;
        const templates = [
            `Welcome back, ${seeds[seedIndex]} ?`,
            `Hello, ${descriptor} ✨`,
            `Good to see you, ${seeds[(seedIndex + 1) % seeds.length]}!`,
            `Hey there, ${descriptor}!`
        ];
        return templates[seedIndex % templates.length];
    };

    if (!process.env.GOOGLE_AI_API_KEY) {
        return buildLocalGreeting();
    }

    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

        const prompt = `
You are an empathetic AI wellness coach. Based on this emotional check-in data, create a personalized, warm greeting (just 2-4 words) that acknowledges their current emotional state and makes them feel seen and supported.

Emotional State: ${aiAnalysis.emotionalState}
Weather Type: ${checkinData.weatherType}
Selected Moods: ${joinedMoods}
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
- "Hello, beautiful soul ??"
- "Welcome, brave heart ??"
- "Good to see you ?"
- "Hello, gentle spirit ??"

Create one short, personalized greeting:`;

        const result = await model.generateContent(prompt);
        const greeting = result.response.text().trim();
        return greeting.replace(/^["']|["']$/g, '').trim();

    } catch (error) {
        console.error('Error generating personalized greeting:', error);
        return buildLocalGreeting();
    }
};

module.exports = {
    aiAnalysisService: new AIAnalysisService(),
    generatePersonalizedGreeting
};
