function parseTextResponse(aiText, checkinData) {
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
        psychologicalInsights: checkinData?.userRole === 'student'
            ? "Your check-in shows good emotional awareness. Naming your feelings is a strong step toward better wellbeing."
            : "Your check-in shows you're actively engaging with your emotional well-being, which is a positive step toward mental health awareness.",
        motivationalMessage: checkinData?.userRole === 'student'
            ? "You are growing every day. Small positive steps still count, and you are not alone."
            : "You are capable of amazing things! Keep believing in yourself and your journey.",
        needsSupport: checkinData.capacityLevel <= 3 || checkinData.presenceLevel <= 3,
        confidence: 70
    };
}

module.exports = parseTextResponse;
