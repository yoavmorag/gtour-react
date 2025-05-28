import React, { useState, useCallback, useRef } from 'react';
import { GoogleMap, useLoadScript, Marker, Polyline } from '@react-google-maps/api';
import logo from '../images/logo.png';

// --- Configuration ---
const Maps_API_KEY = 'AIzaSyAgdChPHm7WT3XzgZAFK2xFyYu3fbl6Kq0';
const LIBRARIES = ['places', 'geometry'];

const mapContainerStyle = {
    width: '100vw',
    height: '100vh',
};

const defaultCenter = {
    lat: 32.0853, // Example: Tel Aviv
    lng: 34.7818,
};

// Helper: Haversine distance (meters)
function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Helper: decode Google polyline
function decodePolyline(encoded) {
    let points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        let dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
}


// // Check if user location is on the polyline
// function isOnPolyline(path, userLocation, threshold = 20) {
//     for (let i = 0; i < path.length - 1; i++) {
//         const a = path[i];
//         const b = path[i + 1];
//         // Project userLocation onto segment ab
//         const t = ((userLocation.lat - a.lat) * (b.lat - a.lat) + (userLocation.lng - a.lng) * (b.lng - a.lng)) /
//                   ((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2);
//         const tClamped = Math.max(0, Math.min(1, t));
//         const proj = {
//             lat: a.lat + tClamped * (b.lat - a.lat),
//             lng: a.lng + tClamped * (b.lng - a.lng)
//         };
//         const d = getDistanceMeters(userLocation.lat, userLocation.lng, proj.lat, proj.lng);
//         if (d < threshold) return true;
//     }
//     return false;
// }

