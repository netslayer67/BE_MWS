const axios = require('axios');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');

// Slack configuration
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_API_BASE = 'https://slack.com/api';

// Email configuration (using nodemailer or similar)
const nodemailer = require('nodemailer');
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Slack notification functions
class SlackService {
    constructor() {
        this.client = axios.create({
            baseURL: SLACK_API_BASE,
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async sendDirectMessage(userId, message, blocks = null) {
        try {
            console.log(`📤 Sending Slack DM to user ID: ${userId}`);
            console.log(`📝 Message: ${message.substring(0, 100)}...`);

            const payload = {
                channel: userId,
                text: message
            };

            if (blocks) {
                payload.blocks = blocks;
                console.log(`📦 Including ${blocks.length} block(s) in message`);
            }

            const response = await this.client.post('/chat.postMessage', payload);
            console.log(`✅ Slack API Response:`, response.data);

            if (response.data.ok) {
                console.log(`✅ Slack DM sent successfully to user ${userId}`);
                return response.data;
            } else {
                console.error(`❌ Slack API returned not ok:`, response.data);
                throw new Error(`Slack API error: ${response.data.error}`);
            }
        } catch (error) {
            console.error('❌ Slack DM send error:', error.response?.data || error.message);

            // Log detailed error information
            if (error.response?.data) {
                console.error('Slack API Error Details:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    error: error.response.data.error,
                    needed: error.response.data.needed,
                    provided: error.response.data.provided
                });
            }

            throw error;
        }
    }

    async findUserByEmail(email) {
        try {
            console.log(`🔍 Looking up Slack user by email: ${email}`);
            const response = await this.client.get('/users.lookupByEmail', {
                params: { email }
            });

            if (response.data.user) {
                console.log(`✅ Found Slack user: ${response.data.user.name} (ID: ${response.data.user.id})`);
                return response.data.user;
            } else {
                console.log(`❌ No Slack user found for email: ${email}`);
                return null;
            }
        } catch (error) {
            console.error('❌ Slack user lookup error:', error.response?.data || error.message);

            // Log additional error details for debugging
            if (error.response?.data) {
                console.error('Slack API Error Details:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            }

            return null;
        }
    }
}

// Email notification functions
class EmailService {
    async sendEmail(to, subject, html, text = null) {
        try {
            const mailOptions = {
                from: process.env.SMTP_FROM || 'noreply@millennia21.id',
                to,
                subject,
                html,
                text: text || this.stripHtml(html)
            };

            const result = await emailTransporter.sendMail(mailOptions);
            return result;
        } catch (error) {
            console.error('Email send error:', error.message);
            throw error;
        }
    }

    stripHtml(html) {
        return html.replace(/<[^>]*>/g, '');
    }
}

// Main notification service
class NotificationService {
    constructor() {
        this.slack = new SlackService();
        this.email = new EmailService();
    }

    // Persistence methods for database operations

    // Create a new notification
    async createNotification(userId, category, priority, title, message, metadata = {}, expiresAt = null) {
        try {
            const notification = new Notification({
                userId,
                category,
                priority,
                title,
                message,
                metadata,
                expiresAt
            });

            await notification.save();
            console.log(`✅ Notification created for user ${userId}: ${title}`);
            return notification;
        } catch (error) {
            console.error('❌ Error creating notification:', error);
            throw error;
        }
    }

    // Get notifications for a user
    async getUserNotifications(userId, options = {}) {
        try {
            const {
                page = 1,
                limit = 20,
                isRead = null,
                category = null,
                priority = null
            } = options;

            const query = { userId };

            if (isRead !== null) {
                query.isRead = isRead;
            }

            if (category) {
                query.category = category;
            }

            if (priority) {
                query.priority = priority;
            }

            const notifications = await Notification.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .skip((page - 1) * limit)
                .populate('userId', 'name email')
                .exec();

            const total = await Notification.countDocuments(query);

            return {
                notifications,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };
        } catch (error) {
            console.error('❌ Error getting user notifications:', error);
            throw error;
        }
    }

    // Mark notification as read
    async markAsRead(notificationId, userId) {
        try {
            const notification = await Notification.findOneAndUpdate(
                { _id: notificationId, userId },
                { isRead: true, readAt: new Date() },
                { new: true }
            );

            if (!notification) {
                throw new Error('Notification not found or access denied');
            }

            console.log(`✅ Notification ${notificationId} marked as read`);
            return notification;
        } catch (error) {
            console.error('❌ Error marking notification as read:', error);
            throw error;
        }
    }

    // Mark all notifications as read for a user
    async markAllAsRead(userId) {
        try {
            const result = await Notification.updateMany(
                { userId, isRead: false },
                { isRead: true, readAt: new Date() }
            );

            console.log(`✅ Marked ${result.modifiedCount} notifications as read for user ${userId}`);
            return result;
        } catch (error) {
            console.error('❌ Error marking all notifications as read:', error);
            throw error;
        }
    }

    // Delete a notification
    async deleteNotification(notificationId, userId) {
        try {
            const result = await Notification.findOneAndDelete({
                _id: notificationId,
                userId
            });

            if (!result) {
                throw new Error('Notification not found or access denied');
            }

            console.log(`✅ Notification ${notificationId} deleted`);
            return result;
        } catch (error) {
            console.error('❌ Error deleting notification:', error);
            throw error;
        }
    }

    // Get notification statistics for a user
    async getNotificationStats(userId) {
        try {
            const stats = await Notification.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: null,
                        total: { $sum: 1 },
                        unread: {
                            $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
                        },
                        byCategory: {
                            $push: {
                                category: '$category',
                                isRead: '$isRead'
                            }
                        },
                        byPriority: {
                            $push: {
                                priority: '$priority',
                                isRead: '$isRead'
                            }
                        }
                    }
                }
            ]);

            return stats[0] || { total: 0, unread: 0, byCategory: [], byPriority: [] };
        } catch (error) {
            console.error('❌ Error getting notification stats:', error);
            throw error;
        }
    }

