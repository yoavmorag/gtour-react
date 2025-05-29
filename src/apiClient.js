/**
 * @typedef {Object} PointNugget
 * @property {string} id - Unique ID for the nugget.
 * @property {string} [question] - User's question if it's a follow-up.
 * @property {string} [answer] - Generated answer/content.
 * @property {string} [audio_path] - Path to the audio file.
 * @property {boolean} ready - Whether the nugget content and audio are ready.
 */

/**
 * @typedef {Object} Point
 * @property {string} name - Name or description of the location.
 * @property {number} longitude - Longitude coordinate.
 * @property {number} latitude - Latitude coordinate.
 * @property {PointNugget[]} [content] - Array of content nuggets for the point.
 * @property {boolean} [visited] - Client-side: has the user visited this point during navigation.
 * @property {boolean} [ready] - Client-side: derived from content[0].ready for initial point audio.
 * @property {string} [audio_path] - Client-side: derived from content[0].audio_path for initial point audio.
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

const BASE_URL = 'http://localhost:8000/'; // Adjust as needed

// --- Helper functions ---
async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const errorText = await res.text();
        console.error("API Error:", errorText);
        throw new Error(`API request failed: ${res.status} ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

async function postJson(url, data) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) {
        const errorText = await res.text();
        console.error("API Error:", errorText);
        throw new Error(`API request failed: ${res.status} ${res.statusText} - ${errorText}`);
    }
    return res.json();
}

// --- API Data Transformation Helpers ---
function mapPointToApi(clientPoint) {
    return {
        name: clientPoint.name,
        lat: clientPoint.lat,
        lng: clientPoint.lng,
    };
}

function mapPointFromApi(apiPoint) {
    let finalLat, finalLng;

    // Check for 'latitude' or 'lat'
    if (apiPoint.latitude !== undefined) {
        finalLat = apiPoint.latitude;
    } else if (apiPoint.lat !== undefined) {
        finalLat = apiPoint.lat;
    } else {
        console.warn("API Point is missing latitude/lat field:", apiPoint);
        // finalLat will be undefined; you might want to default or throw
    }

    // Check for 'longitude' or 'lng'
    if (apiPoint.longitude !== undefined) {
        finalLng = apiPoint.longitude;
    } else if (apiPoint.lng !== undefined) {
        finalLng = apiPoint.lng;
    } else {
        console.warn("API Point is missing longitude/lng field:", apiPoint);
        // finalLng will be undefined
    }
    
    // Ensure that lat and lng are numbers. If they are still undefined here,
    // toFixed will fail. This logging helps, but the root issue is missing data.
    if (typeof finalLat !== 'number' || typeof finalLng !== 'number') {
        console.warn('Latitude or Longitude is not a number after mapping from API or is missing:', 
                     { name: apiPoint.name, originalData: apiPoint, mappedLat: finalLat, mappedLng: finalLng });
        // Consider setting defaults if this is acceptable, e.g., finalLat = finalLat ?? 0;
    }

    return {
        ...apiPoint, // Spread all original API point fields first
        lat: finalLat,    // Then override/set lat, potentially to undefined if not found
        lng: finalLng,    // Then override/set lng, potentially to undefined if not found
        content: apiPoint.content || [], // Ensure content is an array
    };
}

function mapTourFromApi(apiTour) {
    if (!apiTour) return null;
    return {
        ...apiTour,
        points: (apiTour.points || []).map(mapPointFromApi),
    };
}


// --- API Methods ---

/**
 * List tours (GET /tour).
 * @returns {Promise<Tour[]>}
 */
export async function listTours() {
    const res = await getJson(`${BASE_URL}tour`);
    return Object.values(res).map(mapTourFromApi);
}

/**
 * Create a new tour (POST /tour).
 * @param {Object} params
 * @param {string} params.tour_name
 * @param {string} params.tour_guide_personality
 * @param {string} params.user_preferences
 * @param {Array<Object>} params.points - Client points with lat, lng, name.
 * @returns {Promise<Tour>}
 */
export async function createTour({ tour_name, tour_guide_personality, user_preferences, points }) {
    const pointsForApi = points.map(mapPointToApi);

    const payload = {
        tour_name,
        tour_guide_personality,
        user_preferences,
        points: pointsForApi,
    };
    
    // console.log("Sending to createTour API:", JSON.stringify(payload, null, 2)); // For debugging request

    const res = await postJson(`${BASE_URL}tour`, payload);
    
    // console.log("Received from createTour API:", JSON.stringify(res, null, 2)); // For debugging response

    if (res && res.tour_id) {
        return mapTourFromApi(res);
    }
    throw new Error('Unexpected response format from createTour');
}

/**
 * Get a tour by ID (GET /tour/{tour_id}).
 * @param {string} tour_id
 * @returns {Promise<Tour>}
 */
export async function getTour(tour_id) {
    const res = await getJson(`${BASE_URL}tour/${encodeURIComponent(tour_id)}`);
    if (res && res.tour_id) {
        return mapTourFromApi(res);
    }
    throw new Error('Unexpected response format from getTour');
}

/**
 * Post a question for a specific point in a tour (POST /tour/{tour_id}/point/{point_name}).
 * @param {string} tour_id
 * @param {string} point_name
 * @param {string} question
 * @returns {Promise<{nugget: PointNugget, nugget_id: string}>}
 */
export async function postPointNugget(tour_id, point_name, question) {
    const res = await postJson(`${BASE_URL}tour/${encodeURIComponent(tour_id)}/point/${encodeURIComponent(point_name)}`, {
        question,
    });
    if (res && res.nugget && res.nugget_id) {
        return res;
    }
    throw new Error('Unexpected response format from postPointNugget');
}

/**
 * Get details for a specific nugget (GET /tour/{tour_id}/point/{point_name}/nugget/{nugget_id}).
 * @param {string} tour_id
 * @param {string} point_name
 * @param {string} nugget_id
 * @returns {Promise<{nugget: PointNugget}>}
 */
export async function getNuggetDetails(tour_id, point_name, nugget_id) {
    const res = await getJson(`${BASE_URL}tour/${encodeURIComponent(tour_id)}/point/${encodeURIComponent(point_name)}/nugget/${encodeURIComponent(nugget_id)}`);
    if (res && res.nugget) {
        return res;
    }
    throw new Error('Unexpected response format from getNuggetDetails');
}