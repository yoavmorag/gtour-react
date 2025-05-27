import React, { useState, useCallback, useRef } from 'react';
import { GoogleMap, useLoadScript, Marker } from '@react-google-maps/api';

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

function MapComponent() {
    const { isLoaded, loadError } = useLoadScript({
        googleMapsApiKey: Maps_API_KEY,
        libraries: LIBRARIES,
    });

    const [tourPoints, setTourPoints] = useState([]);
    const mapRef = useRef();

    const directionsServiceRef = useRef(null);
    const directionsRendererRef = useRef(null);
    const searchInputRef = useRef(null);

    // Track if a route calculation is currently in progress (for UI disablement)
    const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);

    // NEW: Ref to store the tourPoints from the *last time calculateRoute was successfully triggered*
    const lastCalculatedTourPointsRef = useRef([]);

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
                    strokeColor: "#FF0000",
                    strokeOpacity: 0.8,
                    strokeWeight: 4,
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

                const newPoint = {
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    name: place.name || place.formatted_address,
                };
                setTourPoints((currentPoints) => [...currentPoints, newPoint]);

                if (mapRef.current) {
                    mapRef.current.panTo(place.geometry.location);
                    mapRef.current.setZoom(15);
                }
                searchInputRef.current.value = "";
            });
            searchInputRef.current.autocomplete = autocomplete;
        }
        return true;
    }, []);

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

    // Click handler for adding points by clicking on the map
    const onMapClick = useCallback((event) => {
        const newPoint = {
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
            name: `Click Point ${tourPoints.length + 1}`,
        };
        setTourPoints((currentPoints) => [...currentPoints, newPoint]);
    }, [tourPoints.length]);

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
    const calculateRoute = useCallback(async (currentTourPoints) => { // Accept points as argument
        // Prevent re-entry if already calculating
        if (isCalculatingRoute) { // Still use this for preventing multiple *manual* triggers or very rapid state updates
            return;
        }

        if (currentTourPoints.length < 2) {
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] }); // Clear route
            }
            return;
        }

        if (!directionsServiceRef.current || !directionsRendererRef.current) {
            console.warn("Google Maps Directions services not initialized yet. Skipping route calculation.");
            return;
        }

        setIsCalculatingRoute(true); // Set calculating flag

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

                // Use the deep comparison to only update if truly different
                setTourPoints(prevPoints => {
                    if (!areTourPointsEqual(prevPoints, reorderedTourPoints)) {
                         return reorderedTourPoints;
                    }
                    return prevPoints; // No change, prevent re-render
                });

            } else {
                console.error("Directions request failed due to " + response.status + ": " + response.error_message);
                if (directionsRendererRef.current) {
                    directionsRendererRef.current.setDirections({ routes: [] });
                }
                alert(`Could not calculate route: ${response.status}. Please check points.`);
            }
        } catch (error) {
            console.error("Error calculating directions:", error);
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
            }
            alert("An unexpected error occurred while calculating the route.");
        } finally {
            setIsCalculatingRoute(false); // Reset calculating flag
            // IMPORTANT: Update the ref AFTER calculation is done
            // This ensures the current 'tourPoints' value is what we just processed
            lastCalculatedTourPointsRef.current = currentTourPoints;
        }
    }, [isCalculatingRoute]); // Dependencies: only the flag for internal mutex. `tourPoints` passed as argument.

    // Effect to trigger route calculation
    React.useEffect(() => {
        // Only trigger if map is loaded and there are at least 2 points
        // AND current tourPoints are different from the last time we calculated a route
        if (isLoaded && tourPoints.length >= 2 && !isCalculatingRoute &&
            !areTourPointsEqual(tourPoints, lastCalculatedTourPointsRef.current)) {
            calculateRoute(tourPoints); // Pass the current tourPoints to the memoized callback
        } else if (isLoaded && tourPoints.length < 2) {
            // Clear route if less than 2 points
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
            }
            // Also reset the ref when points are cleared or insufficient
            lastCalculatedTourPointsRef.current = [];
        }
    }, [tourPoints, isLoaded, calculateRoute, isCalculatingRoute]);


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
                onClick={onMapClick}
            >
                {tourPoints.map((point, index) => (
                    <Marker
                        key={index}
                        position={point}
                        label={{
                            text: (index + 1).toString(),
                            fontWeight: 'bold',
                        }}
                        draggable={true}
                        onDragEnd={(e) => onMarkerDragEnd(index, e)}
                    />
                ))}
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
                <h2>My Tour Builder</h2>
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
                />

                <p>Click on the map to add tour points.</p>
                <button
                    onClick={() => {
                        setTourPoints([]);
                        if (directionsRendererRef.current) {
                            directionsRendererRef.current.setDirections({ routes: [] });
                        }
                        lastCalculatedTourPointsRef.current = []; // Reset the ref when clearing
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
                >
                    Clear Tour
                </button>
                <button
                    // Manually trigger calculation if points are different from last calculated,
                    // or if the optimize button was clicked but the points were fewer than 2 last time
                    onClick={() => {
                        if (tourPoints.length >= 2) {
                            calculateRoute(tourPoints);
                        }
                    }}
                    disabled={tourPoints.length < 2 || isCalculatingRoute || areTourPointsEqual(tourPoints, lastCalculatedTourPointsRef.current)}
                    style={{
                        padding: '8px 15px',
                        backgroundColor: (tourPoints.length < 2 || isCalculatingRoute || areTourPointsEqual(tourPoints, lastCalculatedTourPointsRef.current)) ? '#cccccc' : '#007bff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '5px',
                        cursor: (tourPoints.length < 2 || isCalculatingRoute || areTourPointsEqual(tourPoints, lastCalculatedTourPointsRef.current)) ? 'not-allowed' : 'pointer'
                    }}
                >
                    {isCalculatingRoute ? 'Calculating...' : 'Optimize & Show Route'}
                </button>

                {tourPoints.length > 0 && (
                    <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                        <h3>Tour Stops:</h3>
                        <ol style={{ listStyleType: 'decimal', paddingLeft: '20px' }}>
                            {tourPoints.map((point, index) => (
                                <li key={index} style={{ marginBottom: '5px' }}>
                                    Point {index + 1}: {point.name || `Lat ${point.lat.toFixed(4)}, Lng ${point.lng.toFixed(4)}`}
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