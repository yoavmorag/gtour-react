/**
 * @typedef {Object} Point
 * @property {string} location - Name or description of the location.
 * @property {number} longitude
 * @property {number} latitude
 * @property {boolean} [visited]
 * @property {boolean} [ready]
 * @property {string} [audio_path]
 * @property {string} [info]
 */

/**
 * @typedef {Object} Tour
 * @property {string} tour_id
 * @property {string} tour_name
 * @property {string} tour_guide_personality
 * @property {string} user_preferences
 * @property {Point[]} points
 * @property {string} [audio_output_dir]
 */

const BASE_URL = 'http://localhost:8000/' //; 'http://guyhadad.c.googlers.com:8000/';

// --- Helper functions ---
async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function postJson(url, data) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

// --- API Methods ---

/**
 * List tours (GET /tour/).
 * This function retrieves a list of tour objects.
 * @returns {Promise<Tour[]>}
 */
export async function listTours() {
    const res = await getJson(`${BASE_URL}tour/`);
    // If the backend returns {results: {id: stringifiedTour, ...}}
    if (res.results) {
        return Object.values(res.results).map(tour =>
            typeof tour === 'string' ? JSON.parse(tour) : tour
        );
    }
    // If the backend returns an array directly
    if (Array.isArray(res)) return res;
    // If the backend returns an object of tours
    return Object.values(res);
}

/**
 * Save a tour (POST /tour).
 * @param {Object} params
 * @param {string} params.tour_name
 * @param {string} params.tour_guide_personality
 * @param {string} params.user_preferences
 * @param {Point[]} params.points
 * @returns {Promise<Tour>}
 */
export async function saveTour({ tour_name, tour_guide_personality, user_preferences, points }) {
    const res = await postJson(`${BASE_URL}tour`, {
        tour_name,
        tour_guide_personality,
        user_preferences,
        points,
    });
    // If backend returns stringified tour, parse it
    if (typeof res === 'string') return JSON.parse(res);
    // If backend returns { ...tour fields... }
    if (res && res.tour_id) return res;
    // If backend wraps in a message
    if (res && res.tour) return typeof res.tour === 'string' ? JSON.parse(res.tour) : res.tour;
    throw new Error('Unexpected response format from saveTour');
}

/**
 * Get a tour by ID (GET /tour/<tour_id>).
 * @param {string} tour_id
 * @returns {Promise<Tour>}
 */
export async function getTour(tour_id) {
    const res = await getJson(`${BASE_URL}tour/${encodeURIComponent(tour_id)}`);
    // If backend returns stringified tour, parse it
    if (typeof res === 'string') return JSON.parse(res);
    // If backend returns { ...tour fields... }
    if (res && res.tour_id) return res;
    // If backend wraps in a tour property
    if (res && res.tour) return typeof res.tour === 'string' ? JSON.parse(res.tour) : res.tour;
    throw new Error('Unexpected response format from getTour');
}