function MapComponent() {
    const { isLoaded, loadError } = useLoadScript({
        googleMapsApiKey: Maps_API_KEY,
        libraries: LIBRARIES,
    });

    const [tourPoints, setTourPoints] = useState([]);
    const mapRef = useRef();

    //const lastSplitIdxRef = useRef(0);
    const lastSplitRef = useRef({ idx: 0, snapped: null });
    
    const directionsServiceRef = useRef(null);
    const directionsRendererRef = useRef(null);
    const searchInputRef = useRef(null);

    const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
    const lastCalculatedTourPointsRef = useRef([]);

    const [isNavigating, setIsNavigating] = useState(false);
    const [currentNavIndex, setCurrentNavIndex] = useState(0);
    const [demoMode, setDemoMode] = useState(false);
    const [simulatedLocation, setSimulatedLocation] = useState(null);

    // For navigation progress
    const [routePath, setRoutePath] = useState([]);
    const [currentUserLocation, setCurrentUserLocation] = useState(null);

    // Add default ready/visited to new points
    const addTourPoint = useCallback((point) => {
        setTourPoints((currentPoints) => [
            ...currentPoints,
            {
                ...point,
                ready: false,
                visited: false,
            }
        ]);
    }, []);

    // --- Initialize Google Maps objects and Autocomplete ---
    const initializeGoogleMapsObjects = useCallback(() => {
        if (!window.google || !mapRef.current) {
            return false;
        }

        if (!directionsServiceRef.current) {
            directionsServiceRef.current = new window.google.maps.DirectionsService();
        }

        if (!directionsRendererRef.current) {
            directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
                map: mapRef.current,
                suppressMarkers: true,
                polylineOptions: {
                    strokeColor: "#2196f3", // blue
                    strokeOpacity: 0,
                    strokeWeight: 4,
                    icons: [{
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE, // Use a circle for dots
                            fillOpacity: 1,
                            fillColor: "#2196f3",
                            strokeOpacity: 1,
                            strokeColor: "#2196f3",
                            scale: 3 // Adjust size of the dot
                        },
                        offset: '0',
                        repeat: '20px'
                    }],
                },
            });
        }

        if (searchInputRef.current && !searchInputRef.current.autocomplete) {
            const autocomplete = new window.google.maps.places.Autocomplete(
                searchInputRef.current,
                { types: ['establishment', 'geocode'] }
            );
            autocomplete.bindTo('bounds', mapRef.current);

            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                if (!place.geometry || !place.geometry.location) {
                    console.error("Returned place contains no geometry");
                    return;
                }
                addTourPoint({
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    name: place.name || place.formatted_address,
                });

                if (mapRef.current) {
                    mapRef.current.panTo(place.geometry.location);
                    mapRef.current.setZoom(15);
                }
                searchInputRef.current.value = "";
            });
            searchInputRef.current.autocomplete = autocomplete;
        }
        return true;
    }, [addTourPoint]);

    // Effect to initialize Google Maps objects once loaded
    React.useEffect(() => {
        if (isLoaded) {
            initializeGoogleMapsObjects();
        }
    }, [isLoaded, initializeGoogleMapsObjects]);

    // Map load handler
    const onMapLoad = useCallback((map) => {
        mapRef.current = map;
        initializeGoogleMapsObjects();
    }, [initializeGoogleMapsObjects]);

    // Marker drag end handler
    const onMarkerDragEnd = useCallback((index, event) => {
        const updatedPoints = [...tourPoints];
        updatedPoints[index] = {
            ...updatedPoints[index],
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
        };
        setTourPoints(updatedPoints);
    }, [tourPoints]);

    // Helper for deep comparison of tour points
    const areTourPointsEqual = (arr1, arr2) => {
        if (arr1.length !== arr2.length) return false;
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i].lat !== arr2[i].lat || arr1[i].lng !== arr2[i].lng || arr1[i].name !== arr2[i].name) {
                return false;
            }
        }
        return true;
    };

    // --- Route Calculation Function ---
    const calculateRoute = useCallback(async (currentTourPoints) => {
        if (isCalculatingRoute) {
            return;
        }

        if (currentTourPoints.length < 2) {
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
            }
            setRoutePath([]);
            return;
        }

        if (!directionsServiceRef.current || !directionsRendererRef.current) {
            console.warn("Google Maps Directions services not initialized yet. Skipping route calculation.");
            return;
        }

        setIsCalculatingRoute(true);

        const origin = currentTourPoints[0];
        const destination = currentTourPoints[currentTourPoints.length - 1];
        const waypoints = currentTourPoints.slice(1, currentTourPoints.length - 1).map(point => ({
            location: new window.google.maps.LatLng(point.lat, point.lng),
            stopover: true
        }));

        const request = {
            origin: new window.google.maps.LatLng(origin.lat, origin.lng),
            destination: new window.google.maps.LatLng(destination.lat, destination.lng),
            waypoints: waypoints,
            optimizeWaypoints: true,
            travelMode: window.google.maps.TravelMode.WALKING,
        };

        try {
            const response = await directionsServiceRef.current.route(request);

            if (response.status === 'OK') {
                directionsRendererRef.current.setDirections(response);

                const orderedWaypoints = response.routes[0].waypoint_order;
                const reorderedTourPoints = [currentTourPoints[0]];
                orderedWaypoints.forEach(originalIndex => {
                    reorderedTourPoints.push(currentTourPoints[originalIndex + 1]);
                });
                reorderedTourPoints.push(currentTourPoints[currentTourPoints.length - 1]);

                setTourPoints(prevPoints => {
                    if (!areTourPointsEqual(prevPoints, reorderedTourPoints)) {
                        return reorderedTourPoints;
                    }
                    return prevPoints;
                });

                // --- Store decoded polyline for navigation progress ---
                const overviewPolyline = response.routes[0].overview_polyline; //?.points;
                if (overviewPolyline) {
                    setRoutePath(decodePolyline(overviewPolyline));
                } else {
                    setRoutePath([]);
                }
            } else {
                console.error("Directions request failed due to " + response.status + ": " + response.error_message);
                if (directionsRendererRef.current) {
                    directionsRendererRef.current.setDirections({ routes: [] });
                }
                setRoutePath([]);
                alert(`Could not calculate route: ${response.status}. Please check points.`);
            }
        } catch (error) {
            console.error("Error calculating directions:", error);
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
            }
            setRoutePath([]);
            alert("An unexpected error occurred while calculating the route.");
        } finally {
            setIsCalculatingRoute(false);
            lastCalculatedTourPointsRef.current = currentTourPoints;
        }
    }, [isCalculatingRoute]);

    // Effect to trigger route calculation
    React.useEffect(() => {
        if (isLoaded && tourPoints.length >= 2 && !isCalculatingRoute &&
            !areTourPointsEqual(tourPoints, lastCalculatedTourPointsRef.current)) {
            calculateRoute(tourPoints);
        } else if (isLoaded && tourPoints.length < 2) {
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
            }
            lastCalculatedTourPointsRef.current = [];
            setRoutePath([]);
        }
    }, [tourPoints, isLoaded, calculateRoute, isCalculatingRoute]);

    // Remove point handler
    const removeTourPoint = (removeIndex) => {
        setTourPoints((currentPoints) => currentPoints.filter((_, idx) => idx !== removeIndex));
    };

    // Start navigation: use device location, set navigation mode
    const startNavigation = () => {
        if (tourPoints.length < 1) return;
        setIsNavigating(true);
        setCurrentNavIndex(0);
        setDemoMode(false);
        setSimulatedLocation(null);
        setTourPoints(points => points.map((p) => ({ ...p, visited: false })));
        lastSplitRef.current = { idx: 0, snapped: null }; // <-- Reset split here!
        if (directionsRendererRef.current) {
            directionsRendererRef.current.setDirections({ routes: [] });
        }
    };

    // Watch user location and update navigation
    React.useEffect(() => {
        if (!isNavigating || tourPoints.length === 0 || demoMode) return;

        let watchId = null;
        function handlePosition(pos) {
            const { latitude, longitude } = pos.coords;
            setCurrentUserLocation({ lat: latitude, lng: longitude });
            const target = tourPoints[currentNavIndex];
            const dist = getDistanceMeters(latitude, longitude, target.lat, target.lng);
            if (dist < 30 && !target.visited) {
                setTourPoints(points =>
                    points.map((p, i) =>
                        i === currentNavIndex ? { ...p, visited: true } : p
                    )
                );
                if (currentNavIndex < tourPoints.length - 1) {
                    setCurrentNavIndex(idx => idx + 1);
                } else {
                    setIsNavigating(false);
                }
            }
        }
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(handlePosition, null, {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 10000,
            });
        }
        return () => {
            if (watchId && navigator.geolocation) {
                navigator.geolocation.clearWatch(watchId);
            }
        };
    }, [isNavigating, currentNavIndex, tourPoints, demoMode]);

    // Demo mode: simulate location with mouse clicks
    React.useEffect(() => {
        if (!isNavigating || !demoMode || tourPoints.length === 0) return;
        if (!simulatedLocation) return;

        const { lat, lng } = simulatedLocation;
        const target = tourPoints[currentNavIndex];
        const dist = getDistanceMeters(lat, lng, target.lat, target.lng);
        if (dist < 30 && !target.visited) {
            setTourPoints(points =>
                points.map((p, i) =>
                    i === currentNavIndex ? { ...p, visited: true } : p
                )
            );
            if (currentNavIndex < tourPoints.length - 1) {
                setCurrentNavIndex(idx => idx + 1);
            } else {
                setIsNavigating(false);
            }
        }
    }, [simulatedLocation, isNavigating, demoMode, currentNavIndex, tourPoints]);

    // Modified map click handler for demo mode
    const handleMapClick = useCallback((event) => {
        if (isNavigating && demoMode) {
            setSimulatedLocation({
                lat: event.latLng.lat(),
                lng: event.latLng.lng(),
            });
        } else if (!isNavigating) {
            addTourPoint({
                lat: event.latLng.lat(),
                lng: event.latLng.lng(),
                name: `Click Point ${tourPoints.length + 1}`,
            });
        }
    }, [isNavigating, demoMode, addTourPoint, tourPoints.length]);

    // --- Navigation progress polyline logic ---
    let userLocation = null;
    let showHazard = false;

    if (isNavigating) {
        if (demoMode && simulatedLocation) {
            userLocation = simulatedLocation;
        } else if (!demoMode && currentUserLocation) {
            userLocation = currentUserLocation;
        }
    }

    let completedPath = [];
    let remainingPath = [];

    if (routePath.length) {
        if (!userLocation) {
            completedPath = [];
            remainingPath = routePath;
        } else {
            // Find the index in routePath after the last visited waypoint
            const lastVisitedIdx = Math.max(
                0,
                tourPoints.map((p, i) => (p.visited ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
            );

            // Only allow snapping after lastVisitedIdx
            let minDist = Infinity;
            let insertIdx = lastVisitedIdx + 1;
            let snapped = routePath[insertIdx] || routePath[routePath.length - 1];

            for (let i = lastVisitedIdx; i < routePath.length - 1; i++) {
                const a = routePath[i];
                const b = routePath[i + 1];
                const t = ((userLocation.lat - a.lat) * (b.lat - a.lat) + (userLocation.lng - a.lng) * (b.lng - a.lng)) /
                          ((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2);
                const tClamped = Math.max(0, Math.min(1, t));
                const proj = {
                    lat: a.lat + tClamped * (b.lat - a.lat),
                    lng: a.lng + tClamped * (b.lng - a.lng)
                };
                const d = getDistanceMeters(userLocation.lat, userLocation.lng, proj.lat, proj.lng);
                if (d < minDist) {
                    minDist = d;
                    insertIdx = i + 1;
                    snapped = proj;
                }
            }

            // Check if snapped is already at a polyline vertex
            const idx = routePath.findIndex(
                p => Math.abs(p.lat - snapped.lat) < 1e-6 && Math.abs(p.lng - snapped.lng) < 1e-6
            );

            if (idx !== -1) {
                completedPath = routePath.slice(0, idx + 1);
                remainingPath = routePath.slice(idx + 1);
            } else {
                completedPath = [...routePath.slice(0, insertIdx), snapped];
                remainingPath = [snapped, ...routePath.slice(insertIdx)];
            }

            // Remove overlap at the split point
            if (
                completedPath.length &&
                remainingPath.length &&
                completedPath[completedPath.length - 1].lat === remainingPath[0].lat &&
                completedPath[completedPath.length - 1].lng === remainingPath[0].lng
            ) {
                remainingPath = remainingPath.slice(1);
            }
        }
        console.log("remaining:", remainingPath.length, "completed:", completedPath.length);
    }

    // --- Render Logic ---
    if (loadError) return <div style={{ padding: '20px', color: 'red' }}>Error loading maps</div>;
    if (!isLoaded) return <div style={{ padding: '20px' }}>Loading Maps...</div>;

    return (
        <div>
            <GoogleMap
                mapContainerStyle={mapContainerStyle}
                zoom={12}
                center={defaultCenter}
                onLoad={onMapLoad}
                onClick={handleMapClick}
                options={{
                    zoomControl: true,         // Show +/-
                    mapTypeControl: false,
                    streetViewControl: false,
                    fullscreenControl: false,
                    // You can add more controls as needed
                }}
            >
                {/* Completed (green) and remaining (blue) route as dots */}
                {isNavigating && completedPath.length > 1 && (
                    <Polyline
                        path={completedPath}
                        options={{
                            strokeColor: "#00c853",
                            strokeOpacity: 0,
                            strokeWeight: 6,
                            icons: [{
                                icon: {
                                    path: window.google.maps.SymbolPath.CIRCLE,
                                    fillOpacity: 1,
                                    fillColor: "#00c853",
                                    strokeOpacity: 1,
                                    strokeColor: "#00c853",
                                    scale: 3
                                },
                                offset: '0',
                                repeat: '20px'
                            }],
                        }}
                    />
                )}
                {isNavigating && remainingPath.length > 1 && (
                    <Polyline
                        path={remainingPath}
                        options={{
                            strokeColor: "#2196f3",
                            strokeOpacity: 0,
                            strokeWeight: 6,
                            icons: [{
                                icon: {
                                    path: window.google.maps.SymbolPath.CIRCLE,
                                    fillOpacity: 1,
                                    fillColor: "#2196f3",
                                    strokeOpacity: 1,
                                    strokeColor: "#2196f3",
                                    scale: 3
                                },
                                offset: '0',
                                repeat: '20px'
                            }],
                        }}
                    />
                )}
                {/* Show hazard marker if user is off route */}
                {isNavigating && showHazard && userLocation && (
                    <Marker
                        position={userLocation}
                        icon={{
                            url: "https://maps.google.com/mapfiles/ms/icons/red-dot.png", // or your own hazard icon
                            scaledSize: new window.google.maps.Size(40, 40)
                        }}
                        title="You are off the route!"
                    />
                )}

                {tourPoints.map((point, index) => (
                    <Marker
                        key={index}
                        position={point}
                        label={{
                            text: (index + 1).toString(),
                            fontWeight: 'bold',
                        }}
                        draggable={!isNavigating}
                        onDragEnd={(e) => onMarkerDragEnd(index, e)}
                        onClick={isNavigating && demoMode ? () => setSimulatedLocation(point) : undefined}
                        icon={{
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 10,
                            fillColor: point.visited
                                ? "#007bff"
                                : (isNavigating && index === currentNavIndex ? "#ffc107" : "#28a745"),
                            fillOpacity: 1,
                            strokeWeight: 2,
                            strokeColor: "#333"
                        }}
                    />
                ))}
                {/* Show simulated location marker in demo mode */}
                {isNavigating && demoMode && simulatedLocation && (
                    <Marker
                        position={simulatedLocation}
                        icon={{
                            path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                            scale: 5,
                            fillColor: "#ff5722",
                            fillOpacity: 1,
                            strokeWeight: 2,
                            strokeColor: "#ff5722"
                        }}
                    />
                )}
            </GoogleMap>

            {/* Controls Panel */}
            <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                background: 'white',
                padding: '15px',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 10,
                maxHeight: 'calc(100% - 20px)',
                overflowY: 'auto'
            }}>
                {/* Replace title with logo */}
                <img
                    src={logo}
                    alt="Logo"
                    style={{
                        width: 120,
                        display: 'block',
                        margin: '0 auto 15px auto',
                        objectFit: 'contain'
                    }}
                />

                {/* Place Search Input */}
                <input
                    ref={searchInputRef}
                    id="pac-input"
                    type="text"
                    placeholder="Search for a place"
                    style={{
                        width: 'calc(100% - 22px)',
                        padding: '8px',
                        marginBottom: '10px',
                        borderRadius: '4px',
                        border: '1px solid #ccc'
                    }}
                    disabled={isNavigating}
                />

                <p>Click on the map to add tour points.</p>
                <button
                    onClick={() => {
                        setTourPoints([]);
                        if (directionsRendererRef.current) {
                            directionsRendererRef.current.setDirections({ routes: [] });
                        }
                        lastCalculatedTourPointsRef.current = [];
                        setIsNavigating(false);
                        setCurrentNavIndex(0);
                        setDemoMode(false);
                        setSimulatedLocation(null);
                        setRoutePath([]);
                        setCurrentUserLocation(null);
                    }}
                    style={{
                        padding: '8px 15px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        marginRight: '10px'
                    }}
                    disabled={isNavigating}
                >
                    Clear Tour
                </button>
                {!isNavigating && (
                    <button
                        onClick={startNavigation}
                        disabled={tourPoints.length < 1}
                        style={{
                            padding: '8px 15px',
                            backgroundColor: tourPoints.length < 1 ? '#cccccc' : '#28a745',
                            color: 'white',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: tourPoints.length < 1 ? 'not-allowed' : 'pointer'
                        }}
                    >
                        Start Tour
                    </button>
                )}
                {isNavigating && (
                    <div style={{ marginTop: 10 }}>
                        <span style={{ color: '#28a745', fontWeight: 'bold' }}>
                            Navigating: Go to point {currentNavIndex + 1}
                        </span>
                        <label style={{ marginLeft: 20, fontSize: 15, cursor: 'pointer' }}>
                            <input
                                type="radio"
                                checked={demoMode}
                                onChange={() => setDemoMode(true)}
                                style={{ marginRight: 5 }}
                            />
                            Demo mode
                        </label>
                        <label style={{ marginLeft: 10, fontSize: 15, cursor: 'pointer' }}>
                            <input
                                type="radio"
                                checked={!demoMode}
                                onChange={() => setDemoMode(false)}
                                style={{ marginRight: 5 }}
                            />
                            Real location
                        </label>
                    </div>
                )}

                {tourPoints.length > 0 && (
                    <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                        <h3>Tour Stops:</h3>
                        <ol style={{ listStyleType: 'decimal', paddingLeft: '20px' }}>
                            {tourPoints.map((point, index) => (
                                <li key={index} style={{
                                    marginBottom: '8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    background: isNavigating && index === currentNavIndex
                                        ? '#fffbe6'
                                        : point.visited
                                            ? '#e6f7ff'
                                            : 'transparent'
                                }}>
                                    <span style={{ flexGrow: 1 }}>
                                        Point {index + 1}: {point.name || `Lat ${point.lat.toFixed(4)}, Lng ${point.lng.toFixed(4)}`}
                                        <span style={{ marginLeft: 10, fontSize: 13 }}>
                                            <span style={{
                                                color: point.ready ? 'green' : '#aaa',
                                                marginRight: 8,
                                                fontWeight: 'bold'
                                            }}>
                                                ●
                                            </span>
                                            Ready
                                            <span style={{
                                                color: point.visited ? 'blue' : '#aaa',
                                                margin: '0 8px 0 16px',
                                                fontWeight: 'bold'
                                            }}>
                                                ●
                                            </span>
                                            Visited
                                        </span>
                                    </span>
                                    <button
                                        onClick={() => removeTourPoint(index)}
                                        title="Remove"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: '#dc3545',
                                            fontSize: '18px',
                                            cursor: isNavigating ? 'not-allowed' : 'pointer',
                                            marginLeft: '10px',
                                            padding: 0,
                                        }}
                                        aria-label="Remove point"
                                        disabled={isNavigating}
                                    >
                                        {/* Unicode trash/delete icon */}
                                        🗑️
                                    </button>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
            </div>
        </div>
    );
}

export default MapComponent;

// --- Cleaned up: removed getNearestPointOnPolyline and other leftovers ---

// function getSplitOnPolyline(path, userLocation) {
//     let minDist = Infinity;
//     let insertIdx = 0;
//     let snapped = path[0];

//     for (let i = 0; i < path.length - 1; i++) {
//         const a = path[i];
//         const b = path[i + 1];
//         const t = ((userLocation.lat - a.lat) * (b.lat - a.lat) + (userLocation.lng - a.lng) * (b.lng - a.lng)) /
//                   ((b.lat - a.lat) ** 2 + (b.lng - a.lng) ** 2);
//         const tClamped = Math.max(0, Math.min(1, t));
//         const proj = {
//             lat: a.lat + tClamped * (b.lat - a.lat),
//             lng: a.lng + tClamped * (b.lng - a.lng)
//         };
//         const d = getDistanceMeters(userLocation.lat, userLocation.lng, proj.lat, proj.lng);
//         if (d < minDist) {
//             minDist = d;
//             insertIdx = i + 1;
//             snapped = proj;
//         }
//     }

//     // Check if snapped is already at a polyline vertex
//     const idx = path.findIndex(
//         p => Math.abs(p.lat - snapped.lat) < 1e-6 && Math.abs(p.lng - snapped.lng) < 1e-6
//     );

//     let completed, remaining;
//     if (idx !== -1) {
//         completed = path.slice(0, idx + 1);
//             remaining = path.slice(idx + 1);
//     } else {
//         completed = [...path.slice(0, insertIdx), snapped];
//         remaining = [snapped, ...path.slice(insertIdx)];
//     }
//     return { completed, remaining };
// }