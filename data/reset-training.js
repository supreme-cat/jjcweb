const fs = require('fs');
const path = require('path');

// Define all files related strictly to Training Controls and their default initial state
const resetTargets = [
    {
        filePath: path.join(__dirname, 'current_trainees.json'),
        defaultData: []
    },
    {
        filePath: path.join(__dirname, 'former_trainees.json'),
        defaultData: []
    },
    {
        filePath: path.join(__dirname, 'kicked_trainees.json'),
        defaultData: []
    },
    {
        filePath: path.join(__dirname, 'wave_state.json'),
        defaultData: { currentWave: 1, history: [] }
    },
    {
        filePath: path.join(__dirname, 'session_data.json'),
        defaultData: { activeSession: null, notes: [] }
    }
];

function resetTrainingControls() {
    console.log('--- Starting Training Controls Data Reset ---');

    resetTargets.forEach(({ filePath, defaultData }) => {
        try {
            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2), 'utf8');
            console.log(`[SUCCESS] Reset: ${path.basename(filePath)}`);
        } catch (err) {
            console.error(`[ERROR] Failed to reset ${path.basename(filePath)}:`, err.message);
        }
    });

    console.log('--- Reset Complete. All training controls data has been cleared. ---');
}

resetTrainingControls();