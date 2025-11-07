// Enhance AI analysis with user reflection context
const enhanceAIAnalysisWithUserContext = async (aiAnalysis, checkinData) => {
    try {
        const userReflection = checkinData.userReflection?.toLowerCase() || '';
        const detectedEmotion = checkinData.aiEmotionScan?.detectedEmotion?.toLowerCase() || 'neutral';

        // Enhanced motivational messages based on user context
        const getContextualMotivationalMessage = () => {
            // Work/stress related triggers
            if (userReflection.includes('meeting') || userReflection.includes('work') || userReflection.includes('stress') || userReflection.includes('deadline')) {
                if (detectedEmotion.includes('anxious') || detectedEmotion.includes('stressed')) {
                    return "Remember that your dedication to excellence is what makes you so valuable. Take a moment to breathe and know that you've handled challenging situations before - you have the strength to navigate this too.";
                } else if (detectedEmotion.includes('tired') || detectedEmotion.includes('exhausted')) {
                    return "Your commitment to your work is truly admirable. In moments like these, remember that rest isn't weakness - it's the wisdom that allows you to bring your best self to everything you do.";
                }
            }

            // Relationship/family triggers
            if (userReflection.includes('family') || userReflection.includes('friend') || userReflection.includes('relationship') || userReflection.includes('partner')) {
                if (detectedEmotion.includes('sad') || detectedEmotion.includes('lonely')) {
                    return "The depth of love and connection you feel for others is one of your greatest strengths. Even in difficult moments, this capacity for caring shows what a beautiful heart you have.";
                } else if (detectedEmotion.includes('happy') || detectedEmotion.includes('grateful')) {
                    return "The relationships that bring you joy are treasures worth celebrating. Your ability to connect deeply with others is a gift not just to them, but to your own soul as well.";
                }
            }

            // Personal growth/health triggers
            if (userReflection.includes('health') || userReflection.includes('tired') || userReflection.includes('sick') || userReflection.includes('rest')) {
                if (detectedEmotion.includes('anxious') || detectedEmotion.includes('worried')) {
                    return "Your awareness of your body's needs shows such self-compassion. Trust that you're capable of nurturing yourself through this. Your body and mind work together beautifully when given the care they deserve.";
                } else if (detectedEmotion.includes('calm') || detectedEmotion.includes('peaceful')) {
                    return "What a beautiful act of self-love it is to listen to your body's wisdom. This awareness and care you show yourself will serve you beautifully in all areas of your life.";
                }
            }

            // Achievement/success triggers
            if (userReflection.includes('success') || userReflection.includes('achievement') || userReflection.includes('proud') || userReflection.includes('accomplish')) {
                if (detectedEmotion.includes('happy') || detectedEmotion.includes('excited')) {
                    return "Your ability to recognize and celebrate your achievements shows such healthy self-awareness. This joy in your accomplishments is well-earned and beautifully deserved.";
                } else if (detectedEmotion.includes('overwhelmed') || detectedEmotion.includes('anxious')) {
                    return "Even in moments of pressure, your drive for excellence shines through. Remember that your worth isn't measured by perfection, but by the beautiful effort you bring to everything you do.";
                }
            }

            // Default contextual motivation based on emotion
            if (detectedEmotion.includes('happy') || detectedEmotion.includes('joy')) {
                return "Whatever is bringing this light to your eyes, may it continue to nourish your spirit. Your capacity for joy is a beautiful gift to yourself and everyone around you.";
            } else if (detectedEmotion.includes('sad') || detectedEmotion.includes('challenging')) {
                return "Your willingness to feel deeply, even when it brings sadness, shows what a beautifully sensitive soul you are. This emotional depth is a strength, not a weakness.";
            } else if (detectedEmotion.includes('anxious') || detectedEmotion.includes('worried')) {
                return "Your awareness of uncertainty shows how deeply you care about navigating life thoughtfully. This mindfulness, even when it brings anxiety, is a sign of your wisdom and care.";
            } else {
                throw new Error('Unable to generate personalized motivational message');
            }
        };

        // Enhanced psychological insights with user context
        const getEnhancedPsychologicalInsights = () => {
            const baseInsight = aiAnalysis.psychologicalInsights || '';
            const contextKeywords = userReflection.split(' ').filter(word => word.length > 3);

            let enhancedInsight = baseInsight;

            // Add contextual depth based on user reflection
            if (contextKeywords.some(word => ['meeting', 'presentation', 'deadline', 'work'].includes(word))) {
                enhancedInsight += " The professional demands you're navigating show your dedication and capability. Even when these responsibilities feel heavy, they also reflect the trust others place in your abilities.";
            } else if (contextKeywords.some(word => ['family', 'children', 'partner', 'relationship'].includes(word))) {
                enhancedInsight += " The connections that matter to you speak to your capacity for deep, meaningful relationships. This emotional investment, while sometimes challenging, is also what makes life rich and beautiful.";
            } else if (contextKeywords.some(word => ['tired', 'exhausted', 'rest', 'sleep'].includes(word))) {
                enhancedInsight += " Your body's signals for rest are wisdom speaking. In our achievement-oriented world, listening to these needs takes courage and shows true self-awareness.";
            } else if (contextKeywords.some(word => ['grateful', 'thankful', 'blessed', 'appreciate'].includes(word))) {
                enhancedInsight += " Your ability to recognize and appreciate life's blessings, even amidst challenges, is a beautiful emotional strength that nourishes both you and those around you.";
            }

            return enhancedInsight;
        };

        // Return enhanced analysis
        return {
            ...aiAnalysis,
            motivationalMessage: getContextualMotivationalMessage(),
            psychologicalInsights: getEnhancedPsychologicalInsights(),
            enhancedWithUserContext: true,
            userContextKeywords: userReflection.split(' ').filter(word => word.length > 3)
        };

    } catch (error) {
        console.error('Error enhancing AI analysis with user context:', error);
        return aiAnalysis; // Return original analysis if enhancement fails
    }
};

