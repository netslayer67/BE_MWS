const AIConversation = require('../models/AIConversation');
const TeacherAlert = require('../models/TeacherAlert');
const MTSSStudent = require('../models/MTSSStudent');
const MentorAssignment = require('../models/MentorAssignment');
const User = require('../models/User');

/**
 * AI Insight Service - Phase 2
 * Analyzes student conversations to detect patterns, learning styles, and generate teacher alerts
 */
class AIInsightService {
    constructor() {
        // Learning style indicators
        this.learningStyleIndicators = {
            visual: [
                'see', 'look', 'picture', 'diagram', 'chart', 'image', 'color', 'video',
                'show me', 'visualize', 'imagine', 'lihat', 'gambar'
            ],
            auditory: [
                'hear', 'listen', 'sound', 'explain', 'tell', 'discuss', 'talk',
                'dengar', 'jelaskan', 'cerita'
            ],
            kinesthetic: [
                'do', 'practice', 'hands-on', 'try', 'build', 'make', 'experiment',
                'coba', 'praktek', 'bikin'
            ],
            reading_writing: [
                'read', 'write', 'note', 'list', 'summary', 'text', 'book',
                'baca', 'tulis', 'catatan'
            ]
        };

        // Academic subject patterns
        this.subjectKeywords = {
            Mathematics: ['math', 'matematika', 'number', 'angka', 'calculate', 'hitung', 'equation', 'persamaan', 'geometry', 'algebra', 'fraction', 'pecahan'],
            Science: ['science', 'sains', 'experiment', 'percobaan', 'biology', 'biologi', 'chemistry', 'kimia', 'physics', 'fisika'],
            English: ['english', 'bahasa inggris', 'grammar', 'vocabulary', 'reading', 'writing', 'essay'],
            Indonesian: ['indonesian', 'bahasa indonesia', 'pantun', 'puisi', 'cerpen', 'novel'],
            'Social Studies': ['history', 'sejarah', 'geography', 'geografi', 'social', 'sosial', 'culture', 'budaya'],
            Art: ['art', 'seni', 'draw', 'gambar', 'paint', 'musik', 'music'],
            PE: ['sport', 'olahraga', 'physical', 'exercise', 'gym', 'game']
        };

        // Struggle indicators
        this.struggleIndicators = {
            understanding: ['don\'t understand', 'confused', 'bingung', 'tidak mengerti', 'gak ngerti', 'gimana', 'what does', 'maksudnya'],
            application: ['how to use', 'bagaimana cara', 'when to use', 'kapan pakai', 'apply', 'praktik'],
            memorization: ['forget', 'lupa', 'remember', 'ingat', 'memorize', 'hafal'],
            motivation: ['boring', 'membosankan', 'tired', 'capek', 'give up', 'menyerah', 'sulit', 'difficult', 'hard']
        };
    }

    /**
     * Analyze student's conversation history and detect patterns
     */
    async analyzeStudentPatterns(userId, timeRange = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - timeRange);

            // Get all conversations in time range
            const conversations = await AIConversation.find({
                userId,
                createdAt: { $gte: startDate }
            }).sort({ createdAt: -1 }).lean();

            if (conversations.length === 0) {
                return {
                    hasEnoughData: false,
                    message: 'Not enough conversation data for analysis'
                };
            }

            // Aggregate all messages
            const allMessages = [];
            conversations.forEach(conv => {
                conv.messages.forEach(msg => {
                    if (msg.role === 'user') {
                        allMessages.push({
                            content: msg.content.toLowerCase(),
                            timestamp: msg.timestamp,
                            conversationId: conv._id
                        });
                    }
                });
            });

            // Run all analyses
            const [
                learningStyle,
                academicPatterns,
                strugglePatterns,
                emotionalPatterns,
                topicFrequency
            ] = await Promise.all([
                this.detectLearningStyle(allMessages),
                this.detectAcademicPatterns(allMessages),
                this.detectStrugglePatterns(allMessages),
                this.analyzeEmotionalPatterns(conversations),
                this.analyzeTopicFrequency(allMessages)
            ]);

