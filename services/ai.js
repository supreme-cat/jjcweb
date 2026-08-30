const axios = require('axios');

/**
 * Batch evaluates wave trainees using Google Gemini API.
 */
async function evaluateWaveTrainees(traineesWithNotes = []) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return {
            ok: false,
            error: 'Missing GEMINI_API_KEY in environment variables.'
        };
    }

    if (!traineesWithNotes || traineesWithNotes.length === 0) {
        return {
            ok: false,
            error: 'No trainees to evaluate.'
        };
    }

    // Format all candidate notes grouped by session
    const formattedCandidates = traineesWithNotes.map((c, idx) => {
        let notesText = '';
        if (c.notes && c.notes.length > 0) {
            const grouped = {};
            c.notes.forEach((n) => {
                const s = n.sessionNumber || 1;
                if (!grouped[s]) grouped[s] = [];
                grouped[s].push(`    - [${(n.outcome || 'Neutral').toUpperCase()}] (${n.staffUsername}): ${n.content}`);
            });
            notesText = Object.keys(grouped).sort((a, b) => Number(a) - Number(b)).map((s) => `  * Session ${s}:\n${grouped[s].join('\n')}`).join('\n');
        } else {
            notesText = '  * (No observation notes recorded - candidate was unobserved)';
        }

        return `Candidate ${idx + 1}: "${c.username}" (Roblox ID: ${c.robloxId || 'N/A'})\n${notesText}`;
    }).join('\n\n---\n\n');

    const prompt = `You are the Lead Staff Evaluator for JJC Production, a disciplined ER:LC emergency response organization.
Perform an objective assessment for every candidate in the current training wave based strictly on the recorded instructor notes.

=== WAVE CANDIDATE OBSERVATION LOGS ===
${formattedCandidates}
=======================================

Evaluation Rubric:
1. Score from 0 to 100 based on driving competence, radio etiquette, roleplay compliance, and teamwork.
2. Score >= 70 -> "PASS". Score < 70 -> "FAIL". Candidates with 0 notes should be scored 0 and marked "FAIL" due to insufficient data.
3. Provide:
   - "summary": Internal staff-only concise summary.
   - "decisionReason": Direct explanation of the outcome sent directly to the trainee via Discord DM.
   - "traineeFeedback": Actionable feedback and next steps sent in trainee Discord DM.

Return ONLY a valid, raw JSON array of objects (no markdown blocks, no code fences):
[
  {
    "traineeUsername": "Candidate Username",
    "decision": "PASS" or "FAIL",
    "score": number between 0 and 100,
    "summary": "Internal staff summary",
    "decisionReason": "Clear reason for determination sent to trainee",
    "traineeFeedback": "Constructive feedback and tips for trainee"
  }
]`;

    try {
        const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.2
            }
        }, { timeout: 25000 });

        const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
            throw new Error('Empty response received from Gemini.');
        }

        const cleanJson = rawText.replace(/```json\s*|\s*```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        return {
            ok: true,
            evaluations: Array.isArray(parsed) ? parsed : [parsed],
            evaluatedAt: new Date().toISOString()
        };
    } catch (err) {
        console.error('[GEMINI AI] Wave evaluation error:', err.response?.data || err.message);
        return {
            ok: false,
            error: err.response?.data?.error?.message || err.message || 'Failed to complete AI evaluation.'
        };
    }
}

module.exports = {
    evaluateWaveTrainees
};
