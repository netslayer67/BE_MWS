/**
 * One-off script: sends 2 test Slack notifications to sayed.jilliyan@millennia21.id
 * as a representative of Pak Abu's account.
 *
 * Usage:  node src/scripts/sendTestSlackNotifications.js
 */

require('dotenv').config();
const notificationService = require('../services/notificationService');
const { buildFrontendUrl } = require('../utils/frontendUrl');

const TARGET_EMAIL   = 'sayed.jilliyan@millennia21.id';
const TEACHER_NAME   = 'Abu Bakar Ali';
const STUDENT_NAME   = 'Sienna Ameerah Kasyafani';
const OVERDUE_DAYS   = 61;
const FREQUENCY      = 'Weekly';
const SETTINGS_URL   = buildFrontendUrl('/notifications/settings');
const CHECKIN_URL    = `${buildFrontendUrl('/emotional-checkin/teacher-dashboard')}?search=${encodeURIComponent(STUDENT_NAME)}`;
const MTSS_BASE_URL  = buildFrontendUrl('/mtss/teacher');

// ── helpers ──────────────────────────────────────────────────────────────────

function buildCheckinDueBlocks() {
    return [
        { type: 'section', text: { type: 'mrkdwn', text: '*⚠️ MTSS UPDATE*' } },
        { type: 'header',  text: { type: 'plain_text', text: `Check-in Due (${OVERDUE_DAYS} days overdue)`, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: `Hi *${TEACHER_NAME}*,\n\nYour student *${STUDENT_NAME}* has not completed their daily check-in. Monitoring frequency: ${FREQUENCY}. Please follow up.` } },
        { type: 'divider' },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*👤 Student(s):*\n${STUDENT_NAME}` },
                { type: 'mrkdwn', text: `*📊 Status:*\n🔴 Overdue — ${OVERDUE_DAYS} days` },
                { type: 'mrkdwn', text: `*📅 Frequency:*\n${FREQUENCY}` },
            ],
        },
        {
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '📋 View Student Check-ins', emoji: true },
                    style: 'primary',
                    url: CHECKIN_URL,
                },
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '⚙️ Notification Settings', emoji: true },
                    url: SETTINGS_URL,
                },
            ],
        },
        {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `📨 *MWS IntegraLearn* · Millennia World School · <${SETTINGS_URL}|Manage notifications>` }],
        },
    ];
}

function buildMtssAlertBlocks() {
    const mtssStudentUrl = `${MTSS_BASE_URL}?tab=students&search=${encodeURIComponent(STUDENT_NAME)}`;
    return [
        { type: 'section', text: { type: 'mrkdwn', text: '*🚨 MTSS UPDATE*' } },
        { type: 'header',  text: { type: 'plain_text', text: 'MTSS Progress Update Due', emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: `Hi *${TEACHER_NAME}*,\n\nYour MTSS progress update for *${STUDENT_NAME}* is due. Please review the student's intervention plan and submit an update.` } },
        { type: 'divider' },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*👤 Student(s):*\n${STUDENT_NAME}` },
                { type: 'mrkdwn', text: `*📊 Status:*\n🔴 Progress update overdue` },
                { type: 'mrkdwn', text: `*📅 Frequency:*\n${FREQUENCY}` },
            ],
        },
        {
            type: 'actions',
            elements: [
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '✏️ Submit Progress Update', emoji: true },
                    style: 'primary',
                    url: mtssStudentUrl,
                },
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '📋 View All Students', emoji: true },
                    url: `${MTSS_BASE_URL}?tab=students`,
                },
                {
                    type: 'button',
                    text: { type: 'plain_text', text: '⚙️ Notification Settings', emoji: true },
                    url: SETTINGS_URL,
                },
            ],
        },
        {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: `📨 *MWS IntegraLearn* · Millennia World School · <${SETTINGS_URL}|Manage notifications>` }],
        },
    ];
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🔔 Sending test Slack notifications → ${TARGET_EMAIL}\n`);

    const slackUser = await notificationService.slack.findUserByEmail(TARGET_EMAIL);
    if (!slackUser?.id) {
        console.error('❌ Slack user not found for', TARGET_EMAIL);
        process.exit(1);
    }
    console.log(`✅ Slack user found: ${slackUser.id} (${slackUser.real_name || TARGET_EMAIL})\n`);

    // ── 1. Daily Check-in Due ─────────────────────────────────────────────────
    console.log('📤 [1/2] Sending: Daily Check-in Due notification...');
    await notificationService.slack.sendDirectMessage(
        slackUser.id,
        `⚠️ MTSS UPDATE — Check-in Due (${OVERDUE_DAYS} days overdue)\nStudent: ${STUDENT_NAME}`,
        buildCheckinDueBlocks(),
    );
    console.log('✅ Daily check-in notification sent!\n');

    // ── 2. MTSS Progress Update Due ───────────────────────────────────────────
    console.log('📤 [2/2] Sending: MTSS Progress Update notification...');
    await notificationService.slack.sendDirectMessage(
        slackUser.id,
        `🚨 MTSS UPDATE — Progress Update Due\nStudent: ${STUDENT_NAME}`,
        buildMtssAlertBlocks(),
    );
    console.log('✅ MTSS progress notification sent!\n');

    console.log('🎉 Both notifications delivered successfully.');
    process.exit(0);
}

main().catch((err) => {
    console.error('❌ Script failed:', err.message || err);
    process.exit(1);
});
