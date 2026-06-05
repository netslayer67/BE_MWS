const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const devTopologyTelemetryService = require('../services/devTopologyTelemetryService');

class OpenRouterChatService {
    constructor() {
        this.lastRequestTime = 0;
        this.disabledUntil = 0;
        this.lastConfigSignature = '';
        this.envFilePath = path.resolve(__dirname, '../../.env');
        this.lastEnvMtimeMs = 0;
        this.lastEnvCheckAt = 0;
        this.envReloadCheckIntervalMs = parseInt(process.env.OPENROUTER_ENV_CHECK_INTERVAL_MS || '10000', 10);
        this.reloadEnvFileIfUpdated(true);
        this.refreshFromEnv({ logInit: true });
    }

    reloadEnvFileIfUpdated(force = false) {
        const now = Date.now();
        if (!force && Number.isFinite(this.lastEnvCheckAt) && (now - this.lastEnvCheckAt) < this.envReloadCheckIntervalMs) {
            return;
        }
        this.lastEnvCheckAt = now;

        try {
            const stats = fs.statSync(this.envFilePath);
            const shouldReload = force || stats.mtimeMs > this.lastEnvMtimeMs;

            if (!shouldReload) return;

            dotenv.config({ path: this.envFilePath, override: true });
            this.lastEnvMtimeMs = stats.mtimeMs;
        } catch (error) {
            if (force) {
                dotenv.config();
            }
        }
    }

    parseModelList(value = '') {
        return value
            .split(',')
            .map((item) => this.normalizeModelId(item))
            .filter(Boolean);
    }

    normalizeModelId(value = '') {
        const normalized = String(value || '').trim();
        if (!normalized) return '';
        // Preserve the :free suffix — OpenRouter uses it to route to the free-tier
        // variant of a model, which is a distinct endpoint from the paid version.
        return normalized;
    }

    getEnvConfig() {
        const apiKey = process.env.OPENROUTER_API_KEY || '';
        const baseUrl = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
        const primaryModel = this.normalizeModelId(process.env.OPENROUTER_MODEL || 'arcee-ai/trinity-large-preview');
        const fallbackModels = this.parseModelList(process.env.OPENROUTER_FALLBACK_MODELS || '');
        const maxTokens = parseInt(process.env.OPENROUTER_MAX_TOKENS || '1024', 10);
        const temperature = parseFloat(process.env.OPENROUTER_TEMPERATURE || '0.4');
        const minDelay = parseInt(process.env.OPENROUTER_MIN_DELAY_MS || '0', 10);
        const timeoutMs = parseInt(process.env.OPENROUTER_TIMEOUT_MS || '20000', 10);
        const httpReferer = process.env.OPENROUTER_HTTP_REFERER || process.env.FRONTEND_URL || '';
        const appName = process.env.OPENROUTER_APP_NAME || 'IntegraLearn AI Chat';

        return {
            apiKey,
            baseUrl,
            primaryModel,
            fallbackModels,
            maxTokens,
            temperature,
            minDelay,
            timeoutMs,
            httpReferer,
            appName
        };
    }

    buildConfigSignature(config) {
        return [
            config.apiKey,
            config.baseUrl,
            config.primaryModel,
            config.fallbackModels.join(','),
            String(config.maxTokens),
            String(config.temperature),
            String(config.minDelay),
            String(config.timeoutMs),
            config.httpReferer,
            config.appName
        ].join('|');
    }

    refreshFromEnv(options = {}) {
        const { logInit = false } = options;
        this.reloadEnvFileIfUpdated();
        const nextConfig = this.getEnvConfig();
        const nextSignature = this.buildConfigSignature(nextConfig);
        const changed = nextSignature !== this.lastConfigSignature;

        this.apiKey = nextConfig.apiKey;
        this.baseUrl = nextConfig.baseUrl;
        this.primaryModel = nextConfig.primaryModel;
        this.fallbackModels = nextConfig.fallbackModels;
        this.maxTokens = nextConfig.maxTokens;
        this.temperature = nextConfig.temperature;
        this.minDelay = nextConfig.minDelay;
        this.timeoutMs = nextConfig.timeoutMs;
        this.httpReferer = nextConfig.httpReferer;
        this.appName = nextConfig.appName;

        if (!this.apiKey) {
            console.warn('⚠️ OPENROUTER_API_KEY is not configured. Student AI chat will use fallback responses.');
        }

        if (changed || logInit) {
            this.lastConfigSignature = nextSignature;
            console.log(`Using OpenRouter Chat primary model: ${this.primaryModel}`);
        }
    }

    getModelCandidates(skipRefresh = false) {
        if (!skipRefresh) this.refreshFromEnv();
        const ordered = [this.primaryModel, ...this.fallbackModels].filter(Boolean);
        return Array.from(new Set(ordered));
    }

    getModelCandidatesWithOverrides(options = {}, skipRefresh = false) {
        if (!skipRefresh) this.refreshFromEnv();

        const explicitCandidates = Array.isArray(options.modelCandidates)
            ? options.modelCandidates
            : this.parseModelList(String(options.modelCandidates || ''));
        const explicitPrimary = this.normalizeModelId(options.model || options.primaryModel || '');
        const explicitFallbacks = Array.isArray(options.fallbackModels)
            ? options.fallbackModels
            : this.parseModelList(String(options.fallbackModels || ''));

        const normalizedCandidates = explicitCandidates
            .map((entry) => this.normalizeModelId(entry))
            .filter(Boolean);
        const normalizedFallbacks = explicitFallbacks
            .map((entry) => this.normalizeModelId(entry))
            .filter(Boolean);

        const overrideOrdered = [
            explicitPrimary,
            ...normalizedCandidates,
            ...normalizedFallbacks
        ].filter(Boolean);

        if (overrideOrdered.length > 0) {
            return Array.from(new Set(overrideOrdered));
        }

        return this.getModelCandidates(true);
    }