// Update user's emotional patterns for AI learning
const updateUserEmotionalPatterns = async (userId, aiEmotionScan, userReflection) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');

        if (!aiEmotionScan) return;

        // Get user's recent emotional history (last 30 check-ins)
        const recentCheckins = await EmotionalCheckin.find({
            userId,
            aiEmotionScan: { $exists: true }
        })
            .sort({ submittedAt: -1 })
            .limit(30)
            .select('aiEmotionScan emotionalPatterns userReflection');

        // Calculate baseline emotions
        const emotionHistory = recentCheckins
            .filter(checkin => checkin.aiEmotionScan)
            .map(checkin => ({
                emotion: checkin.aiEmotionScan.detectedEmotion,
                valence: checkin.aiEmotionScan.valence,
                arousal: checkin.aiEmotionScan.arousal,
                intensity: checkin.aiEmotionScan.intensity,
                context: checkin.userReflection || checkin.details || '',
                timestamp: checkin.submittedAt
            }));

        // Add current emotion to history
        emotionHistory.unshift({
            emotion: aiEmotionScan.detectedEmotion,
            valence: aiEmotionScan.valence,
            arousal: aiEmotionScan.arousal,
            intensity: aiEmotionScan.intensity,
            context: userReflection || '',
            timestamp: new Date()
        });

        // Calculate averages
        const totalCheckins = emotionHistory.length;
        const avgValence = emotionHistory.reduce((sum, e) => sum + e.valence, 0) / totalCheckins;
        const avgArousal = emotionHistory.reduce((sum, e) => sum + e.arousal, 0) / totalCheckins;

        // Identify common triggers from user reflections
        const commonTriggers = [];
        const triggerWords = emotionHistory
            .filter(e => e.context)
            .map(e => e.context.toLowerCase())
            .join(' ')
            .split(/\s+/)
            .filter(word => word.length > 3);

        // Count word frequency
        const wordCount = {};
        triggerWords.forEach(word => {
            wordCount[word] = (wordCount[word] || 0) + 1;
        });

        // Get top triggers
        commonTriggers.push(...Object.entries(wordCount)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([word]) => word));

        // Calculate emotional stability (lower variability = higher stability)
        const valenceVariance = emotionHistory.reduce((sum, e) => sum + Math.pow(e.valence - avgValence, 2), 0) / totalCheckins;
        const arousalVariance = emotionHistory.reduce((sum, e) => sum + Math.pow(e.arousal - avgArousal, 2), 0) / totalCheckins;
        const emotionalStability = Math.max(0, 1 - (valenceVariance + arousalVariance) / 2);

        // Generate learned insights based on patterns
        const learnedInsights = [];

        if (totalCheckins >= 5) {
            // High arousal pattern
            if (avgArousal > 0.3) {
                learnedInsights.push({
                    insight: "You tend to experience higher emotional activation. Consider incorporating more calming practices into your routine.",
                    confidence: Math.min(90, totalCheckins * 3)
                });
            }

            // Low valence pattern
            if (avgValence < -0.2) {
                learnedInsights.push({
                    insight: "Your emotional valence patterns suggest you may benefit from activities that boost positive emotional experiences.",
                    confidence: Math.min(85, totalCheckins * 3)
                });
            }

            // High stability
            if (emotionalStability > 0.7) {
                learnedInsights.push({
                    insight: "You demonstrate strong emotional stability. This resilience is a significant strength.",
                    confidence: Math.min(95, totalCheckins * 2)
                });
            }

            // Common triggers
            if (commonTriggers.length > 0) {
                learnedInsights.push({
                    insight: `Common emotional triggers in your reflections include: ${commonTriggers.slice(0, 3).join(', ')}`,
                    confidence: Math.min(80, totalCheckins * 4)
                });
            }
        }

        // Update the current check-in with emotional patterns
        const currentCheckin = await EmotionalCheckin.findOne({
            userId,
            submittedAt: { $gte: new Date(Date.now() - 60000) } // Last minute
        }).sort({ submittedAt: -1 });

        if (currentCheckin) {
            currentCheckin.emotionalPatterns = {
                emotionHistory: emotionHistory.slice(0, 50), // Keep last 50 entries
                baselineEmotions: {
                    averageValence: avgValence,
                    averageArousal: avgArousal,
                    commonTriggers: commonTriggers.slice(0, 20),
                    emotionalStability
                },
                learnedInsights
            };
            await currentCheckin.save();
        }

        console.log(`📊 Updated emotional patterns for user ${userId}: ${totalCheckins} check-ins analyzed`);

    } catch (error) {
        console.error('Error updating user emotional patterns:', error);
        // Don't fail the check-in if pattern update fails
    }
};

