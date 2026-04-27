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

module.exports = generatePersonalizedGreeting;
