const googleAI = require('../config/googleAI');
const AIConversation = require('../models/AIConversation');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const StudentEmotionalCheckin = require('../models/StudentEmotionalCheckin');
const User = require('../models/User');

class AIChatService {
    constructor() {
        this.conversationCache = new Map(); // Cache recent conversations
        this.maxMessagesInContext = 20; // Limit context window
    }

    /**
     * Build personalized context for student
     */
    async buildStudentContext(userId) {
        try {
            // 1. Get user info
            const user = await User.findById(userId).lean();
            if (!user) {
                throw new Error('User not found');
            }

            const studentName = user.name || 'Student';
            const studentGrade = user.metadata?.get('grade') || 'unknown';

            // 2. Get MTSS student profile (if exists)
            let mtssProfile = null;
            let activeInterventions = [];
            let mentorAssignments = [];

            try {
                // Try to find MTSS student by matching name or email
                mtssProfile = await MTSSStudent.findOne({
                    $or: [
                        { email: user.email },
                        { name: { $regex: new RegExp(studentName, 'i') } }
                    ],
                    status: 'active'
                }).lean();

                if (mtssProfile) {
                    // Get active interventions
                    activeInterventions = (mtssProfile.interventions || []).filter(
                        intervention => intervention.status === 'active' || intervention.status === 'monitoring'
                    );

                    // Get mentor assignments
                    mentorAssignments = await MentorAssignment.find({
                        studentIds: mtssProfile._id,
                        status: { $in: ['active', 'paused'] }
                    })
                        .populate('mentorId', 'name email')
                        .populate('strategyId', 'title description')
                        .lean();
                }
            } catch (mtssError) {
                console.warn('Could not fetch MTSS data:', mtssError.message);
            }

            // 3. Get recent emotional check-ins (last 7 days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const recentCheckIns = await StudentEmotionalCheckin.find({
                userId: userId,
                date: { $gte: sevenDaysAgo }
            })
                .sort({ date: -1 })
                .limit(5)
                .lean();

            // 4. Analyze emotional patterns
            const emotionalSummary = this.analyzeEmotionalPatterns(recentCheckIns);

            // 5. Build context object
            const context = {
                student: {
                    name: studentName,
                    grade: studentGrade,
                    userId: userId.toString()
                },
                mtss: {
                    hasProfile: !!mtssProfile,
                    currentTier: this.getCurrentTier(activeInterventions),
                    activeInterventions: activeInterventions.map(int => ({
                        type: int.type,
                        tier: int.tier,
                        status: int.status,
                        notes: int.notes
                    })),
                    mentors: mentorAssignments.map(ma => ({
                        name: ma.mentorId?.name || 'Mentor',
                        focusAreas: ma.focusAreas || [],
                        tier: ma.tier,
                        progress: this.calculateProgress(ma)
                    })),
                    focusAreas: this.extractFocusAreas(mentorAssignments)
                },
                emotional: {
                    recentCheckIns: recentCheckIns.length,
                    summary: emotionalSummary,
                    lastCheckIn: recentCheckIns[0] ? {
                        date: recentCheckIns[0].date,
                        weatherType: recentCheckIns[0].weatherType,
                        moods: recentCheckIns[0].selectedMoods,
                        presenceLevel: recentCheckIns[0].presenceLevel,
                        capacityLevel: recentCheckIns[0].capacityLevel,
                        aiAnalysis: recentCheckIns[0].aiAnalysis
                    } : null
                }
            };