// Submit emotional check-in
const submitCheckin = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const User = require('../models/User');
        const cacheService = require('../services/cacheService');
        const { aiAnalysisService, generatePersonalizedGreeting } = require('../services/aiAnalysisService');
        const notificationService = require('../services/notificationService');
        const { sendSuccess, sendError } = require('../utils/response');

        // Rate limiting: Check for recent submissions (within last 30 seconds)
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        const recentSubmission = await EmotionalCheckin.findOne({
            userId: req.user.id,
            submittedAt: { $gte: thirtySecondsAgo }
        });

        if (recentSubmission) {
            return sendError(res, 'Please wait 30 seconds between submissions to prevent spam.', 429);
        }

        // Check if user already did manual check-in today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingManualCheckin = await EmotionalCheckin.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            },
            aiEmotionScan: { $exists: false } // Manual check-in doesn't have aiEmotionScan
        });

        if (existingManualCheckin) {
            return sendError(res, 'You have already completed a manual check-in today. You can only do AI analysis or wait until tomorrow.', 409);
        }

        // Handle support contact - extract ObjectId if object is provided
        let supportContactUserId = null;
        if (req.body.supportContactUserId && req.body.supportContactUserId !== 'no_need') {
            if (typeof req.body.supportContactUserId === 'object' && req.body.supportContactUserId._id) {
                supportContactUserId = req.body.supportContactUserId._id;
            } else if (typeof req.body.supportContactUserId === 'string') {
                // For AI scans, this should be the ObjectId string
                supportContactUserId = req.body.supportContactUserId;
            }
        }

        console.log('🔍 Processing support contact:', {
            input: req.body.supportContactUserId,
            type: typeof req.body.supportContactUserId,
            processed: supportContactUserId
        });

        const checkinData = {
            userId: req.user.id,
            weatherType: req.body.weatherType,
            selectedMoods: req.body.selectedMoods,
            details: req.body.details,
            presenceLevel: req.body.presenceLevel,
            capacityLevel: req.body.capacityLevel,
            supportContactUserId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            // Add user reflection from AI emotion scan
            userReflection: req.body.userReflection,
            // Add AI emotion scan data if provided
            aiEmotionScan: req.body.aiEmotionScan ? {
                valence: req.body.aiEmotionScan.valence,
                arousal: req.body.aiEmotionScan.arousal,
                intensity: req.body.aiEmotionScan.intensity,
                detectedEmotion: req.body.aiEmotionScan.detectedEmotion,
                confidence: req.body.aiEmotionScan.confidence,
                explanations: req.body.aiEmotionScan.explanations,
                temporalAnalysis: req.body.aiEmotionScan.temporalAnalysis,
                // Add advanced psychological analysis
                emotionalAuthenticity: req.body.aiEmotionScan.emotionalAuthenticity,
                psychologicalDepth: req.body.aiEmotionScan.psychologicalDepth
            } : null
        };

        // Perform AI analysis (100% AI-generated, no fallbacks)
        console.log('🤖 Starting AI analysis...');
        let aiAnalysis;
        try {
            // Add user role to checkinData for context-aware AI analysis
            const enhancedCheckinData = {
                ...checkinData,
                userRole: req.user.role
            };
            aiAnalysis = await aiAnalysisService.analyzeEmotionalCheckin(enhancedCheckinData);
            console.log('✅ AI analysis completed');
        } catch (aiError) {
            console.error('❌ AI analysis failed:', aiError.message);
            throw new Error('AI analysis service is temporarily unavailable. Please try again later.');
        }

        // Enhance AI analysis with user reflection if provided (but keep it 100% AI-generated)
        if (checkinData.userReflection && checkinData.userReflection.trim()) {
            console.log('🧠 Enhancing AI analysis with user reflection...');
            try {
                aiAnalysis = await enhanceAIAnalysisWithUserContext(aiAnalysis, checkinData);
                console.log('✅ AI analysis enhanced with user context');
            } catch (enhanceError) {
                console.error('❌ AI enhancement failed:', enhanceError.message);
                // Continue with original AI analysis if enhancement fails
            }
        }

        // Generate personalized greeting based on enhanced AI analysis
        console.log('🤖 Generating personalized greeting...');
        const personalizedGreeting = await generatePersonalizedGreeting(checkinData, aiAnalysis);
        aiAnalysis.personalizedGreeting = personalizedGreeting;
        console.log('✅ Personalized greeting generated');

        // Update user's emotional patterns for AI learning
        console.log('🧠 Updating user emotional patterns...');
        await updateUserEmotionalPatterns(checkinData.userId, checkinData.aiEmotionScan, checkinData.userReflection);
        console.log('✅ User emotional patterns updated');

        // Create check-in record with AI analysis
        const checkin = new EmotionalCheckin({
            ...checkinData,
            aiAnalysis
        });

        await checkin.save();

        // Populate support contact details if exists
        let populatedCheckin = checkin;
        if (checkin.supportContactUserId) {
            populatedCheckin = await EmotionalCheckin.findById(checkin._id)
                .populate('supportContactUserId', 'name role department');
        }

        // Emit real-time update for dashboard and invalidate cache
        const io = require('../config/socket').getIO();

        // Invalidate dashboard cache to force fresh data
        cacheService.invalidateDashboardCache();

        if (io) {
            // Get user name for notification
            const user = await User.findById(checkin.userId).select('name');

            // Emit to all dashboard clients
            io.emit('dashboard:new-checkin', {
                id: checkin._id,
                userId: checkin.userId,
                userName: user?.name || 'Unknown User',
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                needsSupport: checkin.aiAnalysis.needsSupport,
                submittedAt: checkin.submittedAt
            });

            // Emit to personal room for real-time personal updates
            io.to(`personal-${checkin.userId}`).emit('personal:new-checkin', {
                id: checkin._id,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            });
        }

        // Send notifications if user has selected a support contact (regardless of AI analysis)
        if (checkin.supportContactUserId) {
            try {
                console.log('🔔 Sending support notifications for user:', checkin.userId);
                console.log('📧 Support contact ID:', checkin.supportContactUserId);
                console.log('🤖 AI needs support:', checkin.aiAnalysis.needsSupport);

                // Get user details
                const user = await User.findById(checkin.userId).select('name role department');
                const supportContact = await User.findById(checkin.supportContactUserId).select('name email role department');

                console.log('👤 User details:', { name: user?.name, role: user?.role, department: user?.department });
                console.log('🎯 Support contact details:', { name: supportContact?.name, email: supportContact?.email, role: supportContact?.role });

                if (user && supportContact) {
                    console.log('✅ Both user and support contact found, proceeding with notifications');

                    // Create notification for support request
                    try {
                        await notificationService.createSupportRequestNotification(checkin.userId, {
                            supportContactName: supportContact.name,
                            supportContactEmail: supportContact.email,
                            weatherType: checkin.weatherType,
                            presenceLevel: checkin.presenceLevel,
                            capacityLevel: checkin.capacityLevel,
                            checkinId: checkin._id.toString()
                        });
                        console.log('✅ Support request notification created');
                    } catch (notificationError) {
                        console.error('❌ Failed to create support request notification:', notificationError);
                        // Don't fail the check-in if notification creation fails
                    }

                    // Send Slack notification
                    try {
                        console.log('📱 Attempting to send Slack notification...');
                        await notificationService.sendSlackNotification({
                            userName: user.name,
                            userRole: user.role,
                            userDepartment: user.department,
                            supportContactName: supportContact.name,
                            supportContactEmail: supportContact.email,
                            weatherType: checkin.weatherType,
                            presenceLevel: checkin.presenceLevel,
                            capacityLevel: checkin.capacityLevel,
                            selectedMoods: checkin.selectedMoods,
                            details: checkin.details,
                            aiAnalysis: checkin.aiAnalysis,
                            checkinId: checkin._id.toString()
                        });
                        console.log('✅ Slack notification sent successfully');
                    } catch (slackError) {
                        console.error('❌ Slack notification failed:', slackError.message);
                    }

                    // Send email notification
                    try {
                        console.log('📧 Attempting to send email notification...');
                        await notificationService.sendEmailNotification({
                            userName: user.name,
                            userRole: user.role,
                            userDepartment: user.department,
                            supportContactName: supportContact.name,
                            supportContactEmail: supportContact.email,
                            weatherType: checkin.weatherType,
                            presenceLevel: checkin.presenceLevel,
                            capacityLevel: checkin.capacityLevel,
                            selectedMoods: checkin.selectedMoods,
                            details: checkin.details,
                            aiAnalysis: checkin.aiAnalysis,
                            checkinId: checkin._id.toString()
                        });
                        console.log('✅ Email notification sent successfully');
                    } catch (emailError) {
                        console.error('❌ Email notification failed:', emailError.message);
                    }

                    console.log('✅ Support notifications process completed');
                } else {
                    console.log('❌ Missing user or support contact data:', {
                        hasUser: !!user,
                        hasSupportContact: !!supportContact
                    });
                }
            } catch (notificationError) {
                console.error('❌ Failed to send support notifications:', notificationError);
                // Don't fail the check-in if notifications fail
            }
        } else {
            console.log('ℹ️ Skipping notifications - no support contact selected');
        }

        // Prepare support contact details for response
        let supportContactDetails = null;
        if (populatedCheckin.supportContactUserId) {
            supportContactDetails = {
                id: populatedCheckin.supportContactUserId._id,
                name: populatedCheckin.supportContactUserId.name,
                role: populatedCheckin.supportContactUserId.role,
                department: populatedCheckin.supportContactUserId.department
            };
        }

        // Get user name for the response
        const user = await User.findById(checkin.userId).select('name');

        sendSuccess(res, 'Emotional check-in submitted successfully', {
            checkin: {
                id: checkin._id.toString(),
                _id: checkin._id.toString(),
                name: user?.name || 'Staff Member',
                date: checkin.date,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                supportContact: supportContactDetails,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            }
        }, 201);

    } catch (error) {
        console.error('Submit check-in error:', error);
        const { sendError } = require('../utils/response');
        sendError(res, 'Failed to submit emotional check-in', 500);
    }
};