            return {
                hasEnoughData: true,
                totalMessages: allMessages.length,
                totalConversations: conversations.length,
                timeRange,
                learningStyle,
                academicPatterns,
                strugglePatterns,
                emotionalPatterns,
                topicFrequency,
                analyzedAt: new Date()
            };
        } catch (error) {
            console.error('Error analyzing student patterns:', error);
            throw error;
        }
    }

    /**
     * Detect student's learning style based on language patterns
     */
    async detectLearningStyle(messages) {
        const scores = {
            visual: 0,
            auditory: 0,
            kinesthetic: 0,
            reading_writing: 0
        };

        const indicators = {
            visual: [],
            auditory: [],
            kinesthetic: [],
            reading_writing: []
        };

        messages.forEach(msg => {
            Object.entries(this.learningStyleIndicators).forEach(([style, keywords]) => {
                keywords.forEach(keyword => {
                    if (msg.content.includes(keyword)) {
                        scores[style]++;
                        if (!indicators[style].includes(keyword)) {
                            indicators[style].push(keyword);
                        }
                    }
                });
            });
        });

        // Find dominant style
        let maxScore = 0;
        let primaryStyle = 'mixed';

        Object.entries(scores).forEach(([style, score]) => {
            if (score > maxScore) {
                maxScore = score;
                primaryStyle = style;
            }
        });

        // Calculate confidence (0-100)
        const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
        const confidence = totalScore > 0 ? Math.round((maxScore / totalScore) * 100) : 0;

        // If scores are too close, it's mixed style
        const secondHighest = Object.values(scores).sort((a, b) => b - a)[1];
        if (maxScore > 0 && secondHighest / maxScore > 0.7) {
            primaryStyle = 'mixed';
        }

        return {
            primary: primaryStyle,
            confidence,
            scores,
            indicators: indicators[primaryStyle] || [],
            breakdown: Object.entries(scores).map(([style, score]) => ({
                style,
                score,
                percentage: totalScore > 0 ? Math.round((score / totalScore) * 100) : 0
            }))
        };
    }

    /**
     * Detect academic patterns and subject preferences
     */
    async detectAcademicPatterns(messages) {
        const subjectMentions = {};
        const subjectMessages = {};

        Object.keys(this.subjectKeywords).forEach(subject => {
            subjectMentions[subject] = 0;
            subjectMessages[subject] = [];
        });

        messages.forEach(msg => {
            Object.entries(this.subjectKeywords).forEach(([subject, keywords]) => {
                keywords.forEach(keyword => {
                    if (msg.content.includes(keyword)) {
                        subjectMentions[subject]++;
                        if (subjectMessages[subject].length < 5) {
                            subjectMessages[subject].push({
                                excerpt: msg.content.substring(0, 100),
                                timestamp: msg.timestamp
                            });
                        }
                    }
                });
            });
        });

        // Filter subjects with mentions
        const activeSubjects = Object.entries(subjectMentions)
            .filter(([_, count]) => count > 0)
            .map(([subject, count]) => ({
                subject,
                mentions: count,
                percentage: Math.round((count / messages.length) * 100),
                examples: subjectMessages[subject]
            }))
            .sort((a, b) => b.mentions - a.mentions);

        return {
            totalSubjectsDiscussed: activeSubjects.length,
            mostDiscussed: activeSubjects[0]?.subject || null,
            subjects: activeSubjects
        };
    }

    /**
     * Detect struggle patterns
     */
    async detectStrugglePatterns(messages) {
        const struggles = {};

        Object.keys(this.struggleIndicators).forEach(type => {
            struggles[type] = {
                count: 0,
                examples: [],
                subjects: {}
            };
        });

        messages.forEach(msg => {
            // Check struggle indicators
            Object.entries(this.struggleIndicators).forEach(([type, indicators]) => {
                indicators.forEach(indicator => {
                    if (msg.content.includes(indicator)) {
                        struggles[type].count++;

                        if (struggles[type].examples.length < 3) {
                            struggles[type].examples.push({
                                text: msg.content.substring(0, 100),
                                timestamp: msg.timestamp
                            });
                        }

                        // Link to subject if mentioned
                        Object.entries(this.subjectKeywords).forEach(([subject, keywords]) => {
                            if (keywords.some(kw => msg.content.includes(kw))) {
                                struggles[type].subjects[subject] = (struggles[type].subjects[subject] || 0) + 1;
                            }
                        });
                    }
                });
            });
        });

        // Convert to array and sort by count
        const struggleArray = Object.entries(struggles)
            .filter(([_, data]) => data.count > 0)
            .map(([type, data]) => ({
                type,
                count: data.count,
                examples: data.examples,
                affectedSubjects: Object.entries(data.subjects)
                    .map(([subject, count]) => ({ subject, count }))
                    .sort((a, b) => b.count - a.count)
            }))
            .sort((a, b) => b.count - a.count);

        return {
            hasStruggles: struggleArray.length > 0,
            totalStruggleMessages: struggleArray.reduce((sum, s) => sum + s.count, 0),
            dominantStruggle: struggleArray[0]?.type || null,
            struggles: struggleArray
        };
    }

    /**
     * Analyze emotional patterns from conversation metadata
     */
    async analyzeEmotionalPatterns(conversations) {
        const emotionCounts = {};
        const emotionTimeline = [];

        conversations.forEach(conv => {
            if (conv.emotionalJourney && conv.emotionalJourney.length > 0) {
                conv.emotionalJourney.forEach(ej => {
                    emotionCounts[ej.emotion] = (emotionCounts[ej.emotion] || 0) + 1;
                    emotionTimeline.push({
                        emotion: ej.emotion,
                        timestamp: ej.detectedAt,
                        intensity: ej.intensity
                    });
                });
            }
        });

        // Sort emotions by frequency
        const emotionBreakdown = Object.entries(emotionCounts)
            .map(([emotion, count]) => ({ emotion, count }))
            .sort((a, b) => b.count - a.count);

        // Determine trend
        let trend = 'stable';
        if (emotionTimeline.length >= 5) {
            const firstHalf = emotionTimeline.slice(0, Math.floor(emotionTimeline.length / 2));
            const secondHalf = emotionTimeline.slice(Math.floor(emotionTimeline.length / 2));

            const negativeEmotions = ['stressed', 'sad', 'anxious', 'tired'];
            const firstNegative = firstHalf.filter(e => negativeEmotions.includes(e.emotion)).length / firstHalf.length;
            const secondNegative = secondHalf.filter(e => negativeEmotions.includes(e.emotion)).length / secondHalf.length;

            if (secondNegative > firstNegative + 0.2) trend = 'declining';
            else if (secondNegative < firstNegative - 0.2) trend = 'improving';
        }

        return {
            dominantEmotion: emotionBreakdown[0]?.emotion || 'neutral',
            trend,
            breakdown: emotionBreakdown,
            timeline: emotionTimeline.slice(-10) // Last 10 emotions
        };
    }

    /**
     * Analyze topic frequency
     */
    async analyzeTopicFrequency(messages) {
        const topics = {};

        messages.forEach(msg => {
            const words = msg.content.split(/\s+/).filter(w => w.length > 4);
            words.forEach(word => {
                topics[word] = (topics[word] || 0) + 1;
            });
        });

        // Filter and sort
        const topicArray = Object.entries(topics)
            .filter(([_, count]) => count >= 3) // At least 3 mentions
            .map(([topic, count]) => ({ topic, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20); // Top 20

        return topicArray;
    }

    /**
     * Check if similar alert exists recently (anti-spam)
     */
    async hasRecentSimilarAlert(studentId, alertType, timeframeHours = 72) {
        const cutoff = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);

        const recentAlert = await TeacherAlert.findOne({
            studentId,
            alertType,
            generatedAt: { $gte: cutoff },
            status: { $ne: 'dismissed' }
        });

        return !!recentAlert;
    }

    /**
     * Generate teacher alerts based on analysis (with anti-spam logic)
     */
    async generateTeacherAlerts(userId) {
        try {
            // Get user and MTSS profile
            const user = await User.findById(userId).lean();
            if (!user) throw new Error('User not found');

            const mtssStudent = await MTSSStudent.findOne({
                $or: [
                    { email: user.email },
                    { name: { $regex: new RegExp(user.name, 'i') } }
                ]
            }).lean();

            // Get analysis
            const analysis = await this.analyzeStudentPatterns(userId);

            if (!analysis.hasEnoughData) {
                return { alerts: [], message: 'Not enough data for alerts' };
            }

            const alerts = [];
            const skippedAlerts = [];

            // 1. Check for learning style detection (only if confident)
            // Cooldown: 30 days (learning style rarely changes)
            if (analysis.learningStyle.confidence >= 70 && analysis.learningStyle.primary !== 'mixed') {
                const hasRecent = await this.hasRecentSimilarAlert(userId, 'learning_style_detected', 30 * 24);

                if (!hasRecent) {
                    alerts.push(this.createLearningStyleAlert(user, analysis.learningStyle, mtssStudent));
                } else {
                    skippedAlerts.push({ type: 'learning_style_detected', reason: 'Recent alert exists' });
                }
            }

            // 2. Check for academic struggles
            // Cooldown: 5 days (struggles need time to address)
            // Threshold: Only alert if mentioned 5+ times (avoid false positives)
            if (analysis.strugglePatterns.hasStruggles) {
                const dominantStruggle = analysis.strugglePatterns.struggles[0];

                if (dominantStruggle.count >= 5) { // Mentioned 5+ times
                    const hasRecent = await this.hasRecentSimilarAlert(userId, 'academic_struggle', 5 * 24);

                    if (!hasRecent) {
                        alerts.push(this.createAcademicStruggleAlert(user, analysis, mtssStudent));
                    } else {
                        skippedAlerts.push({ type: 'academic_struggle', reason: 'Alert generated within last 5 days' });
                    }
                }
            }

            // 3. Check for emotional concerns
            // Cooldown: 7 days (emotional patterns need monitoring time)
            if (analysis.emotionalPatterns.trend === 'declining') {
                const hasRecent = await this.hasRecentSimilarAlert(userId, 'emotional_pattern', 7 * 24);

                if (!hasRecent) {
                    alerts.push(this.createEmotionalPatternAlert(user, analysis.emotionalPatterns, mtssStudent));
                } else {
                    skippedAlerts.push({ type: 'emotional_pattern', reason: 'Alert generated within last 7 days' });
                }
            }

            // 4. Check for low engagement
            // Cooldown: 14 days (give student time to engage)
            // Only alert if truly low engagement (< 3 conversations in 14+ days)
            if (analysis.totalConversations < 3 && analysis.timeRange >= 14) {
                const hasRecent = await this.hasRecentSimilarAlert(userId, 'engagement_low', 14 * 24);

                if (!hasRecent) {
                    alerts.push(this.createLowEngagementAlert(user, analysis, mtssStudent));
                } else {
                    skippedAlerts.push({ type: 'engagement_low', reason: 'Alert generated within last 14 days' });
                }
            }

            // 5. Check for breakthrough (positive pattern)
            // Cooldown: 7 days (celebrate progress periodically, not constantly)
            if (analysis.emotionalPatterns.trend === 'improving' && analysis.strugglePatterns.totalStruggleMessages === 0) {
                const hasRecent = await this.hasRecentSimilarAlert(userId, 'breakthrough', 7 * 24);

                if (!hasRecent) {
                    alerts.push(this.createBreakthroughAlert(user, analysis, mtssStudent));
                } else {
                    skippedAlerts.push({ type: 'breakthrough', reason: 'Alert generated within last 7 days' });
                }
            }

            // Save all alerts (if any)
            let savedAlerts = [];
            if (alerts.length > 0) {
                savedAlerts = await Promise.all(
                    alerts.map(alert => new TeacherAlert(alert).save())
                );

                console.log(`✅ Generated ${savedAlerts.length} new alerts for ${user.name}`);
            }

            if (skippedAlerts.length > 0) {
                console.log(`⏭️ Skipped ${skippedAlerts.length} alerts due to cooldown:`, skippedAlerts);
            }

            return {
                alerts: savedAlerts,
                count: savedAlerts.length,
                skipped: skippedAlerts,
                analysis,
                message: `Generated ${savedAlerts.length} alerts, skipped ${skippedAlerts.length} due to recent alerts`
            };
        } catch (error) {
            console.error('Error generating teacher alerts:', error);
            throw error;
        }
    }

    /**
     * Helper methods to create different types of alerts
     */
    createLearningStyleAlert(user, learningStyle, mtssStudent) {
        const styleDescriptions = {
            visual: 'learns best through images, diagrams, and visual demonstrations',
            auditory: 'learns best through verbal explanations and discussions',
            kinesthetic: 'learns best through hands-on activities and practice',
            reading_writing: 'learns best through reading and taking notes'
        };

        const recommendations = {
            visual: [
                { action: 'Use visual aids (diagrams, charts, videos)', priority: 'high', rationale: 'Student shows strong preference for visual learning' },
                { action: 'Encourage mind mapping and visual note-taking', priority: 'medium', rationale: 'Helps student organize information visually' }
            ],
            auditory: [
                { action: 'Provide verbal explanations and encourage discussions', priority: 'high', rationale: 'Student learns well through listening' },
                { action: 'Use audio resources and group discussions', priority: 'medium', rationale: 'Reinforces learning through auditory channels' }
            ],
            kinesthetic: [
                { action: 'Incorporate hands-on activities and experiments', priority: 'high', rationale: 'Student needs physical engagement to learn' },
                { action: 'Allow movement breaks and practice exercises', priority: 'medium', rationale: 'Helps maintain focus and retention' }
            ],
            reading_writing: [
                { action: 'Provide written materials and encourage note-taking', priority: 'high', rationale: 'Student processes information best through text' },
                { action: 'Assign written summaries and reflections', priority: 'medium', rationale: 'Reinforces learning through writing' }
            ]
        };

        return {
            studentId: user._id,
            studentName: user.name,
            alertType: 'learning_style_detected',
            severity: 'low',
            title: `Learning Style Identified: ${learningStyle.primary.replace('_', ' ')}`,
            message: `AI has detected that ${user.name} ${styleDescriptions[learningStyle.primary]}. Confidence: ${learningStyle.confidence}%`,
            insights: {
                patterns: [{
                    category: 'learning_style',
                    description: `Detected ${learningStyle.primary} learning preference`,
                    frequency: learningStyle.scores[learningStyle.primary],
                    firstDetected: new Date(),
                    lastDetected: new Date(),
                    confidence: learningStyle.confidence
                }],
                learningStyle: {
                    primary: learningStyle.primary,
                    confidence: learningStyle.confidence,
                    indicators: learningStyle.indicators
                },
                struggles: [],
                recommendations: recommendations[learningStyle.primary] || []
            },
            mtssStudentId: mtssStudent?._id,
            priorityScore: 30
        };
    }

    createAcademicStruggleAlert(user, analysis, mtssStudent) {
        const dominantStruggle = analysis.strugglePatterns.struggles[0];
        const affectedSubject = dominantStruggle.affectedSubjects[0];

        const severity = dominantStruggle.count >= 10 ? 'high' : dominantStruggle.count >= 7 ? 'medium' : 'low';

        return {
            studentId: user._id,
            studentName: user.name,
            alertType: 'academic_struggle',
            severity,
            title: `Academic Struggle Detected: ${affectedSubject?.subject || 'Multiple Subjects'}`,
            message: `${user.name} is showing repeated ${dominantStruggle.type} difficulties${affectedSubject ? ` in ${affectedSubject.subject}` : ''}. Detected ${dominantStruggle.count} times in recent conversations.`,
            insights: {
                patterns: [{
                    category: affectedSubject?.subject || 'general',
                    description: `${dominantStruggle.type} difficulties`,
                    frequency: dominantStruggle.count,
                    firstDetected: dominantStruggle.examples[0]?.timestamp,
                    lastDetected: dominantStruggle.examples[dominantStruggle.examples.length - 1]?.timestamp,
                    confidence: 85
                }],
                struggles: [{
                    subject: affectedSubject?.subject || 'General',
                    topic: 'Multiple topics',
                    difficulty: dominantStruggle.type,
                    occurrences: dominantStruggle.count,
                    examples: dominantStruggle.examples.map(e => e.text)
                }],
                recommendations: [
                    { action: 'Schedule one-on-one tutoring session', priority: 'high', rationale: `Student needs targeted support for ${dominantStruggle.type}` },
                    { action: 'Provide additional practice materials', priority: 'medium', rationale: 'Help reinforce understanding' },
                    { action: 'Consider peer study group', priority: 'low', rationale: 'Collaborative learning may help' }
                ]
            },
            mtssStudentId: mtssStudent?._id,
            priorityScore: severity === 'high' ? 75 : severity === 'medium' ? 60 : 45
        };
    }

    createEmotionalPatternAlert(user, emotionalPatterns, mtssStudent) {
        return {
            studentId: user._id,
            studentName: user.name,
            alertType: 'emotional_pattern',
            severity: 'medium',
            title: 'Declining Emotional Wellbeing Detected',
            message: `${user.name}'s emotional state is trending downward. Recent dominant emotion: ${emotionalPatterns.dominantEmotion}`,
            insights: {
                patterns: [{
                    category: 'emotional_wellbeing',
                    description: 'Declining trend in emotional state',
                    frequency: emotionalPatterns.breakdown.length,
                    firstDetected: emotionalPatterns.timeline[0]?.timestamp,
                    lastDetected: emotionalPatterns.timeline[emotionalPatterns.timeline.length - 1]?.timestamp,
                    confidence: 75
                }],
                emotionalState: {
                    recent: emotionalPatterns.dominantEmotion,
                    trend: emotionalPatterns.trend,
                    concerningPatterns: [emotionalPatterns.dominantEmotion]
                },
                recommendations: [
                    { action: 'Check in with student personally', priority: 'high', rationale: 'Emotional wellbeing affecting learning' },
                    { action: 'Consider counselor referral if pattern continues', priority: 'medium', rationale: 'Professional support may be needed' }
                ]
            },
            mtssStudentId: mtssStudent?._id,
            priorityScore: 65
        };
    }

    createLowEngagementAlert(user, analysis, mtssStudent) {
        return {
            studentId: user._id,
            studentName: user.name,
            alertType: 'engagement_low',
            severity: 'medium',
            title: 'Low Engagement with AI Study Buddy',
            message: `${user.name} has only used the AI Study Buddy ${analysis.totalConversations} times in the past ${analysis.timeRange} days.`,
            insights: {
                patterns: [{
                    category: 'engagement',
                    description: 'Low usage of learning support tools',
                    frequency: analysis.totalConversations,
                    confidence: 80
                }],
                recommendations: [
                    { action: 'Encourage student to use AI Study Buddy', priority: 'medium', rationale: 'Tool may help with academic struggles' },
                    { action: 'Demonstrate AI Study Buddy features', priority: 'low', rationale: 'Student may not know how to use it effectively' }
                ]
            },
            mtssStudentId: mtssStudent?._id,
            priorityScore: 40
        };
    }

    createBreakthroughAlert(user, analysis, mtssStudent) {
        return {
            studentId: user._id,
            studentName: user.name,
            alertType: 'breakthrough',
            severity: 'low',
            title: 'Positive Progress Detected! 🎉',
            message: `${user.name} is showing great improvement! Emotional state is improving and showing fewer struggles.`,
            insights: {
                patterns: [{
                    category: 'progress',
                    description: 'Positive trend in engagement and emotional wellbeing',
                    confidence: 75
                }],
                emotionalState: {
                    recent: analysis.emotionalPatterns.dominantEmotion,
                    trend: 'improving'
                },
                recommendations: [
                    { action: 'Acknowledge and celebrate progress', priority: 'high', rationale: 'Positive reinforcement encourages continued effort' },
                    { action: 'Consider student as peer mentor', priority: 'low', rationale: 'Student showing mastery could help others' }
                ]
            },
            mtssStudentId: mtssStudent?._id,
            priorityScore: 20
        };
    }
}

module.exports = new AIInsightService();