            return context;
        } catch (error) {
            console.error('Error building student context:', error);
            return {
                student: { name: 'Student', grade: 'unknown', userId: userId.toString() },
                mtss: { hasProfile: false, activeInterventions: [], mentors: [], focusAreas: [] },
                emotional: { recentCheckIns: 0, summary: {} }
            };
        }
    }

    /**
     * Analyze emotional patterns from check-ins
     */
    analyzeEmotionalPatterns(checkIns) {
        if (!checkIns || checkIns.length === 0) {
            return {
                trend: 'no_data',
                averagePresence: 0,
                averageCapacity: 0,
                commonMoods: [],
                commonWeather: []
            };
        }

        const presenceLevels = checkIns.map(c => c.presenceLevel).filter(Boolean);
        const capacityLevels = checkIns.map(c => c.capacityLevel).filter(Boolean);
        const allMoods = checkIns.flatMap(c => c.selectedMoods || []);
        const allWeather = checkIns.map(c => c.weatherType).filter(Boolean);

        const avgPresence = presenceLevels.length > 0
            ? presenceLevels.reduce((a, b) => a + b, 0) / presenceLevels.length
            : 0;
        const avgCapacity = capacityLevels.length > 0
            ? capacityLevels.reduce((a, b) => a + b, 0) / capacityLevels.length
            : 0;

        // Determine trend (improving, declining, stable)
        let trend = 'stable';
        if (presenceLevels.length >= 2) {
            const firstHalf = presenceLevels.slice(0, Math.ceil(presenceLevels.length / 2));
            const secondHalf = presenceLevels.slice(Math.ceil(presenceLevels.length / 2));
            const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
            const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

            if (avgSecond > avgFirst + 1) trend = 'improving';
            else if (avgSecond < avgFirst - 1) trend = 'declining';
        }

        // Count mood frequencies
        const moodCounts = {};
        allMoods.forEach(mood => {
            moodCounts[mood] = (moodCounts[mood] || 0) + 1;
        });
        const commonMoods = Object.entries(moodCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([mood]) => mood);

        // Count weather frequencies
        const weatherCounts = {};
        allWeather.forEach(weather => {
            weatherCounts[weather] = (weatherCounts[weather] || 0) + 1;
        });
        const commonWeather = Object.entries(weatherCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([weather]) => weather);

        return {
            trend,
            averagePresence: Math.round(avgPresence * 10) / 10,
            averageCapacity: Math.round(avgCapacity * 10) / 10,
            commonMoods,
            commonWeather
        };
    }

    /**
     * Get current highest tier from active interventions
     */
    getCurrentTier(interventions) {
        if (!interventions || interventions.length === 0) return null;

        const tierPriority = { tier3: 3, tier2: 2, tier1: 1 };
        let highestTier = null;
        let highestPriority = 0;

        interventions.forEach(int => {
            const priority = tierPriority[int.tier] || 0;
            if (priority > highestPriority) {
                highestPriority = priority;
                highestTier = int.tier;
            }
        });

        return highestTier;
    }

    /**
     * Calculate progress from mentor assignment
     */
    calculateProgress(assignment) {
        if (!assignment.checkIns || assignment.checkIns.length === 0) {
            return { percentage: 0, trend: 'new' };
        }

        const recentCheckIns = assignment.checkIns.slice(-3);
        if (recentCheckIns.length < 2) {
            return { percentage: 10, trend: 'starting' };
        }

        // Calculate trend based on values
        const values = recentCheckIns.map(c => c.value).filter(v => typeof v === 'number');
        if (values.length >= 2) {
            const firstVal = values[0];
            const lastVal = values[values.length - 1];
            const baseline = assignment.baselineScore?.value || firstVal;
            const target = assignment.targetScore?.value || (baseline * 1.2);

            const progress = ((lastVal - baseline) / (target - baseline)) * 100;
            const percentage = Math.max(0, Math.min(100, Math.round(progress)));

            const trend = lastVal > firstVal ? 'improving' : lastVal < firstVal ? 'declining' : 'stable';

            return { percentage, trend };
        }

        return { percentage: 25, trend: 'in_progress' };
    }

    /**
     * Extract focus areas from mentor assignments
     */
    extractFocusAreas(assignments) {
        if (!assignments || assignments.length === 0) return [];

        const areas = new Set();
        assignments.forEach(assignment => {
            (assignment.focusAreas || []).forEach(area => areas.add(area));
        });

        return Array.from(areas);
    }

    /**
     * Build AI system prompt with student context
     */
    buildSystemPrompt(context) {
        const { student, mtss, emotional } = context;

        let prompt = `You are a warm, supportive AI study companion for ${student.name}, a ${student.grade} grade student.

Your role is to:
- Be a friendly, encouraging study buddy who helps with homework and learning
- Provide emotional support and encouragement
- Help track progress and celebrate wins
- Suggest helpful study strategies
- Listen with empathy when they're struggling

Important guidelines:
- Use casual, age-appropriate language (like chatting with a friend)
- Be warm and encouraging, but never condescending
- Use emojis naturally (but don't overdo it)
- Keep responses concise (2-3 short paragraphs max)
- If they ask academic questions, help them understand concepts (don't just give answers)
- If they seem stressed or upset, acknowledge their feelings first
- Encourage them to talk to teachers/mentors when they need human support
- Never diagnose or give medical advice

CRITICAL LANGUAGE REQUIREMENT:
- You MUST ALWAYS respond in English, regardless of what language the student uses
- You can understand Indonesian, Malay, and other languages perfectly
- But ALL your responses must be in English only
- Example: If student writes "Bantuin PR Math dong", respond in English: "Of course! I'd be happy to help with your math homework. What topic are you working on?"
- Never switch to Indonesian or other languages in your responses

`;

        // Add MTSS context if available
        if (mtss.hasProfile && mtss.activeInterventions.length > 0) {
            prompt += `\nCurrent Academic Support Context:
`;
            mtss.activeInterventions.forEach(int => {
                prompt += `- ${student.name} is working on ${int.type.toLowerCase()} (${int.tier.replace('tier', 'Tier ')})\n`;
            });

            if (mtss.mentors.length > 0) {
                prompt += `\nMentors helping ${student.name}:\n`;
                mtss.mentors.forEach(mentor => {
                    prompt += `- ${mentor.name} (Focus: ${mentor.focusAreas.join(', ') || 'general support'})\n`;
                });
            }

            if (mtss.focusAreas.length > 0) {
                prompt += `\nCurrent focus areas: ${mtss.focusAreas.join(', ')}\n`;
            }
        }

        // Add emotional context if available
        if (emotional.lastCheckIn) {
            const checkIn = emotional.lastCheckIn;
            prompt += `\nRecent Emotional State:
- Last check-in: ${new Date(checkIn.date).toLocaleDateString()}
- Mood: ${checkIn.weatherType} (${checkIn.moods?.join(', ') || 'not specified'})
- Presence: ${checkIn.presenceLevel}/10, Capacity: ${checkIn.capacityLevel}/10
`;

            if (checkIn.aiAnalysis?.emotionalState) {
                prompt += `- Emotional state: ${checkIn.aiAnalysis.emotionalState}\n`;
            }

            if (emotional.summary.trend) {
                prompt += `- Recent trend: ${emotional.summary.trend}\n`;
            }

            if (emotional.summary.commonMoods.length > 0) {
                prompt += `- Common feelings recently: ${emotional.summary.commonMoods.join(', ')}\n`;
            }
        }

        prompt += `\nRemember:
- Address ${student.name} by name occasionally (not every message)
- Be supportive about their academic support programs (if mentioned)
- Acknowledge their emotional patterns naturally in conversation
- Celebrate small wins and progress
- Keep tone friendly, warm, and age-appropriate`;

        return prompt;
    }

    /**
     * Get or create conversation session
     */
    async getOrCreateConversation(userId, sessionId = null) {
        try {
            if (sessionId) {
                // Try to find existing conversation
                const conversation = await AIConversation.findOne({
                    userId,
                    sessionId,
                    status: 'active'
                });

                if (conversation) {
                    return conversation;
                }
            }

            // Create new conversation
            const newSessionId = sessionId || `chat_${Date.now()}_${userId}`;
            const conversation = new AIConversation({
                userId,
                sessionId: newSessionId,
                title: 'New Conversation',
                messages: [],
                status: 'active'
            });

            await conversation.save();
            return conversation;
        } catch (error) {
            console.error('Error getting/creating conversation:', error);
            throw error;
        }
    }

    /**
     * Generate AI response
     */
    async chat(userId, userMessage, sessionId = null) {
        try {
            // 1. Build student context
            const context = await this.buildStudentContext(userId);

            // 2. Get or create conversation
            const conversation = await this.getOrCreateConversation(userId, sessionId);

            // 3. Add user message to conversation
            conversation.messages.push({
                role: 'user',
                content: userMessage,
                timestamp: new Date()
            });

            // 4. Generate title if first message
            if (conversation.messages.filter(m => m.role === 'user').length === 1) {
                conversation.generateTitle();
            }

            // 5. Build AI prompt with context
            const systemPrompt = this.buildSystemPrompt(context);

            // 6. Prepare conversation history (limit to last N messages for context window)
            const recentMessages = conversation.messages.slice(-this.maxMessagesInContext);
            const conversationHistory = recentMessages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            }));

            // 7. Call Google AI
            if (!googleAI.isAvailable()) {
                throw new Error('AI service unavailable');
            }

            const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`;

            const aiResponse = await googleAI.generateContent(fullPrompt);

            // Extract response text
            const responseText = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
                aiResponse.candidates?.[0]?.content?.text ||
                "I'm here to help! Could you tell me more?";

            // 8. Add AI response to conversation
            conversation.messages.push({
                role: 'assistant',
                content: responseText.trim(),
                timestamp: new Date(),
                metadata: {
                    contextUsed: {
                        hasMTSSProfile: context.mtss.hasProfile,
                        hasEmotionalData: !!context.emotional.lastCheckIn,
                        activeInterventions: context.mtss.activeInterventions.length
                    }
                }
            });

            // 9. Detect patterns and update metadata
            this.detectPatternsAndUpdateMetadata(conversation, userMessage, responseText, context);

            // 10. Save conversation
            await conversation.save();

            // 11. Return response
            // Trigger alert generation every 10 messages after initial 15 messages (Phase 2 feature)
            // This prevents spam while still providing timely insights
            if (conversation.messages.length >= 15 && conversation.messages.length % 10 === 0) {
                // Run alert generation in background (non-blocking)
                setImmediate(async () => {
                    try {
                        const aiInsightService = require('./aiInsightService');
                        const result = await aiInsightService.generateTeacherAlerts(userId);
                        console.log(`🔔 Auto-generated ${result.count} alerts for ${context.student.name} (${result.skipped?.length || 0} skipped)`);
                    } catch (alertError) {
                        console.error('Error auto-generating alerts:', alertError.message);
                    }
                });
            }

            return {
                sessionId: conversation.sessionId,
                message: responseText.trim(),
                context: {
                    student: context.student,
                    hasSupport: context.mtss.hasProfile,
                    emotionalTrend: context.emotional.summary.trend
                }
            };

        } catch (error) {
            console.error('Error in AI chat:', error);

            // Fallback response
            return {
                sessionId: sessionId || `chat_${Date.now()}_${userId}`,
                message: "Sorry, I'm having some technical issues right now. Please try asking again! 😊",
                error: true
            };
        }
    }

    /**
     * Detect struggles and patterns from conversation
     */
    detectPatternsAndUpdateMetadata(conversation, userMessage, aiResponse, context) {
        const messageLower = userMessage.toLowerCase();

        // Detect academic struggles
        const academicKeywords = {
            math: ['math', 'matematika', 'fraction', 'pecahan', 'algebra', 'geometry'],
            english: ['english', 'bahasa inggris', 'grammar', 'vocab', 'reading'],
            science: ['science', 'sains', 'physics', 'fisika', 'chemistry', 'kimia'],
            general: ['homework', 'pr', 'tugas', 'bingung', 'stuck', 'susah', 'sulit']
        };

        Object.entries(academicKeywords).forEach(([subject, keywords]) => {
            keywords.forEach(keyword => {
                if (messageLower.includes(keyword)) {
                    // Check if already detected
                    const existing = conversation.detectedStruggles.find(
                        s => s.subject === subject && s.specificArea === keyword
                    );

                    if (!existing) {
                        conversation.detectedStruggles.push({
                            subject,
                            specificArea: keyword,
                            severity: 'medium',
                            detectedAt: new Date(),
                            resolved: false
                        });
                    }
                }
            });
        });

        // Detect emotional keywords
        const emotionalKeywords = {
            stressed: ['stress', 'cemas', 'anxious', 'worried', 'takut', 'nervous'],
            tired: ['capek', 'tired', 'exhausted', 'ngantuk', 'sleepy'],
            happy: ['happy', 'senang', 'excited', 'good', 'bagus'],
            sad: ['sad', 'sedih', 'down', 'upset']
        };

        Object.entries(emotionalKeywords).forEach(([emotion, keywords]) => {
            keywords.forEach(keyword => {
                if (messageLower.includes(keyword)) {
                    conversation.emotionalJourney.push({
                        emotion,
                        valence: ['happy', 'excited'].includes(emotion) ? 1 : -0.5,
                        timestamp: new Date(),
                        context: userMessage.substring(0, 100)
                    });
                }
            });
        });

        // Detect topics
        const topics = ['homework', 'test', 'quiz', 'project', 'friend', 'teacher', 'school'];
        topics.forEach(topic => {
            if (messageLower.includes(topic)) {
                const existing = conversation.detectedTopics.find(t => t.topic === topic);
                if (existing) {
                    existing.frequency++;
                    existing.lastMentioned = new Date();
                } else {
                    conversation.detectedTopics.push({
                        topic,
                        frequency: 1,
                        firstMentioned: new Date(),
                        lastMentioned: new Date()
                    });
                }
            }
        });
    }

    /**
     * Get conversation history
     */
    async getConversationHistory(userId, sessionId, limit = 50) {
        try {
            const conversation = await AIConversation.findOne({
                userId,
                sessionId,
                status: 'active'
            }).lean();

            if (!conversation) {
                return {
                    sessionId,
                    messages: [],
                    exists: false
                };
            }

            const messages = conversation.messages
                .slice(-limit)
                .map(msg => ({
                    role: msg.role,
                    content: msg.content,
                    timestamp: msg.timestamp
                }));

            return {
                sessionId: conversation.sessionId,
                title: conversation.title,
                messages,
                exists: true
            };
        } catch (error) {
            console.error('Error getting conversation history:', error);
            return {
                sessionId,
                messages: [],
                exists: false,
                error: error.message
            };
        }
    }

    /**
     * Get recent conversations for a user
     */
    async getUserConversations(userId, limit = 10) {
        try {
            const conversations = await AIConversation.find({
                userId,
                status: 'active'
            })
                .sort({ lastActivity: -1 })
                .limit(limit)
                .select('sessionId title lastActivity messages')
                .lean();

            return conversations.map(conv => ({
                sessionId: conv.sessionId,
                title: conv.title,
                lastActivity: conv.lastActivity,
                messageCount: conv.messages?.length || 0,
                preview: conv.messages?.[conv.messages.length - 1]?.content.substring(0, 50) || ''
            }));
        } catch (error) {
            console.error('Error getting user conversations:', error);
            return [];
        }
    }
}

module.exports = new AIChatService();