// Get today's check-in for the current user
const getTodayCheckin = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError } = require('../utils/response');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const checkin = await EmotionalCheckin.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            }
        }).sort({ submittedAt: -1 });

        if (!checkin) {
            return sendSuccess(res, 'No check-in found for today', { checkin: null });
        }

        // Populate user name for today's checkin
        const populatedCheckin = await EmotionalCheckin.findById(checkin._id)
            .populate('userId', 'name')
            .populate('supportContactUserId', 'name role department');

        const checkinWithName = {
            ...populatedCheckin.toObject(),
            name: populatedCheckin.userId?.name || 'Staff Member'
        };

        sendSuccess(res, 'Today\'s check-in retrieved', { checkin: checkinWithName });
    } catch (error) {
        console.error('Get today check-in error:', error);
        sendError(res, 'Failed to get today\'s check-in', 500);
    }
};

// Get today's check-in status (for UI to show available options)
const getTodayCheckinStatus = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError } = require('../utils/response');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Check for manual check-in (no aiEmotionScan)
        const manualCheckin = await EmotionalCheckin.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            },
            aiEmotionScan: { $exists: false }
        });

        // Check for AI check-in (has aiEmotionScan)
        const aiCheckin = await EmotionalCheckin.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            },
            aiEmotionScan: { $exists: true }
        });

        const status = {
            hasManualCheckin: !!manualCheckin,
            hasAICheckin: !!aiCheckin,
            canDoManual: !manualCheckin,
            canDoAI: !aiCheckin,
            manualCheckinTime: manualCheckin?.submittedAt,
            aiCheckinTime: aiCheckin?.submittedAt
        };

        sendSuccess(res, 'Today\'s check-in status retrieved', { status });
    } catch (error) {
        console.error('Get today check-in status error:', error);
        sendError(res, 'Failed to get today\'s check-in status', 500);
    }
};