    isAvailable(skipRefresh = false) {
        if (!skipRefresh) this.refreshFromEnv();
        if (!this.apiKey) return false;
        if (Date.now() < this.disabledUntil) return false;
        return true;
    }

    markTemporarilyUnavailable(durationMs = 60_000) {
        this.disabledUntil = Date.now() + durationMs;
    }

    async waitForRateLimitWindow() {
        if (!Number.isFinite(this.minDelay) || this.minDelay <= 0) return;
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed >= this.minDelay) return;

        const waitTime = this.minDelay - elapsed;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    normalizeMessages(input) {
        if (!Array.isArray(input)) {
            return [
                {
                    role: 'user',
                    content: String(input || '')
                }
            ];
        }

        return input
            .map((message = {}) => {
                const role = ['system', 'user', 'assistant'].includes(message.role)
                    ? message.role
                    : 'user';
                const content = String(message.content || '').trim();
                if (!content) return null;
                return { role, content };
            })
            .filter(Boolean);
    }

    async callChatCompletion(model, promptOrMessages, options = {}) {
        this.refreshFromEnv();
        const messages = this.normalizeMessages(promptOrMessages);
        const timeoutMs = Math.max(5000, Number(options.timeoutMs || this.timeoutMs || 20000));
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = Date.now();

        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'IntegraLearn-Backend/1.0'
        };

        if (this.httpReferer) {
            headers['HTTP-Referer'] = this.httpReferer;
        }

        if (this.appName) {
            headers['X-Title'] = this.appName;
        }

        try {
            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: typeof options.temperature === 'number' ? options.temperature : this.temperature,
                    max_tokens: typeof options.maxTokens === 'number'
                        ? options.maxTokens
                        : Math.min(Math.max(this.maxTokens, 128), 8192),
                    stream: false
                })
            });

            const payload = await response.json().catch(() => ({}));
            const requestId = response.headers.get('x-request-id') ||
                response.headers.get('x-openrouter-request-id') ||
                null;

            if (!response.ok) {
                const errorMessage = payload?.error?.message ||
                    payload?.message ||
                    `OpenRouter request failed (${response.status})`;

                const error = new Error(errorMessage);
                error.status = response.status;
                error.payload = payload;
                error.requestId = requestId;
                throw error;
            }

            this.lastRequestTime = Date.now();
            try {
                const firstChoiceText = payload?.choices?.[0]?.message?.content || '';
                devTopologyTelemetryService.recordProviderCall({
                    provider: 'openrouter',
                    model,
                    ok: true,
                    latencyMs: Date.now() - startedAt,
                    throughputRpm: Math.max(1, Math.round(60000 / Math.max(200, Date.now() - startedAt))),
                    tokensEstimate: Math.round(String(firstChoiceText).length / 4)
                });
            } catch (telemetryError) {
                console.warn('OpenRouter telemetry tracking failed:', telemetryError.message);
            }
            return { ...payload, _model: model, _requestId: requestId };
        } catch (error) {
            try {
                devTopologyTelemetryService.recordProviderCall({
                    provider: 'openrouter',
                    model,
                    ok: false,
                    latencyMs: Date.now() - startedAt,
                    throughputRpm: 1,
                    tokensEstimate: 0
                });
            } catch (telemetryError) {
                console.warn('OpenRouter telemetry error tracking failed:', telemetryError.message);
            }
            if (error?.name === 'AbortError') {
                const timeoutError = new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
                timeoutError.status = 504;
                throw timeoutError;
            }
            throw error;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    async generateContent(promptOrMessages, options = {}) {
        this.refreshFromEnv();

        if (!this.isAvailable(true)) {
            throw new Error('OpenRouter chat service unavailable');
        }

        await this.waitForRateLimitWindow();

        const models = this.getModelCandidatesWithOverrides(options, true);
        let lastError = null;

        for (let index = 0; index < models.length; index += 1) {
            const model = models[index];
            try {
                return await this.callChatCompletion(model, promptOrMessages, options);
            } catch (error) {
                lastError = error;
                const status = Number(error?.status || 0);
                const message = String(error?.message || '');
                const isAuthError = status === 401 || status === 403 || /unauth|invalid api key|forbidden/i.test(message);
                const isRateLimit = status === 429 || /quota|rate limit|too many requests/i.test(message);
                const hasNextModel = index < models.length - 1;

                if (isAuthError) {
                    break;
                }

                if (isRateLimit && !hasNextModel) {
                    this.markTemporarilyUnavailable(60_000);
                }
            }
        }

        const requestIdSuffix = lastError?.requestId ? ` [request_id=${lastError.requestId}]` : '';
        throw new Error(`OpenRouter chat failed: ${lastError?.message || 'unknown error'}${requestIdSuffix}`);
    }

    async testConnection() {
        if (!this.isAvailable()) {
            throw new Error('OpenRouter chat connection test failed: service unavailable');
        }

        const response = await this.generateContent('Reply exactly with: OPENROUTER_CHAT_OK', {
            temperature: 0,
            maxTokens: 64
        });
        const text = response?.choices?.[0]?.message?.content || '';
        return text.includes('OPENROUTER_CHAT_OK');
    }
}

module.exports = new OpenRouterChatService();