    // Create support request notification
    async createSupportRequestNotification(userId, supportRequest) {
        try {
            const title = 'Support Request Submitted';
            const message = `Your support request has been submitted and sent to ${supportRequest.supportContactName}. They will respond shortly.`;

            const metadata = {
                supportRequestId: supportRequest.checkinId,
                supportContactName: supportRequest.supportContactName,
                supportContactEmail: supportRequest.supportContactEmail,
                weatherType: supportRequest.weatherType,
                presenceLevel: supportRequest.presenceLevel,
                capacityLevel: supportRequest.capacityLevel
            };

            return await this.createNotification(userId, 'support_request', 'medium', title, message, metadata);
        } catch (error) {
            console.error('❌ Error creating support request notification:', error);
            throw error;
        }
    }

    // Create system notification
    async createSystemNotification(userId, title, message, priority = 'low', metadata = {}) {
        try {
            return await this.createNotification(userId, 'system', priority, title, message, metadata);
        } catch (error) {
            console.error('❌ Error creating system notification:', error);
            throw error;
        }
    }

    // Send Slack notification for support requests
    async sendSlackNotification(supportRequest) {
        const {
            userName,
            userRole,
            userDepartment,
            supportContactName,
            supportContactEmail,
            weatherType,
            presenceLevel,
            capacityLevel,
            selectedMoods,
            details,
            aiAnalysis,
            checkinId
        } = supportRequest;

        // Check if Slack credentials are configured
        if (!process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN === 'xoxb-your-slack-bot-token') {
            console.log('⚠️ Slack credentials not configured, skipping Slack notification');
            return { success: false, error: 'Slack credentials not configured' };
        }

        try {
            // Find Slack user by email
            const slackUser = await this.slack.findUserByEmail(supportContactEmail);
            if (!slackUser) {
                console.log(`Slack user not found for ${supportContactEmail}, skipping Slack notification`);
                return { success: false, error: 'Slack user not found' };
            }

            // Create detailed Slack message with user details
            const message = `🚨 Support Request from ${userName}\n\nEmotional State: ${weatherType}\nPresence: ${presenceLevel}/10, Capacity: ${capacityLevel}/10\nMoods: ${selectedMoods?.join(', ') || 'None'}\n\nAI Analysis: ${aiAnalysis?.emotionalState || 'N/A'}\n${aiAnalysis?.recommendations?.[0] || ''}`;

            // Create clean Slack blocks following Block Kit best practices
            const blocks = [
                {
                    type: "header",
                    text: {
                        type: "plain_text",
                        text: "🚨 Support Request Alert",
                        emoji: true
                    }
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*${userName}* (${userRole}, ${userDepartment}) needs support.`
                    }
                },
                {
                    type: "section",
                    fields: [
                        {
                            type: "mrkdwn",
                            text: `*Weather:*\n${weatherType}`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Presence:*\n${presenceLevel}/10`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Capacity:*\n${capacityLevel}/10`
                        },
                        {
                            type: "mrkdwn",
                            text: `*Moods:*\n${selectedMoods?.join(', ') || 'None'}`
                        }
                    ]
                },
                // Add user details section if provided
                ...(details ? [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*User Details:*\n"${details.length > 200 ? details.substring(0, 200) + '...' : details}"`
                    }
                }] : []),
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `*AI Analysis:*\n*State:* ${aiAnalysis?.emotionalState || 'N/A'}\n*Recommendation:* ${aiAnalysis?.recommendations?.[0]?.title || 'N/A'}`
                    }
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: {
                                type: "plain_text",
                                text: "Mark as Handled",
                                emoji: true
                            },
                            style: "primary",
                            action_id: "mark_handled",
                            value: JSON.stringify({
                                requestId: checkinId,
                                action: 'handled'
                            })
                        }
                    ]
                }
            ];

            // Send the direct message
            console.log(`🚀 Attempting to send Slack DM to ${supportContactName} (${supportContactEmail}) with user ID: ${slackUser.id}`);
            console.log('🔗 Sending Slack message with blocks:', JSON.stringify(blocks, null, 2));
            const dmResult = await this.slack.sendDirectMessage(slackUser.id, message, blocks);

            if (dmResult.ok) {
                console.log(`✅ Slack notification sent successfully to ${supportContactName} (${supportContactEmail})`);
                console.log(`📨 Message timestamp: ${dmResult.ts}`);
                return { success: true, messageId: dmResult.ts };
            } else {
                console.error(`❌ Slack API returned error:`, dmResult.error);
                return { success: false, error: dmResult.error };
            }

        } catch (error) {
            console.error('❌ Slack notification error:', error);
            return { success: false, error: error.message };
        }
    }

    // Send email notification for support requests
    async sendEmailNotification(supportRequest) {
        const {
            userName,
            userRole,
            userDepartment,
            supportContactName,
            supportContactEmail,
            weatherType,
            presenceLevel,
            capacityLevel,
            selectedMoods,
            details,
            aiAnalysis,
            checkinId
        } = supportRequest;

        // Check if email credentials are configured
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.log('⚠️ Email credentials not configured, skipping email notification');
            return { success: false, error: 'Email credentials not configured' };
        }

        try {
            // Enhanced weather emoji mapping
            const getWeatherEmoji = (weather) => {
                const weatherMap = {
                    'sunny': '☀️',
                    'cloudy': '☁️',
                    'rain': '🌧️',
                    'storm': '⛈️',
                    'tornado': '🌪️',
                    'snow': '❄️',
                    'partly-cloudy': '⛅',
                    'rainbow': '🌈',
                    'foggy': '🌫️',
                    'windy': '💨'
                };
                return weatherMap[weather] || '🌤️';
            };

            // Enhanced mood display with design system colors
            const getMoodDisplay = (moods) => {
                if (!moods || moods.length === 0) return '<em style="color: #6c757d;">No specific moods selected</em>';

                const moodColors = {
                    'happy': '#22c55e',      // green-500
                    'excited': '#3b82f6',    // blue-500
                    'calm': '#06b6d4',      // cyan-500
                    'sad': '#6b7280',       // gray-500
                    'anxious': '#f59e0b',    // amber-500
                    'angry': '#ef4444',     // red-500
                    'tired': '#8b5cf6',     // violet-500
                    'overwhelmed': '#ec4899', // pink-500
                    'lonely': '#10b981',    // emerald-500
                    'confused': '#eab308',  // yellow-500
                    'frustrated': '#dc2626', // red-600
                    'hopeful': '#16a34a',   // green-600
                    'grateful': '#059669',  // emerald-600
                    'stressed': '#d97706'   // amber-600
                };

                return moods.map(mood =>
                    `<span style="background: ${moodColors[mood] || '#6b7280'}; color: white; padding: 3px 10px; border-radius: 16px; font-size: 12px; font-weight: 500; margin: 2px; display: inline-block; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">${mood}</span>`
                ).join(' ');
            };

            // Enhanced presence/capacity visualization
            const createProgressBar = (value, max = 10, color = '#007bff') => {
                const percentage = (value / max) * 100;
                return `
                    <div style="display: inline-block; width: 120px; height: 8px; background: #e9ecef; border-radius: 4px; margin-right: 10px;">
                        <div style="width: ${percentage}%; height: 100%; background: ${color}; border-radius: 4px;"></div>
                    </div>
                    <strong>${value}/${max}</strong>
                `;
            };

            // Enhanced AI analysis display with improved contrast and readability
            const getAIAnalysisDisplay = (aiAnalysis) => {
                if (!aiAnalysis) return '<em style="color: #6c757d; font-style: italic;">AI analysis not available</em>';

                const stateColors = {
                    'positive': '#16a34a',   // green-600 (darker for better contrast)
                    'challenging': '#d97706', // amber-600 (darker for better contrast)
                    'balanced': '#0891b2',   // cyan-600 (darker for better contrast)
                    'depleted': '#dc2626'    // red-600 (darker for better contrast)
                };

                const bgColors = {
                    'positive': '#f0fdf4',   // green-50
                    'challenging': '#fffbeb', // amber-50
                    'balanced': '#ecfeff',   // cyan-50
                    'depleted': '#fef2f2'    // red-50
                };

                const state = aiAnalysis.emotionalState || 'unknown';
                const bgColor = bgColors[state] || '#f9fafb'; // gray-50
                const textColor = stateColors[state] || '#374151'; // gray-700

                let html = `<div style="background: ${bgColor}; border: 1px solid ${textColor}20; border-left: 4px solid ${textColor}; padding: 16px; margin: 12px 0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">`;
                html += `<div style="display: flex; align-items: center; margin-bottom: 8px;">`;
                html += `<strong style="color: ${textColor}; font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${state}</strong>`;
                html += `<span style="margin-left: 8px; padding: 2px 8px; background: ${textColor}; color: white; border-radius: 12px; font-size: 11px; font-weight: 500;">AI ANALYSIS</span>`;
                html += `</div>`;

                if (aiAnalysis.psychologicalInsights) {
                    html += `<p style="margin: 8px 0; font-size: 14px; color: #374151; line-height: 1.5; font-weight: 400;">${aiAnalysis.psychologicalInsights}</p>`;
                }

                if (aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0) {
                    html += '<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">';
                    html += '<strong style="color: #374151; font-size: 14px; margin-bottom: 8px; display: block;">Recommendations:</strong>';
                    html += '<ul style="margin: 0; padding-left: 20px;">';
                    aiAnalysis.recommendations.slice(0, 3).forEach(rec => {
                        const priorityColors = {
                            'high': '#dc2626',    // red-600
                            'medium': '#d97706',  // amber-600
                            'low': '#16a34a'      // green-600
                        };
                        const priorityBg = {
                            'high': '#fef2f2',    // red-50
                            'medium': '#fffbeb',  // amber-50
                            'low': '#f0fdf4'      // green-50
                        };
                        html += `<li style="margin: 6px 0; padding: 4px 8px; background: ${priorityBg[rec.priority] || '#f9fafb'}; border-radius: 4px; border-left: 3px solid ${priorityColors[rec.priority] || '#6b7280'}; color: #374151; font-size: 13px; line-height: 1.4;">${rec.title}</li>`;
                    });
                    html += '</ul></div>';
                }

                html += '</div>';
                return html;
            };

            const emailHtml = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Support Request Alert</title>
                </head>
                <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8f9fa;">
                    <div style="max-width: 700px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">

                        <!-- Header -->
                        <div style="background: linear-gradient(135deg, hsl(357, 71%, 29%) 0%, hsl(42, 72%, 46%) 100%); color: white; padding: 40px 30px; text-align: center; position: relative;">
                            <div style="position: absolute; top: 20px; right: 20px; font-size: 24px;">🚨</div>
                            <h1 style="margin: 0; font-size: 28px; font-weight: 600;">Support Request Alert</h1>
                            <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 16px;">Immediate attention required</p>
                        </div>

                        <!-- Main Content -->
                        <div style="padding: 40px 30px;">

                            <!-- User Info Card -->
                            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 30px; text-align: center;">
                                <div style="font-size: 48px; margin-bottom: 15px;">👤</div>
                                <h2 style="margin: 0; font-size: 24px; font-weight: 600;">${userName}</h2>
                                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 16px;">${userRole} • ${userDepartment}</p>
                                <div style="margin-top: 15px; padding: 8px 16px; background: rgba(255,255,255,0.2); border-radius: 20px; display: inline-block;">
                                    <strong>Needs Your Support</strong>
                                </div>
                            </div>

                            <!-- Emotional State Overview -->
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px;">
                                <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; text-align: center; border: 2px solid #e9ecef;">
                                    <div style="font-size: 32px; margin-bottom: 10px;">${getWeatherEmoji(weatherType)}</div>
                                    <h3 style="margin: 0; color: #495057; font-size: 16px;">Weather State</h3>
                                    <p style="margin: 5px 0 0 0; font-weight: 600; color: #007bff; text-transform: capitalize;">${weatherType.replace('-', ' ')}</p>
                                </div>

                                <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; text-align: center; border: 2px solid #e9ecef;">
                                    <div style="font-size: 24px; margin-bottom: 10px;">🎭</div>
                                    <h3 style="margin: 0; color: #495057; font-size: 16px;">Emotional State</h3>
                                    <div style="margin-top: 10px;">${getMoodDisplay(selectedMoods)}</div>
                                </div>
                            </div>

                            <!-- Detailed Metrics -->
                            <div style="background: #f8f9fa; padding: 25px; border-radius: 12px; margin-bottom: 30px;">
                                <h3 style="margin: 0 0 20px 0; color: #495057; font-size: 18px;">📊 Detailed Assessment</h3>

                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px;">
                                    <div>
                                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                            <span style="font-size: 16px; margin-right: 10px;">🧠</span>
                                            <strong style="color: #495057;">Presence Level</strong>
                                        </div>
                                        ${createProgressBar(presenceLevel, 10, presenceLevel >= 7 ? '#28a745' : presenceLevel >= 4 ? '#fd7e14' : '#dc3545')}
                                    </div>

                                    <div>
                                        <div style="display: flex; align-items: center; margin-bottom: 8px;">
                                            <span style="font-size: 16px; margin-right: 10px;">⚡</span>
                                            <strong style="color: #495057;">Capacity Level</strong>
                                        </div>
                                        ${createProgressBar(capacityLevel, 10, capacityLevel >= 7 ? '#28a745' : capacityLevel >= 4 ? '#fd7e14' : '#dc3545')}
                                    </div>
                                </div>

                                ${details ? `
                                <div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #007bff;">
                                    <strong style="color: #495057;">Additional Details:</strong>
                                    <p style="margin: 8px 0 0 0; color: #6c757d; font-style: italic;">"${details}"</p>
                                </div>
                                ` : ''}
                            </div>

                            <!-- AI Analysis Section -->
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 30px;">
                                <h3 style="margin: 0 0 15px 0; font-size: 18px;">🤖 AI Psychological Analysis</h3>
                                <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 8px;">
                                    ${getAIAnalysisDisplay(aiAnalysis)}
                                </div>
                            </div>

                            <!-- Action Buttons -->
                            <div style="text-align: center; margin: 40px 0;">
                                <div style="display: inline-block; margin: 0 10px 20px 0;">
                                    <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-checkin/dashboard"
                                       style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 6px rgba(0,123,255,0.3);">
                                        📊 View Full Dashboard
                                    </a>
                                </div>

                                <div style="display: inline-block; margin: 0 10px 20px 0;">
                                    <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-checkin/dashboard?action=confirm&requestId=${checkinId}&action=handled"
                                       style="background: linear-gradient(135deg, #28a745 0%, #1e7e34 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 6px rgba(40,167,69,0.3);">
                                        ✅ Mark as Handled
                                    </a>
                                </div>

                                <div style="display: inline-block; margin: 0 10px 20px 0;">
                                    <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-checkin/dashboard?action=confirm&requestId=${checkinId}&action=acknowledged"
                                       style="background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%); color: #212529; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block; box-shadow: 0 4px 6px rgba(255,193,7,0.3);">
                                        👀 Acknowledge
                                    </a>
                                </div>
                            </div>

                            <!-- Priority Alert -->
                            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); border: 2px solid #ffc107; padding: 20px; border-radius: 12px; margin-bottom: 30px;">
                                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                                    <span style="font-size: 24px; margin-right: 10px;">⚠️</span>
                                    <strong style="color: #856404; font-size: 16px;">URGENT ACTION REQUIRED</strong>
                                </div>
                                <p style="margin: 0; color: #856404; line-height: 1.5;">
                                    This individual has indicated they need support. Your prompt response and appropriate intervention can make a significant difference in their well-being. Please review the details above and take necessary actions.
                                </p>
                            </div>

                            <!-- Footer -->
                            <div style="text-align: center; padding-top: 30px; border-top: 1px solid #e9ecef;">
                                <p style="color: #6c757d; font-size: 14px; margin: 0;">
                                    This automated notification was sent by the <strong>MWS IntegraLearn Emotional Wellness Platform</strong>
                                </p>
                                <p style="color: #6c757d; font-size: 12px; margin: 10px 0 0 0;">
                                    Request ID: <code style="background: #f8f9fa; padding: 2px 6px; border-radius: 4px;">${checkinId}</code> |
                                    Sent: ${new Date().toLocaleString()}
                                </p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `;

            await this.email.sendEmail(
                supportContactEmail,
                `🚨 URGENT: ${userName} Needs Your Support - ${weatherType.toUpperCase()} State`,
                emailHtml
            );

            console.log(`✅ Enhanced email notification sent to ${supportContactName} (${supportContactEmail})`);
            return { success: true };

        } catch (error) {
            console.error('❌ Email notification error:', error);
            return { success: false, error: error.message };
        }
    }

    // Legacy method for backward compatibility
    async sendSupportRequestNotification(supportRequest) {
        const {
            contactEmail,
            contactName,
            requestedBy,
            userId,
            weatherType,
            presenceLevel,
            capacityLevel,
            submittedAt
        } = supportRequest;

        // Create notification message
        const message = this.createSupportRequestMessage(supportRequest);
        const blocks = this.createSupportRequestBlocks(supportRequest);

        try {
            // Send Slack notification if contact email is available
            if (contactEmail) {
                const slackUser = await this.slack.findUserByEmail(contactEmail);
                if (slackUser) {
                    await this.slack.sendDirectMessage(slackUser.id, message, blocks);
                    console.log(`Slack notification sent to ${contactName} (${contactEmail})`);
                } else {
                    console.log(`Slack user not found for ${contactEmail}, skipping Slack notification`);
                }
            }

            // Send email notification
            const emailHtml = this.createSupportRequestEmailHtml(supportRequest);
            await this.email.sendEmail(
                contactEmail,
                `Support Request from ${requestedBy}`,
                emailHtml
            );
            console.log(`Email notification sent to ${contactName} (${contactEmail})`);

            return { success: true, slackSent: !!slackUser, emailSent: true };

        } catch (error) {
            console.error('Notification send error:', error);
            return { success: false, error: error.message };
        }
    }

    // Create support request message for Slack
    createSupportRequestMessage(request) {
        return `🚨 Support Request Alert\n\n${request.requestedBy} has requested your support.\nWeather: ${request.weatherType}\nPresence: ${request.presenceLevel}/10\nCapacity: ${request.capacityLevel}/10\n\nPlease check the dashboard for details.`;
    }

    // Create Slack blocks for support request
    createSupportRequestBlocks(request) {
        return [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: "🚨 Support Request Alert"
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${request.requestedBy}* has requested your support.`
                }
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*Weather:*\n${request.weatherType}`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Presence:*\n${request.presenceLevel}/10`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Capacity:*\n${request.capacityLevel}/10`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Time:*\n${new Date(request.submittedAt).toLocaleString()}`
                    }
                ]
            },
            {
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "View Details"
                        },
                        style: "primary",
                        url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-checkin/dashboard`
                    },
                    {
                        type: "button",
                        text: {
                            type: "plain_text",
                            text: "Mark as Handled"
                        },
                        style: "primary",
                        action_id: "mark_handled",
                        value: JSON.stringify({ requestId: request.id, action: 'handled' })
                    }
                ]
            }
        ];
    }

    // Create HTML email for support request
    createSupportRequestEmailHtml(request) {
        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 24px;">🚨 Support Request Alert</h1>
                </div>

                <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px;">
                    <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                        <strong>${request.requestedBy}</strong> has requested your support.
                    </p>

                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #495057;">Request Details:</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Weather:</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">${request.weatherType}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Presence Level:</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">${request.presenceLevel}/10</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;"><strong>Capacity Level:</strong></td>
                                <td style="padding: 8px 0; border-bottom: 1px solid #dee2e6;">${request.capacityLevel}/10</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0;"><strong>Submitted:</strong></td>
                                <td style="padding: 8px 0;">${new Date(request.submittedAt).toLocaleString()}</td>
                            </tr>
                        </table>
                    </div>

                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-checkin/dashboard"
                           style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                            View Dashboard
                        </a>
                    </div>

                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-top: 20px;">
                        <p style="margin: 0; color: #856404; font-size: 14px;">
                            <strong>Action Required:</strong> Please review this support request and provide appropriate assistance.
                        </p>
                    </div>

                    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

                    <p style="color: #6c757d; font-size: 12px; text-align: center; margin: 0;">
                        This is an automated notification from the MWS IntegraLearn Emotional Wellness Platform.
                    </p>
                </div>
            </div>
        `;
    }

    // Handle support request confirmation with enhanced details
    async confirmSupportRequest(requestId, contactId, action, details = null, followUpActions = null) {
        try {
            // Update the check-in record with confirmation status
            const EmotionalCheckin = require('../models/EmotionalCheckin');

            const updateData = {
                'supportContactResponse.status': action,
                'supportContactResponse.respondedAt': new Date(),
                'supportContactResponse.contactId': contactId
            };

            if (details) {
                updateData['supportContactResponse.details'] = details;
            }

            if (followUpActions) {
                updateData['supportContactResponse.followUpActions'] = followUpActions;
            }

            await EmotionalCheckin.findByIdAndUpdate(requestId, {
                $set: updateData
            });

            console.log(`✅ Support request ${requestId} ${action} by contact ${contactId}`);
            console.log(`📝 Details: ${details || 'No details provided'}`);
            console.log(`🔄 Follow-up actions: ${followUpActions || 'None specified'}`);

            return { success: true };
        } catch (error) {
            console.error('Support request confirmation error:', error);
            return { success: false, error: error.message };
        }
    }

    // Create confirmation email HTML
    createConfirmationEmailHtml(checkin, action, details) {
        const actionText = action === 'handled' ? 'handled' : 'acknowledged';

        return `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                    <h1 style="margin: 0; font-size: 24px;">✅ Support Request ${actionText.charAt(0).toUpperCase() + actionText.slice(1)}</h1>
                </div>

                <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-radius: 0 0 10px 10px;">
                    <p style="font-size: 16px; color: #333; margin-bottom: 20px;">
                        Your support request from ${new Date(checkin.submittedAt).toLocaleDateString()} has been <strong>${actionText}</strong>.
                    </p>

                    ${details ? `
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #495057;">Follow-up Details:</h3>
                        <p style="margin: 0; color: #6c757d;">${details}</p>
                    </div>
                    ` : ''}

                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/emotional-wellness"
                           style="background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">
                            View My Dashboard
                        </a>
                    </div>

                    <p style="color: #6c757d; font-size: 14px; text-align: center; margin: 20px 0 0 0;">
                        If you need further assistance, please don't hesitate to reach out.
                    </p>
                </div>
            </div>
        `;
    }
}

module.exports = new NotificationService();