// Get check-in results with AI analysis
const getCheckinResults = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError } = require('../utils/response');

        const checkin = await EmotionalCheckin.findOne({
            _id: req.params.id,
            userId: req.user.id
        }).populate('supportContactUserId', 'name role department');

        if (!checkin) {
            return sendError(res, 'Check-in not found', 404);
        }

        // Populate user name for check-in results
        const populatedCheckin = await EmotionalCheckin.findById(checkin._id)
            .populate('userId', 'name')
            .populate('supportContactUserId', 'name role department');

        const checkinWithName = {
            ...populatedCheckin.toObject(),
            name: populatedCheckin.userId?.name || 'Staff Member'
        };

        sendSuccess(res, 'Check-in results retrieved', { checkin: checkinWithName });
    } catch (error) {
        console.error('Get check-in results error:', error);
        sendError(res, 'Failed to get check-in results', 500);
    }
};

// Get check-in history with pagination and optional user filtering for dashboard
const getCheckinHistory = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const { sendSuccess, sendError, getPaginationInfo } = require('../utils/response');

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Build query - allow filtering by userId with role-based checks
        const query = {};
        const requestedUserId = req.query.userId;
        if (requestedUserId) {
            // If requesting another user's data, enforce permissions
            const isSelf = String(requestedUserId) === String(req.user.id);
            const elevated = ['directorate', 'admin', 'superadmin'].includes(req.user.role);
            if (!isSelf && !elevated) {
                if (req.user.role === 'head_unit') {
                    // Head Unit: only within same unit/department
                    const User = require('../models/User');
                    const target = await User.findById(requestedUserId).select('unit department');
                    const unit = req.user.unit || req.user.department;
                    if (!target || (target.unit !== unit && target.department !== unit)) {
                        return sendError(res, 'Access denied for this user\'s history', 403);
                    }
                } else {
                    return sendError(res, 'Access denied for this user\'s history', 403);
                }
            }
            query.userId = requestedUserId;
        } else {
            // Default to current user's history if no userId specified
            query.userId = req.user.id;
        }

        // Add date filtering if provided
        if (req.query.startDate || req.query.endDate) {
            query.date = {};
            if (req.query.startDate) {
                query.date.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                query.date.$lte = new Date(req.query.endDate);
            }
        }

        // Get total count
        const total = await EmotionalCheckin.countDocuments(query);

        // Get check-ins with pagination
        const checkins = await EmotionalCheckin.find(query)
            .sort({ date: -1, submittedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId', 'name email role department unit')
            .populate('supportContactUserId', 'name role department');

        const pagination = getPaginationInfo(page, limit, total);

        sendSuccess(res, 'Check-in history retrieved', {
            checkins,
            pagination
        });
    } catch (error) {
        console.error('Get check-in history error:', error);
        sendError(res, 'Failed to get check-in history', 500);
    }
};

