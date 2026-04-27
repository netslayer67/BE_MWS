const validateAnalysis = require('./validateAnalysis');

function parseAIResponse(aiResponse, checkinData) {
    try {
        console.log('🔍 Raw AI Response:', aiResponse);

        // Check if AI response was cut off due to token limits
        const candidate = aiResponse.candidates?.[0];
        if (candidate?.finishReason === 'MAX_TOKENS') {
            console.warn('⚠️ AI response was truncated due to token limit');
            throw new Error('AI response incomplete - token limit reached');
        }

        // Handle the new Google Gen AI SDK response format
        // Extract text from candidates[0].content.parts[0].text
        const aiText = aiResponse.candidates?.[0]?.content?.parts?.[0]?.text ||
            aiResponse.candidates?.[0]?.content?.text;

        if (!aiText) {
            console.warn('⚠️ No text content found in AI response');
            throw new Error('No text content found in AI response');
        }

        console.log('📝 AI Text Content:', aiText);

        // Fix malformed JSON that includes markdown/code wrappers
        let cleanText = aiText.trim();

        // Strip fenced code blocks such as ```json ... ```
        if (cleanText.startsWith('```')) {
            cleanText = cleanText
                .replace(/^```(?:json)?/i, '')
                .replace(/```$/i, '')
                .trim();
            console.log('?? Stripped markdown fences');
        }

        // Remove "json" word at the beginning if present
        if (cleanText.toLowerCase().startsWith('json')) {
            cleanText = cleanText.substring(4).trim();
            console.log('?? Removed json wrapper');
        }

        // When AI wraps JSON with extra prose, keep only the object portion
        const firstBrace = cleanText.indexOf('{');
        const lastBrace = cleanText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanText = cleanText.substring(firstBrace, lastBrace + 1).trim();
        }

        console.log('?? Cleaned Text:', cleanText);

        // Try to parse the cleaned JSON
        const parsed = JSON.parse(cleanText);
        console.log('✅ Successfully parsed AI response');

        // Ensure motivationalMessage exists and is not the forbidden template
        if (!parsed.motivationalMessage || parsed.motivationalMessage.includes("Whatever you're experiencing")) {
            throw new Error('AI generated invalid motivational message - template detected');
        }

        return validateAnalysis(parsed, checkinData);

    } catch (error) {
        console.error('❌ Failed to parse AI response:', error.message);
        console.error('❌ Full error details:', error);

        // Log the problematic content for debugging
        if (error.message.includes('Unexpected token')) {
            const candidate = aiResponse.candidates?.[0];
            const problematicText = candidate?.content?.parts?.[0]?.text || candidate?.content?.text;
            console.error('❌ Problematic text that failed to parse:', problematicText);
        }

        throw new Error(`AI response parsing failed: ${error.message} `);
    }
}

module.exports = parseAIResponse;
