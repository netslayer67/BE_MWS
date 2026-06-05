class TwinIngestQueue {
    constructor() {
        this.jobs = [];
        this.processing = false;
        this.worker = null;
        this.maxQueueSize = parseInt(process.env.AI_TWIN_MAX_QUEUE || '2000', 10);
    }

    setWorker(workerFn) {
        this.worker = typeof workerFn === 'function' ? workerFn : null;
        return this;
    }

    enqueue(job = {}) {
        if (!this.worker) {
            return { accepted: false, reason: 'worker_not_registered' };
        }

        if (this.jobs.length >= this.maxQueueSize) {
            this.jobs.shift();
        }

        this.jobs.push({
            ...job,
            enqueuedAt: Date.now()
        });

        if (!this.processing) {
            this.processing = true;
            setImmediate(() => this.processLoop());
        }

        return { accepted: true, size: this.jobs.length };
    }

    async processLoop() {
        while (this.jobs.length > 0) {
            const current = this.jobs.shift();
            try {
                await this.worker(current);
            } catch (error) {
                console.error('[TwinIngestQueue] worker error:', error?.message || error);
            }
        }

        this.processing = false;
    }

    getStats() {
        return {
            queued: this.jobs.length,
            processing: this.processing,
            maxQueueSize: this.maxQueueSize
        };
    }
}

module.exports = new TwinIngestQueue();