// Get available support contacts for the current user
const getAvailableContacts = async (req, res) => {
    try {
        const userRole = req.user.role;
        const User = require('../models/User');
        const { sendSuccess, sendError } = require('../utils/response');

        // Define which roles can be contacted based on user's role
        let contactableRoles = [];
        switch (userRole) {
            case 'student':
                contactableRoles = ['counselor', 'teacher', 'directorate'];
                break;
            case 'teacher':
            case 'staff':
            case 'support_staff':
            case 'se_teacher':
                contactableRoles = ['directorate', 'head_unit', 'counselor'];
                break;
            case 'head_unit':
                contactableRoles = ['directorate', 'head_unit', 'counselor'];
                break;
            case 'directorate':
                contactableRoles = ['directorate', 'head_unit']; // Can contact other directors and head units
                break;
            default:
                contactableRoles = ['directorate', 'head_unit'];
        }

        // Get available contacts
        const contacts = await User.find({
            role: { $in: contactableRoles },
            isActive: true,
            _id: { $ne: req.user.id } // Exclude self
        })
            .select('_id name role department jobLevel unit jobPosition')
            .sort({ name: 1 });

        // Add "No Need" option
        const contactOptions = [
            ...contacts.map(contact => ({
                id: contact._id.toString(),
                name: contact.name,
                role: contact.role,
                department: contact.department || 'General',
                jobLevel: contact.jobLevel || 'N/A',
                unit: contact.unit || 'N/A',
                jobPosition: contact.jobPosition || 'N/A'
            })),
            {
                id: 'no_need',
                name: 'No Need',
                role: 'N/A',
                department: 'N/A',
                jobLevel: 'N/A',
                unit: 'N/A',
                jobPosition: 'N/A'
            }
        ];

        sendSuccess(res, 'Available contacts retrieved', { contacts: contactOptions });
    } catch (error) {
        console.error('Get available contacts error:', error);
        sendError(res, 'Failed to get available contacts', 500);
    }
};

// Analyze emotion from captured image
const analyzeEmotion = async (req, res) => {
    try {
        const { sendSuccess } = require('../utils/response');
        const fs = require('fs');
        const googleAI = require('../config/googleAI');

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No image file provided' });
        }

        console.log('🖼️ Received image for emotion analysis, size:', req.file.size);

        // Convert image to base64
        if (!req.file || !req.file.path) {
            return res.status(400).json({ success: false, message: 'No image file path provided' });
        }

        const fileImageData = fs.readFileSync(req.file.path);
        const base64Image = fileImageData.toString('base64');

        // Simplified prompt for emotion analysis to avoid model overload
        const analysisPrompt = `Analyze this facial image and return ONLY a valid JSON object with emotion analysis:

{
  "primaryEmotion": "happy|sad|angry|surprised|fearful|disgusted|neutral|anxious|calm",
  "secondaryEmotions": ["array of up to 2 emotions"],
  "valence": number (-1 to 1),
  "arousal": number (-1 to 1),
  "intensity": number (0-100),
  "confidence": number (0-100),
  "explanations": ["array of 2-3 strings explaining the analysis"]
}

Keep the analysis simple and focused on basic facial emotion recognition.`;

        console.log('🤖 Sending image to Google AI for emotion analysis...');

        // Generate content with image
        const aiResponse = await googleAI.generateContent([
            analysisPrompt,
            {
                inlineData: {
                    mimeType: req.file.mimetype,
                    data: base64Image
                }
            }
        ]);

        console.log('🔍 aiResponse type:', typeof aiResponse);
        console.log('🔍 aiResponse keys:', Object.keys(aiResponse || {}));
        console.log('🔍 Full AI Response Object:', JSON.stringify(aiResponse, null, 2));

        // Extract text from AI response with multiple fallback paths
        const candidate = aiResponse?.candidates?.[0] || aiResponse?.choices?.[0] || aiResponse?.output?.[0];
        console.log('🔍 Candidate object:', JSON.stringify(candidate, null, 2));

        const aiText =
            candidate?.content?.parts?.[0]?.text ||
            candidate?.text ||
            candidate?.message?.content?.parts?.[0] ||
            candidate?.message?.content ||
            candidate?.output_text ||
            null;

        console.log('📝 Extracted aiText:', aiText);
        console.log('📝 aiText type:', typeof aiText);
        console.log('📝 aiText length:', aiText?.length);

        if (!aiText) {
            console.error('❌ No text payload found in AI response');
            console.error('❌ aiResponse structure:', {
                hasCandidates: !!aiResponse?.candidates,
                candidatesLength: aiResponse?.candidates?.length,
                hasChoices: !!aiResponse?.choices,
                hasOutput: !!aiResponse?.output,
                responseKeys: Object.keys(aiResponse || {})
            });
            return res.status(500).json({ success: false, message: 'AI response missing text payload' });
        }

        console.log('📝 Extracted AI text:', aiText);

        // Parse the JSON response
        let emotionResult;
        try {
            // Clean the response text (remove markdown code blocks if present)
            let cleanText = String(aiText).trim();
            cleanText = cleanText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

            // Try to parse JSON directly
            emotionResult = JSON.parse(cleanText);
        } catch (parseError) {
            console.error('❌ Failed to parse AI response as JSON:', parseError);
            console.error('Raw AI text:', aiText);

            // Try to extract JSON object from text
            const jsonMatch = aiText.match(/(\{[\s\S]*\})/);
            if (jsonMatch) {
                try {
                    emotionResult = JSON.parse(jsonMatch[1]);
                    console.log('✅ Successfully extracted and parsed JSON from text');
                } catch (extractError) {
                    console.error('❌ Failed to parse extracted JSON:', extractError);
                }
            }

            // No fallback analysis - must be 100% AI-powered
            if (!emotionResult) {
                console.error('❌ AI emotion analysis completely failed - no fallback available');
                return res.status(503).json({
                    success: false,
                    message: 'AI emotion analysis service is temporarily unavailable. Please try again later.',
                    error: 'AI_SERVICE_UNAVAILABLE'
                });
            }
        }

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        console.log('🎯 Real AI emotion analysis completed:', emotionResult.primaryEmotion);
        sendSuccess(res, 'Emotion analysis completed', { emotionResult });

    } catch (error) {
        console.error('❌ Emotion analysis error:', error);
        const { sendError } = require('../utils/response');
        sendError(res, 'Failed to analyze emotion', 500);
    }
};

