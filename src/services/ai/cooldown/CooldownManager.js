class CooldownManager {
    constructor(cooldownDurationMs) {
        this.cooldownUntil = 0;
        this.cooldownDurationMs = cooldownDurationMs;
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

module.exports = CooldownManager;