// Submit AI emotion scan check-in (separate from manual check-in)
const submitAICheckin = async (req, res) => {
    try {
        const EmotionalCheckin = require('../models/EmotionalCheckin');
        const User = require('../models/User');
        const cacheService = require('../services/cacheService');
        const { aiAnalysisService, generatePersonalizedGreeting } = require('../services/aiAnalysisService');
        const { sendSuccess, sendError } = require('../utils/response');

        // Rate limiting: Check for recent submissions (within last 30 seconds)
        const thirtySecondsAgo = new Date(Date.now() - 30000);
        const recentSubmission = await EmotionalCheckin.findOne({
            userId: req.user.id,
            submittedAt: { $gte: thirtySecondsAgo }
        });

        if (recentSubmission) {
            return sendError(res, 'Please wait 30 seconds between submissions to prevent spam.', 429);
        }

        // Check if user already did AI check-in today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const existingAICheckin = await EmotionalCheckin.findOne({
            userId: req.user.id,
            date: {
                $gte: today,
                $lt: tomorrow
            },
            aiEmotionScan: { $exists: true } // AI check-in has aiEmotionScan
        });

        if (existingAICheckin) {
            return sendError(res, 'You have already completed an AI analysis check-in today. You can only do manual check-in or wait until tomorrow.', 409);
        }

        // Handle support contact for AI scans
        let supportContactUserId = null;
        if (req.body.supportContactUserId && req.body.supportContactUserId !== 'no_need') {
            if (typeof req.body.supportContactUserId === 'object' && req.body.supportContactUserId._id) {
                supportContactUserId = req.body.supportContactUserId._id;
            } else if (typeof req.body.supportContactUserId === 'string') {
                supportContactUserId = req.body.supportContactUserId;
            }
        }

        console.log('🤖 AI Check-in support contact processing:', {
            input: req.body.supportContactUserId,
            type: typeof req.body.supportContactUserId,
            processed: supportContactUserId,
            allBodyKeys: Object.keys(req.body)
        });

        // Since we're using multer, the form data is in req.body but may be strings
        // Parse JSON strings if needed
        let parsedBody = req.body;
        if (req.body.checkInData) {
            try {
                parsedBody = JSON.parse(req.body.checkInData);
                console.log('✅ Parsed checkInData from form:', parsedBody);
            } catch (e) {
                console.log('❌ Failed to parse checkInData, using raw body');
                parsedBody = req.body;
            }
        }

        console.log('📋 Final parsed body for AI check-in:', parsedBody);

        const checkinData = {
            userId: req.user.id,
            weatherType: parsedBody.weatherType || 'partly-cloudy', // AI-detected weather - allow any value
            selectedMoods: parsedBody.selectedMoods || [], // AI-detected moods - allow any values
            details: parsedBody.details || '',
            presenceLevel: parsedBody.presenceLevel || 7,
            capacityLevel: parsedBody.capacityLevel || 7,
            supportContactUserId,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            // Add AI emotion scan data
            aiEmotionScan: parsedBody.aiEmotionScan ? {
                valence: parsedBody.aiEmotionScan.valence,
                arousal: parsedBody.aiEmotionScan.arousal,
                intensity: parsedBody.aiEmotionScan.intensity,
                detectedEmotion: parsedBody.aiEmotionScan.detectedEmotion,
                confidence: parsedBody.aiEmotionScan.confidence,
                explanations: parsedBody.aiEmotionScan.explanations,
                temporalAnalysis: parsedBody.aiEmotionScan.temporalAnalysis,
                emotionalAuthenticity: parsedBody.aiEmotionScan.emotionalAuthenticity,
                psychologicalDepth: parsedBody.aiEmotionScan.psychologicalDepth,
                emotionalIncongruence: parsedBody.aiEmotionScan.emotionalIncongruence
            } : null
        };

        // Store AI-generated weather and moods in database for future reference
        if (checkinData.weatherType && checkinData.weatherType !== 'partly-cloudy') {
            console.log('📊 Storing AI-generated weather type:', checkinData.weatherType);
        }
        if (checkinData.selectedMoods && checkinData.selectedMoods.length > 0) {
            console.log('📊 Storing AI-generated moods:', checkinData.selectedMoods);
        }

        console.log('✅ Final checkinData for AI scan:', {
            weatherType: checkinData.weatherType,
            selectedMoods: checkinData.selectedMoods,
            presenceLevel: checkinData.presenceLevel,
            capacityLevel: checkinData.capacityLevel,
            supportContactUserId: checkinData.supportContactUserId
        });

        // Use existing AI analysis service for consistency (100% AI-generated, no fallbacks)
        console.log('🤖 Starting AI analysis for AI check-in...');
        let aiAnalysis;
        try {
            // Add user role to checkinData for context-aware AI analysis
            const enhancedCheckinData = {
                ...checkinData,
                userRole: req.user.role
            };
            aiAnalysis = await aiAnalysisService.analyzeEmotionalCheckin(enhancedCheckinData);
            console.log('✅ AI analysis completed for AI check-in');
        } catch (aiError) {
            console.error('❌ AI analysis failed for AI check-in:', aiError.message);
            throw new Error('AI analysis service is temporarily unavailable. Please try again later.');
        }

        // Generate personalized greeting
        const personalizedGreeting = await generatePersonalizedGreeting(checkinData, aiAnalysis);
        aiAnalysis.personalizedGreeting = personalizedGreeting;

        // Create check-in record with AI analysis
        const checkin = new EmotionalCheckin({
            ...checkinData,
            aiAnalysis
        });

        await checkin.save();

        // Populate support contact details if exists
        let populatedCheckin = checkin;
        if (checkin.supportContactUserId) {
            populatedCheckin = await EmotionalCheckin.findById(checkin._id)
                .populate('supportContactUserId', 'name role department');
        }

        // Emit real-time update for dashboard
        const io = require('../config/socket').getIO();
        cacheService.invalidateDashboardCache();

        if (io) {
            const user = await User.findById(checkin.userId).select('name');
            io.emit('dashboard:new-checkin', {
                id: checkin._id,
                userId: checkin.userId,
                userName: user?.name || 'Unknown User',
                weatherType: checkin.weatherType,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                needsSupport: checkin.aiAnalysis.needsSupport,
                submittedAt: checkin.submittedAt
            });
        }

        // Send notifications if user has selected a support contact (regardless of AI analysis)
        if (checkin.supportContactUserId) {
            try {
                console.log('🔔 Sending support notifications for AI check-in user:', checkin.userId);
                console.log('🤖 AI needs support:', checkin.aiAnalysis.needsSupport);

                // Get user details
                const user = await User.findById(checkin.userId).select('name role department');
                const supportContact = await User.findById(checkin.supportContactUserId).select('name email role department');

                if (user && supportContact) {
                    // Send Slack notification
                    await notificationService.sendSlackNotification({
                        userName: user.name,
                        userRole: user.role,
                        userDepartment: user.department,
                        supportContactName: supportContact.name,
                        supportContactEmail: supportContact.email,
                        weatherType: checkin.weatherType,
                        presenceLevel: checkin.presenceLevel,
                        capacityLevel: checkin.capacityLevel,
                        selectedMoods: checkin.selectedMoods,
                        details: checkin.details,
                        aiAnalysis: checkin.aiAnalysis,
                        checkinId: checkin._id.toString()
                    });

                    // Send email notification
                    await notificationService.sendEmailNotification({
                        userName: user.name,
                        userRole: user.role,
                        userDepartment: user.department,
                        supportContactName: supportContact.name,
                        supportContactEmail: supportContact.email,
                        weatherType: checkin.weatherType,
                        presenceLevel: checkin.presenceLevel,
                        capacityLevel: checkin.capacityLevel,
                        selectedMoods: checkin.selectedMoods,
                        details: checkin.details,
                        aiAnalysis: checkin.aiAnalysis,
                        checkinId: checkin._id.toString()
                    });

                    console.log('✅ Support notifications sent successfully for AI check-in');
                }
            } catch (notificationError) {
                console.error('❌ Failed to send support notifications for AI check-in:', notificationError);
                // Don't fail the check-in if notifications fail
            }
        } else {
            console.log('ℹ️ Skipping notifications - no support contact selected for AI check-in');
        }

        // Prepare support contact details for response
        let supportContactDetails = null;
        if (populatedCheckin.supportContactUserId) {
            supportContactDetails = {
                id: populatedCheckin.supportContactUserId._id,
                name: populatedCheckin.supportContactUserId.name,
                role: populatedCheckin.supportContactUserId.role,
                department: populatedCheckin.supportContactUserId.department
            };
        }

        const user = await User.findById(checkin.userId).select('name');

        sendSuccess(res, 'AI emotion check-in submitted successfully', {
            checkin: {
                id: checkin._id.toString(),
                _id: checkin._id.toString(),
                name: user?.name || 'Staff Member',
                date: checkin.date,
                weatherType: checkin.weatherType,
                selectedMoods: checkin.selectedMoods,
                details: checkin.details,
                presenceLevel: checkin.presenceLevel,
                capacityLevel: checkin.capacityLevel,
                supportContact: supportContactDetails,
                aiAnalysis: checkin.aiAnalysis,
                submittedAt: checkin.submittedAt
            }
        }, 201);

    } catch (error) {
        console.error('AI check-in submission error:', error);
        const { sendError } = require('../utils/response');
        sendError(res, 'Failed to submit AI emotion check-in', 500);
    }
};

module.exports = {
    submitCheckin,
    submitAICheckin,
    getTodayCheckin,
    getTodayCheckinStatus,
    getCheckinResults,
    getCheckinHistory,
    getAvailableContacts,
    analyzeEmotion,
    updateUserEmotionalPatterns
};
