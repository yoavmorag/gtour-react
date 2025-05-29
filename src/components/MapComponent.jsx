import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleMap, useLoadScript, Marker, Polyline } from '@react-google-maps/api';
import logo from '../images/logo.png';
import {
    createTour,
    getTour,
    listTours,
    postPointNugget,
} from '../apiClient.js';

import MediaPlayer from './MediaPlayer';

// --- Configuration ---
const Maps_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const LIBRARIES = ['places', 'geometry'];

const mapContainerStyle = {
    width: '100vw',
    height: '100vh',
};

const defaultCenter = {
    lat: 32.0853, // Example: Tel Aviv
    lng: 34.7818,
};

// --- Styles ---
const buttonStyle = {
    padding: '8px 18px',
    backgroundColor: '#888', // Default grey, specific buttons can override
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    margin: '0', // Handled by flex gap
    fontSize: '16px',
    minWidth: '120px',
    display: 'inline-block',
    transition: 'background 0.2s',
    textAlign: 'center',
};

const disabledButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#ccc',
    color: '#666',
    cursor: 'not-allowed',
};

const formInputStyle = {
    display: 'block',
    width: '100%', // Adjusted for box-sizing
    padding: '10px',
    marginBottom: '10px',
    borderRadius: '4px',
    border: '1px solid #ccc',
    fontSize: '1rem',
    boxSizing: 'border-box', // Added for better width calculation
};

const formLabelStyle = {
    display: 'block',
    marginBottom: '5px',
    fontWeight: 'bold',
    fontSize: '0.9rem',
};

// Modal Styles
const modalOverlayStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
};

const modalContentStyle = {
    background: 'white',
    padding: '25px',
    borderRadius: '8px',
    boxShadow: '0 5px 15px rgba(0,0,0,0.3)',
    minWidth: '350px',
    maxWidth: '500px',
    width: '90%', // Ensure it's responsive on smaller screens
    maxHeight: '80vh',
    overflowY: 'auto',
    position: 'relative',
};

const modalHeaderStyle = {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: '20px',
    borderBottom: '1px solid #eee',
    paddingBottom: '10px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
};

const modalCloseButtonStyle = {
    background: 'none',
    border: 'none',
    fontSize: '1.8rem', // Slightly larger for easier clicking
    cursor: 'pointer',
    color: '#888',
    padding: '0 5px', // Add some padding for click area
    lineHeight: '1',
};

const modalSelectStyle = { // Similar to formInputStyle, but can be distinct
    ...formInputStyle, // Inherit base styles
    marginBottom: '20px', // More space before footer
};

const modalFooterStyle = {
    marginTop: '20px',
    paddingTop: '15px',
    borderTop: '1px solid #eee',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px', // Space between footer buttons
};


// Helper: Haversine distance (meters)
function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Helper: decode Google polyline
function decodePolyline(encoded) {
    if (!encoded) return [];
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

function MapComponent() {
    const { isLoaded, loadError } = useLoadScript({
        googleMapsApiKey: Maps_API_KEY,
        libraries: LIBRARIES,
    });

    // Audio Player State
    const [currentAudioPath, setCurrentAudioPath] = useState(null);
    const [playSignal, setPlaySignal] = useState(0);

    // Tour Data State
    const [tourPoints, setTourPoints] = useState([]);
    const [currentTourData, setCurrentTourData] = useState(null);
    const [isLoadingTour, setIsLoadingTour] = useState(false); // Loading a specific tour
    const [isProcessingTourSubmission, setIsProcessingTourSubmission] = useState(false);

    // Map & Google Objects Refs
    const mapRef = useRef();
    const directionsServiceRef = useRef(null);
    const directionsRendererRef = useRef(null);
    const searchInputRef = useRef(null);
    const geocoderRef = useRef(null);
    const lastAddedPlaceFromSearchRef = useRef({ id: null, timestamp: 0 });

    // Routing State
    const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
    const lastCalculatedTourPointsRef = useRef([]);
    const [routePath, setRoutePath] = useState([]);

    // Navigation State
    const [isNavigating, setIsNavigating] = useState(false);
    const [currentNavIndex, setCurrentNavIndex] = useState(0);
    const [demoMode, setDemoMode] = useState(false);
    const [simulatedLocation, setSimulatedLocation] = useState(null);
    const [currentUserLocation, setCurrentUserLocation] = useState(null);

    // "My Tours" Modal State (Replaces showLoadTour and selectedTourId)
    const [isMyToursModalOpen, setIsMyToursModalOpen] = useState(false);
    const [tourList, setTourList] = useState([]);
    const [selectedTourInModal, setSelectedTourInModal] = useState('');
    const [isLoadingTourList, setIsLoadingTourList] = useState(false); // For fetching tour list

    // Polling and Form State
    const [pollingIntervalId, setPollingIntervalId] = useState(null);
    const [showTourDetailsForm, setShowTourDetailsForm] = useState(false);
    const [tourDetailsForm, setTourDetailsForm] = useState({
        name: '',
        guidePersonality: '',
        userPreferences: '',
    });

    // Navigation Follow-up Question State
    const [pointForFollowUp, setPointForFollowUp] = useState(null);
    const [navFollowUpQuestionText, setNavFollowUpQuestionText] = useState('');


    const handleLoadTourList = async () => {
        setIsLoadingTourList(true);
        try {
            const tours = await listTours();
            setTourList(tours);
        } catch (err) {
            alert("Failed to load tours: " + err.message);
            setTourList([]);
        } finally {
            setIsLoadingTourList(false);
        }
    };

    const addTourPoint = useCallback((pointData) => {
        setTourPoints((currentPoints) => [
            ...currentPoints,
            {
                ...pointData,
                content: [],
                visited: false,
            }
        ]);
    }, []);

    const initializeGoogleMapsObjects = useCallback(() => {
        if (!window.google || !mapRef.current) return false;
        if (!directionsServiceRef.current) {
            directionsServiceRef.current = new window.google.maps.DirectionsService();
        }
        if (!directionsRendererRef.current) {
            directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
                map: mapRef.current,
                suppressMarkers: true,
                polylineOptions: {
                    strokeColor: "#2196f3",
                    strokeOpacity: 0,
                    strokeWeight: 4,
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
                },
            });
        }
        if (!geocoderRef.current) {
            geocoderRef.current = new window.google.maps.Geocoder();
        }

        if (searchInputRef.current && !searchInputRef.current.autocomplete) {
            const autocomplete = new window.google.maps.places.Autocomplete(
                searchInputRef.current,
                { types: ['establishment', 'geocode'] }
            );
            autocomplete.bindTo('bounds', mapRef.current);

            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();

                if (searchInputRef.current) {
                    searchInputRef.current.value = "";
                }

                if (!place.geometry || !place.geometry.location) {
                    console.error("Autocomplete returned place contains no geometry");
                    return;
                }

                const currentPlaceId = place.place_id || `${place.geometry.location.lat()},${place.geometry.location.lng()}`;
                const now = Date.now();

                if (lastAddedPlaceFromSearchRef.current.id === currentPlaceId &&
                    (now - lastAddedPlaceFromSearchRef.current.timestamp < 1000)) {
                    console.warn(`Debounced duplicate Autocomplete selection for ${place.name || currentPlaceId}. Ignoring add.`);
                    return;
                }

                addTourPoint({
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    name: place.name || place.formatted_address,
                });

                lastAddedPlaceFromSearchRef.current = { id: currentPlaceId, timestamp: now };

                if (mapRef.current) {
                    mapRef.current.panTo(place.geometry.location);
                    mapRef.current.setZoom(15);
                }
            });
            searchInputRef.current.autocomplete = autocomplete;
        }
        return true;
    }, [addTourPoint]);

    useEffect(() => {
        if (isLoaded) {
            initializeGoogleMapsObjects();
        }
    }, [isLoaded, initializeGoogleMapsObjects]);

    const onMapLoad = useCallback((map) => {
        mapRef.current = map;
        if (isLoaded) {
            initializeGoogleMapsObjects();
        }
    }, [isLoaded, initializeGoogleMapsObjects]);


    const onMarkerDragEnd = useCallback((index, event) => {
        const updatedPoints = [...tourPoints];
        updatedPoints[index] = {
            ...updatedPoints[index],
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
        };
        setTourPoints(updatedPoints);
    }, [tourPoints]);

    const areTourPointsEqual = (arr1, arr2) => {
        if (arr1.length !== arr2.length) return false;
        for (let i = 0; i < arr1.length; i++) {
            if (arr1[i].lat !== arr2[i].lat || arr1[i].lng !== arr2[i].lng || arr1[i].name !== arr2[i].name) {
                return false;
            }
        }
        return true;
    };

    const calculateRoute = useCallback(async (currentRoutePoints) => {
        if (isCalculatingRoute || currentRoutePoints.length < 2) {
            if (currentRoutePoints.length < 2 && directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
                setRoutePath([]);
            }
            return;
        }
        if (!directionsServiceRef.current || !directionsRendererRef.current) {
            console.warn("Google Maps Directions services not initialized. Skipping route calculation.");
            return;
        }
        setIsCalculatingRoute(true);
        const origin = currentRoutePoints[0];
        const destination = currentRoutePoints[currentRoutePoints.length - 1];
        const waypoints = currentRoutePoints.slice(1, -1).map(point => ({
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
                const overviewPolyline = response.routes[0].overview_polyline;
                if (overviewPolyline) {
                    const decodedPath = decodePolyline(overviewPolyline);
                    setRoutePath(decodedPath);
                } else {
                    setRoutePath([]);
                }

                const orderedWaypoints = response.routes[0].waypoint_order;
                const reorderedTourPoints = [currentRoutePoints[0]];
                orderedWaypoints.forEach(originalIndex => {
                    reorderedTourPoints.push(currentRoutePoints[originalIndex + 1]);
                });
                reorderedTourPoints.push(currentRoutePoints[currentRoutePoints.length - 1]);

                setTourPoints(prevPoints => {
                    if (!areTourPointsEqual(prevPoints.map(p=>({lat:p.lat, lng:p.lng, name:p.name})), reorderedTourPoints.map(p=>({lat:p.lat, lng:p.lng, name:p.name})))) {
                        return reorderedTourPoints.map(rp => {
                            const existingPoint = prevPoints.find(pp => pp.name === rp.name && pp.lat === rp.lat && pp.lng === rp.lng);
                            return existingPoint ? { ...existingPoint, ...rp } : rp;
                        });
                    }
                    return prevPoints;
                });

            } else {
                console.error("Directions request failed: " + response.status);
                setRoutePath([]);
                alert(`Could not calculate route: ${response.status}. Please check points.`);
            }
        } catch (error) {
            console.error("Error calculating directions:", error);
            setRoutePath([]);
            alert("An unexpected error occurred while calculating the route.");
        } finally {
            setIsCalculatingRoute(false);
            lastCalculatedTourPointsRef.current = [...currentRoutePoints];
        }
    }, [isCalculatingRoute]);


    useEffect(() => {
        if (isLoaded && tourPoints.length >= 2 && !isCalculatingRoute && !isNavigating &&
            !areTourPointsEqual(tourPoints.map(p=>({lat:p.lat, lng:p.lng, name:p.name})), lastCalculatedTourPointsRef.current.map(p=>({lat:p.lat, lng:p.lng, name:p.name})))) {
            calculateRoute(tourPoints);
        } else if (isLoaded && tourPoints.length < 2) {
            if (directionsRendererRef.current) {
                directionsRendererRef.current.setDirections({ routes: [] });
            }
            lastCalculatedTourPointsRef.current = [];
            setRoutePath([]);
        }
    }, [tourPoints, isLoaded, calculateRoute, isCalculatingRoute, isNavigating]);

    const removeTourPoint = (removeIndex) => {
        setTourPoints((currentPoints) => currentPoints.filter((_, idx) => idx !== removeIndex));
    };

    const startNavigation = () => {
        if (tourPoints.length < 1) return;
        calculateRoute(tourPoints).then(() => {
            setIsNavigating(true);
            setCurrentNavIndex(0);
            setDemoMode(false);
            setSimulatedLocation(null);
            setPointForFollowUp(null);
            setNavFollowUpQuestionText('');
            setTourPoints(points => points.map((p) => ({ ...p, visited: false })));
        });
    };


function playAudioForPoint(audioPathFromNugget) {
    console.log("playAudioForPoint received audioPathFromNugget:", audioPathFromNugget);
    if (!audioPathFromNugget) {
        console.warn("playAudioForPoint called with no audioPathFromNugget");
        return;
    }

    let finalUrl;

    if (audioPathFromNugget.startsWith('http://') || audioPathFromNugget.startsWith('https://')) {
        finalUrl = audioPathFromNugget;
    } else {
        let relativePath = audioPathFromNugget.replace(/^\.?\//, '');
        if (relativePath.startsWith('data/')) {
            console.log("Removing leading 'data/' from relativePath:", relativePath);
            relativePath = relativePath.substring('data/'.length);
            console.log("relativePath after removing 'data/':", relativePath);
        }
        finalUrl = `${process.env.PUBLIC_URL}/data/${relativePath}`;
    }

    const cacheBustedUrl = `${finalUrl}?cb=${Date.now()}`;
    console.log("Attempting to play audio from URL (corrected path logic):", cacheBustedUrl);
    setCurrentAudioPath(cacheBustedUrl);
    setPlaySignal(signal => signal + 1);
}

    const checkUserProgress = useCallback((lat, lng) => {
        if (!isNavigating || tourPoints.length === 0 || currentNavIndex >= tourPoints.length) return;

        const targetPoint = tourPoints[currentNavIndex];
        if (!targetPoint || targetPoint.visited) return;

        const dist = getDistanceMeters(lat, lng, targetPoint.lat, targetPoint.lng);
        if (dist < 30) {
            setTourPoints(points =>
                points.map((p, i) =>
                    i === currentNavIndex ? { ...p, visited: true } : p
                )
            );

            // Find the most up-to-date version of the target point to set for follow-up
            const updatedTargetPoint = tourPoints.find(p => p.name === targetPoint.name && p.lat === targetPoint.lat && p.lng === targetPoint.lng);
            setPointForFollowUp(updatedTargetPoint || targetPoint);
            setNavFollowUpQuestionText('');

            const firstNugget = targetPoint.content && targetPoint.content[0];
            if (firstNugget && firstNugget.ready && firstNugget.audio_path) {
                playAudioForPoint(firstNugget.audio_path);
            } else {
                console.log("Point reached, but initial content/audio not ready or available.", targetPoint.name);
            }

            if (currentNavIndex < tourPoints.length - 1) {
                setCurrentNavIndex(idx => idx + 1);
            } else {
                alert("Tour finished!");
                setIsNavigating(false);
                setPointForFollowUp(null); // Clear follow-up point on tour finish
            }
        }
    }, [tourPoints, currentNavIndex, isNavigating]); // Removed currentTourData as it's accessed via tourPoints

    useEffect(() => {
        if (!isNavigating || tourPoints.length === 0 || demoMode) return;
        let watchId = null;
        function handlePosition(pos) {
            const { latitude, longitude } = pos.coords;
            setCurrentUserLocation({ lat: latitude, lng: longitude });
            checkUserProgress(latitude, longitude);
        }
        if (navigator.geolocation) {
            watchId = navigator.geolocation.watchPosition(handlePosition,
                (err) => console.warn(`ERROR(${err.code}): ${err.message}`),
                { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
            );
        }
        return () => {
            if (watchId && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
        };
    }, [isNavigating, demoMode, checkUserProgress, tourPoints.length]);

    useEffect(() => {
        if (!isNavigating || !demoMode || tourPoints.length === 0 || !simulatedLocation) return;
        checkUserProgress(simulatedLocation.lat, simulatedLocation.lng);
    }, [simulatedLocation, isNavigating, demoMode, checkUserProgress, tourPoints.length]);

    const handleMapClick = useCallback((event) => {
        if (isNavigating && demoMode) {
            setSimulatedLocation({
                lat: event.latLng.lat(),
                lng: event.latLng.lng(),
            });
        } else if (!isNavigating) {
            if (!geocoderRef.current) {
                console.error("Geocoder not initialized.");
                alert("Location service not ready. Please try again shortly.");
                return;
            }
            geocoderRef.current.geocode({ location: event.latLng }, (results, status) => {
                let placeName;
                const clickedLat = event.latLng.lat();
                const clickedLng = event.latLng.lng();

                if (status === 'OK') {
                    if (results && results[0]) {
                        const firstResult = results[0];
                        if (firstResult.name && firstResult.types.some(type => ['point_of_interest', 'establishment', 'natural_feature', 'park', 'airport', 'transit_station', 'landmark'].includes(type))) {
                            placeName = firstResult.name;
                        } else {
                            const addressParts = firstResult.formatted_address.split(',');
                            if (addressParts.length > 1) {
                                placeName = addressParts.slice(0, 2).join(',').trim();
                            } else {
                                placeName = firstResult.formatted_address;
                            }
                        }
                        if (!placeName || placeName.trim() === "") {
                            placeName = `Lat ${clickedLat.toFixed(4)}, Lng ${clickedLng.toFixed(4)}`;
                        }
                    } else {
                        placeName = `Unknown Location (${clickedLat.toFixed(4)}, ${clickedLng.toFixed(4)})`;
                    }
                } else {
                    placeName = `Geocode Error (${clickedLat.toFixed(4)}, ${clickedLng.toFixed(4)})`;
                }

                addTourPoint({
                    lat: clickedLat,
                    lng: clickedLng,
                    name: placeName,
                });

                if (mapRef.current) {
                    mapRef.current.panTo({ lat: clickedLat, lng: clickedLng });
                }
            });
        }
    }, [isNavigating, demoMode, addTourPoint]);

    async function handleLoadSpecificTour(tourIdToLoad) {
        if (!tourIdToLoad) return;
        setIsLoadingTour(true);
        try {
            const tour = await getTour(tourIdToLoad);
            setCurrentTourData(tour);
            setTourPoints(tour.points?.map(p => ({...p, visited: false, content: p.content || [] })) || []);
            lastCalculatedTourPointsRef.current = [];
            if (tour.points && tour.points.length < 2) {
                setRoutePath([]);
                 if (directionsRendererRef.current) {
                    directionsRendererRef.current.setDirections({ routes: [] });
                }
            }
        } catch (err) {
            alert("Failed to load tour: " + err.message);
        } finally {
            setIsLoadingTour(false);
        }
    }

    useEffect(() => {
        if (pollingIntervalId) {
            clearInterval(pollingIntervalId);
            setPollingIntervalId(null);
        }

        if (!currentTourData || !currentTourData.tour_id || isProcessingTourSubmission) {
            return;
        }

        const tourStillProcessing = currentTourData.points.some(p =>
            !p.content || p.content.length === 0 || p.content.some(n => !n.ready)
        );

        if (tourStillProcessing) {
            const intervalId = setInterval(async () => {
                try {
                    const updatedTour = await getTour(currentTourData.tour_id);

                    const newTourPoints = updatedTour.points.map(apiPoint => {
                        const existingClientPoint = tourPoints.find(tp => tp.name === apiPoint.name && Math.abs(tp.lat - apiPoint.lat) < 0.0001 && Math.abs(tp.lng - apiPoint.lng) < 0.0001);
                        return {
                            ...apiPoint,
                            visited: existingClientPoint ? existingClientPoint.visited : false,
                        };
                    });
                    setTourPoints(newTourPoints);
                    setCurrentTourData(prev => ({...prev, ...updatedTour, points: newTourPoints}));

                    if (pointForFollowUp) {
                        const updatedFollowUpPointInNewPoints = newTourPoints.find(p => p.name === pointForFollowUp.name && Math.abs(p.lat - pointForFollowUp.lat) < 0.0001 && Math.abs(p.lng - pointForFollowUp.lng) < 0.0001);
                        if (updatedFollowUpPointInNewPoints) {
                             setPointForFollowUp(updatedFollowUpPointInNewPoints);
                        }
                    }


                    const stillNeedsProcessing = newTourPoints.some(p =>
                        !p.content || p.content.length === 0 || p.content.some(n => !n.ready)
                    );

                    if (!stillNeedsProcessing) {
                        clearInterval(intervalId);
                        setPollingIntervalId(null);
                        if (newTourPoints.length >= 2) calculateRoute(newTourPoints);
                    }
                } catch (error) {
                    console.error("Error polling tour status:", error);
                    clearInterval(intervalId);
                    setPollingIntervalId(null);
                }
            }, 7000);
            setPollingIntervalId(intervalId);
        } else {
            if (tourPoints.length >= 2 && routePath.length === 0) {
                 calculateRoute(tourPoints);
            }
        }

        return () => {
            if (pollingIntervalId) clearInterval(pollingIntervalId);
        };
    }, [currentTourData?.tour_id, isProcessingTourSubmission, pointForFollowUp?.name, tourPoints, calculateRoute, routePath.length]); // Added tourPoints, calculateRoute, routePath.length based on dependencies.

    const handleOpenTourDetailsForm = () => {
        if (tourPoints.length === 0 && !currentTourData?.tour_id) {
            alert("Please add points to the tour first if creating a new one.");
            return;
        }
        setTourDetailsForm({
            name: currentTourData?.tour_name || 'My New Tour',
            guidePersonality: currentTourData?.tour_guide_personality || 'A friendly and informative guide',
            userPreferences: currentTourData?.user_preferences || 'General interest',
        });
        setShowTourDetailsForm(true);
    };

    const handleTourDetailsFormChange = (e) => {
        const { name, value } = e.target;
        setTourDetailsForm(prev => ({ ...prev, [name]: value }));
    };

    const handleTourDataSubmit = async () => {
        setIsProcessingTourSubmission(true);
        setShowTourDetailsForm(false);
        try {
            const tourPayload = {
                tour_name: tourDetailsForm.name,
                tour_guide_personality: tourDetailsForm.guidePersonality,
                user_preferences: tourDetailsForm.userPreferences,
                points: tourPoints.map(({lat, lng, name, content}) => ({lat, lng, name, content: content || []})),
            };

            const submittedTourResponse = await createTour(tourPayload);

            alert(currentTourData?.tour_id ? 'Tour details updated! Content may be re-processing.' : 'Tour creation initiated! Content is being generated.');
            setCurrentTourData(submittedTourResponse);
            setTourPoints(submittedTourResponse.points.map(p => ({...p, visited: false, content: p.content || [] })));

        } catch (e) {
            alert(`Failed to ${currentTourData?.tour_id ? 'update' : 'create'} tour: ` + e.message);
        } finally {
            setIsProcessingTourSubmission(false);
        }
    };

    const handleAskQuestion = async (tourId, pointNameToQuery, questionText) => {
        if (!questionText.trim()) {
            alert("Question cannot be empty.");
            return;
        }
        if (!pointForFollowUp) {
            alert("No point currently selected for a follow-up question. Please ensure you are at a point.");
            console.error("handleAskQuestion called but pointForFollowUp is null or undefined.");
            return;
        }

        // Use pointForFollowUp directly for its properties, as it's kept up-to-date by polling
        const currentInstanceOfPointToQuery = tourPoints.find(p =>
            p.name === pointForFollowUp.name &&
            Math.abs(p.lat - pointForFollowUp.lat) < 0.0001 &&
            Math.abs(p.lng - pointForFollowUp.lng) < 0.0001
        );

        if (!currentInstanceOfPointToQuery) {
            alert("Could not find the specific point in the current tour data. The tour data might have updated. Please try again.");
            console.error("Failed to find point in tourPoints. pointForFollowUp state:", pointForFollowUp, "Passed pointNameToQuery:", pointNameToQuery, "Current tourPoints:", tourPoints);
            return;
        }

        try {
            const response = await postPointNugget(tourId, currentInstanceOfPointToQuery.name, questionText);
            alert(`Question submitted for point ${currentInstanceOfPointToQuery.name}. Processing in background.`);

            const newNugget = { ...response.nugget, id: response.nugget_id, ready: false, question: questionText }; // Ensure question is part of the new nugget

            const updatedTourPoints = tourPoints.map(p => {
                if (p === currentInstanceOfPointToQuery) {
                    return { ...p, content: [...(p.content || []), newNugget] };
                }
                return p;
            });
            setTourPoints(updatedTourPoints);

            setCurrentTourData(prev => {
                if (!prev) return null;
                const updatedApiPoints = prev.points.map(apiPoint => {
                    if (apiPoint.name === currentInstanceOfPointToQuery.name &&
                        Math.abs(apiPoint.lat - currentInstanceOfPointToQuery.lat) < 0.0001 &&
                        Math.abs(apiPoint.lng - currentInstanceOfPointToQuery.lng) < 0.0001) {
                       return { ...apiPoint, content: [...(apiPoint.content || []), newNugget] };
                    }
                    return apiPoint;
                });
                return {...prev, points: updatedApiPoints};
            });

            // Update pointForFollowUp state immediately with the new (not ready) nugget
            // This ensures the "Play Latest Answer" button logic uses the most current content structure
            const updatedPointForFollowUp = updatedTourPoints.find(p => p.name === pointForFollowUp.name && p.lat === pointForFollowUp.lat);
            if (updatedPointForFollowUp) {
                setPointForFollowUp(updatedPointForFollowUp);
            }

            if (isNavigating) {
                setNavFollowUpQuestionText('');
            }

        } catch (e) {
            alert(`Failed to submit question for ${currentInstanceOfPointToQuery.name}: ` + e.message);
        }
    };

    const handleStopNavigation = () => {
        setIsNavigating(false);
        setPointForFollowUp(null);
        setNavFollowUpQuestionText('');
    };


    if (loadError) return <div style={{ padding: '20px', color: 'red' }}>Error loading maps: {loadError.message}</div>;
    if (!isLoaded) return <div style={{ padding: '20px' }}>Loading Maps...</div>;

    const currentTargetPoint = isNavigating && tourPoints[currentNavIndex] ? tourPoints[currentNavIndex] : null;

    const firstPoint = tourPoints[0];
    const firstNuggetOfFirstPoint = firstPoint?.content?.[0];
    const firstPointIsReady = !!(firstNuggetOfFirstPoint && firstNuggetOfFirstPoint.ready);

    const isStartTourDisabled =
        tourPoints.length === 0 ||
        isLoadingTour ||
        isProcessingTourSubmission ||
        (currentTourData && tourPoints.length > 0 && !firstPointIsReady);


    return (
        <div>
            <GoogleMap
                mapContainerStyle={mapContainerStyle}
                zoom={12}
                center={defaultCenter}
                onLoad={onMapLoad}
                onClick={handleMapClick}
                options={{
                    zoomControl: true, mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
                }}
            >
                {isNavigating && routePath.length > 0 && (
                    <Polyline
                        path={routePath}
                        options={{ strokeColor: '#007bff', strokeOpacity: 0.8, strokeWeight: 5, zIndex: 1 }}
                    />
                )}
                {tourPoints.map((point, index) => (
                    <Marker
                        key={`${point.name}-${point.lat}-${point.lng}-${index}`}
                        position={{ lat: point.lat, lng: point.lng }}
                        label={{ text: (index + 1).toString(), fontWeight: 'bold', color: 'white' }}
                        draggable={!isNavigating}
                        onDragEnd={(e) => onMarkerDragEnd(index, e)}
                        onClick={isNavigating && demoMode ? () => setSimulatedLocation({ lat: point.lat, lng: point.lng }) : undefined}
                        icon={{
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 12,
                            fillColor: point.visited
                                ? "#007bff"
                                : (currentTargetPoint && currentTargetPoint.name === point.name && Math.abs(currentTargetPoint.lat - point.lat) < 0.0001 && Math.abs(currentTargetPoint.lng - point.lng) < 0.0001 ? "#ffc107" : "#28a745"),
                            fillOpacity: 1,
                            strokeWeight: 2,
                            strokeColor: "#333"
                        }}
                        zIndex={currentTargetPoint && currentTargetPoint.name === point.name && Math.abs(currentTargetPoint.lat - point.lat) < 0.0001 && Math.abs(currentTargetPoint.lng - point.lng) < 0.0001 ? 100 : 50 + index}
                    />
                ))}
                {isNavigating && demoMode && simulatedLocation && (
                    <Marker
                        position={{ lat: simulatedLocation.lat, lng: simulatedLocation.lng }}
                        icon={{
                            path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                            scale: 7, fillColor: "#ff5722", fillOpacity: 0.9, strokeWeight: 2, strokeColor: "#fff"
                        }}
                        zIndex={200}
                    />
                )}
                 {isNavigating && !demoMode && currentUserLocation && (
                    <Marker
                        position={{ lat: currentUserLocation.lat, lng: currentUserLocation.lng }}
                        icon={{
                            path: window.google.maps.SymbolPath.CIRCLE,
                            scale: 7, fillColor: "#17a2b8", fillOpacity: 0.9, strokeColor: "white", strokeWeight: 2,
                        }}
                        title="Your Location"
                        zIndex={199}
                    />
                )}
            </GoogleMap>

            {/* Main Control Panel */}
            <div style={{
                position: 'absolute', top: '10px', left: '10px', background: 'rgba(255,255,255,0.95)',
                padding: '15px', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 10, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', minWidth: '320px', width: '360px'
            }}>
                <img src={logo} alt="Logo" style={{ width: 120, display: 'block', margin: '0 auto 15px auto', objectFit: 'contain' }} />

                <MediaPlayer src={currentAudioPath} playSignal={playSignal} />

                {!showTourDetailsForm && (
                    <>
                        <input
                            ref={searchInputRef} type="text" placeholder="Search for a place to add"
                            style={{ ...formInputStyle, width: '100%', marginBottom: '10px' }} // Ensure full width
                            disabled={isNavigating || isLoadingTour || isProcessingTourSubmission}
                        />
                        <p style={{fontSize: '0.9em', color: '#555', textAlign: 'center', marginBottom: '15px'}}>
                            {isNavigating ? "Navigation in progress." : "Click map or search to add points."}
                        </p>

                        {!isNavigating && (
                            <button
                                onClick={startNavigation}
                                disabled={isStartTourDisabled}
                                style={isStartTourDisabled ? disabledButtonStyle : {...buttonStyle, backgroundColor: '#28a745', width: '100%', marginBottom: '10px'}}
                                title={currentTourData && tourPoints.length > 0 && !firstPointIsReady ? "Waiting for first point's content to be ready..." : "Start the tour"}
                            >
                                Start Tour
                            </button>
                        )}
                        {isNavigating && (
                            <div style={{ marginTop: 10, marginBottom: '15px', padding: '10px', background: '#e9ecef', borderRadius: '4px' }}>
                                <span style={{ color: '#198754', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
                                    Navigating: Go to Point {currentNavIndex + 1} ({currentTargetPoint?.name || '...'})
                                </span>
                                <div style={{marginBottom: '10px'}}>
                                    <label style={{ marginRight: 15, fontSize: '0.9rem', cursor: 'pointer' }}>
                                        <input type="radio" checked={demoMode} onChange={() => setDemoMode(true)} style={{ marginRight: 5 }} name="navMode"/> Demo
                                    </label>
                                    <label style={{ fontSize: '0.9rem', cursor: 'pointer' }}>
                                        <input type="radio" checked={!demoMode} onChange={() => setDemoMode(false)} style={{ marginRight: 5 }} name="navMode"/> Real GPS
                                    </label>
                                </div>
                                <button onClick={handleStopNavigation} style={{...buttonStyle, backgroundColor: '#dc3545', marginTop: '5px', width: '100%'}}>
                                    Stop Navigation
                                </button>

                                {pointForFollowUp && currentTourData?.tour_id && (
                                    <div style={{ marginTop: '15px', borderTop: '1px solid #ccc', paddingTop: '10px' }}>
                                        <h4 style={{marginTop:0, marginBottom:'8px', fontSize:'1rem'}}>Ask about: {pointForFollowUp.name}</h4>
                                        <textarea
                                            placeholder="Your question..."
                                            value={navFollowUpQuestionText}
                                            onChange={(e) => setNavFollowUpQuestionText(e.target.value)}
                                            style={{...formInputStyle, minHeight:'50px', fontSize:'0.9rem', padding:'8px'}}
                                            rows={2}
                                        />
                                        <button
                                            onClick={() => handleAskQuestion(currentTourData.tour_id, pointForFollowUp.name, navFollowUpQuestionText)}
                                            style={{...buttonStyle, fontSize:'0.9rem', padding:'6px 12px', minWidth:'auto', backgroundColor:'#007bff'}}
                                            disabled={!navFollowUpQuestionText.trim()}
                                        >
                                            Send Question
                                        </button>

                                        {/* NEW: Button to play latest ready follow-up answer */}
                                        {(() => {
                                            if (!pointForFollowUp || !pointForFollowUp.content || pointForFollowUp.content.length === 0) {
                                                return null;
                                            }
                                            let latestReadyFollowUpNugget = null;
                                            for (let i = pointForFollowUp.content.length - 1; i >= 0; i--) {
                                                const nugget = pointForFollowUp.content[i];
                                                // A follow-up must have a 'question', be 'ready', and have an 'audio_path'
                                                if (nugget && nugget.question && nugget.ready && nugget.audio_path) {
                                                    latestReadyFollowUpNugget = nugget;
                                                    break;
                                                }
                                            }

                                            if (latestReadyFollowUpNugget) {
                                                return (
                                                    <button
                                                        onClick={() => playAudioForPoint(latestReadyFollowUpNugget.audio_path)}
                                                        style={{
                                                            ...buttonStyle,
                                                            fontSize: '0.9rem',
                                                            padding: '8px 12px',
                                                            backgroundColor: '#28a745', // Green for play/ready
                                                            color: 'white',
                                                            marginTop: '10px',
                                                            width: '100%',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: '5px'
                                                        }}
                                                        title={`Play answer for: "${latestReadyFollowUpNugget.question}"`}
                                                    >
                                                        <span role="img" aria-label="Play">▶️</span> Play Latest Answer
                                                    </button>
                                                );
                                            }
                                            return null;
                                        })()}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Common action buttons in a flex container */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '15px' }}>
                            <button
                                onClick={() => {
                                    setIsMyToursModalOpen(true);
                                    handleLoadTourList(); // Refresh list on open
                                }}
                                style={isNavigating ? disabledButtonStyle : {...buttonStyle, flexGrow: 1, backgroundColor: '#17a2b8'}} // Example color
                                disabled={isNavigating || isLoadingTour || isProcessingTourSubmission}>
                                My Tours
                            </button>

                            <button
                                onClick={handleOpenTourDetailsForm}
                                style={isNavigating ? disabledButtonStyle : {...buttonStyle, flexGrow: 1, backgroundColor: '#ffc107', color: '#212529'}} // Example color
                                disabled={isNavigating || isLoadingTour || isProcessingTourSubmission || (tourPoints.length === 0 && !currentTourData?.tour_id) }
                            >
                                {isProcessingTourSubmission ? "Processing..." : (currentTourData?.tour_id ? "Update Details" : "Create Tour")}
                            </button>

                            <button
                                onClick={() => {
                                    setTourPoints([]);
                                    setCurrentTourData(null);
                                    if (directionsRendererRef.current) directionsRendererRef.current.setDirections({ routes: [] });
                                    lastCalculatedTourPointsRef.current = [];
                                    setIsNavigating(false);
                                    setPointForFollowUp(null);
                                    setNavFollowUpQuestionText('');
                                    setCurrentNavIndex(0);
                                    setRoutePath([]);
                                    if (pollingIntervalId) clearInterval(pollingIntervalId);
                                    setPollingIntervalId(null);
                                    setShowTourDetailsForm(false);
                                    setCurrentAudioPath(null); // Also clear audio
                                }}
                                disabled={isNavigating || isLoadingTour || isProcessingTourSubmission}
                                style={isNavigating ? disabledButtonStyle : {...buttonStyle, flexGrow: 1, backgroundColor: '#6c757d'}} // Full width if it's the only one in a row
                            > Clear Workspace
                            </button>
                        </div>
                    </>
                )}

                {showTourDetailsForm && (
                    <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '8px', background:'#f9f9f9' }}>
                        <h3 style={{marginTop:0, marginBottom:'15px', textAlign:'center'}}>
                            {currentTourData?.tour_id ? "Update Tour Details" : "Create New Tour"}
                        </h3>
                        <div>
                            <label htmlFor="tourName" style={formLabelStyle}>Tour Name:</label>
                            <input type="text" id="tourName" name="name" style={formInputStyle}
                                value={tourDetailsForm.name} onChange={handleTourDetailsFormChange} />
                        </div>
                        <div>
                            <label htmlFor="guidePersonality" style={formLabelStyle}>Tour Guide Personality:</label>
                            <textarea id="guidePersonality" name="guidePersonality" style={{...formInputStyle, minHeight:'60px'}}
                                value={tourDetailsForm.guidePersonality} onChange={handleTourDetailsFormChange} rows={3}/>
                        </div>
                        <div>
                            <label htmlFor="userPreferences" style={formLabelStyle}>User Preferences:</label>
                            <textarea id="userPreferences" name="userPreferences" style={{...formInputStyle, minHeight:'60px'}}
                                value={tourDetailsForm.userPreferences} onChange={handleTourDetailsFormChange} rows={3}/>
                        </div>
                        <div style={{marginTop:'15px', display:'flex', justifyContent:'space-between', gap: '10px'}}>
                            <button
                                onClick={handleTourDataSubmit}
                                style={{...buttonStyle, backgroundColor:'#28a745', flexGrow:1}}
                                disabled={isProcessingTourSubmission}
                            >
                                {isProcessingTourSubmission
                                    ? (currentTourData?.tour_id ? "Updating..." : "Creating...")
                                    : (currentTourData?.tour_id ? "Update Details" : "Create Tour")}
                            </button>
                            <button
                                onClick={() => setShowTourDetailsForm(false)}
                                style={{...buttonStyle, backgroundColor:'#6c757d', flexGrow:1}}
                                disabled={isProcessingTourSubmission}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {!showTourDetailsForm && tourPoints.length > 0 && (
                    <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                        <h3>Tour Stops ({tourPoints.length}):</h3>
                        <ol style={{ listStyleType: 'decimal', paddingLeft: '20px', maxHeight: '250px', overflowY: 'auto' }}> {/* Adjusted maxHeight */}
                            {tourPoints.map((point, index) => {
                                const firstNugget = point.content && point.content[0];
                                const isPointContentReady = firstNugget && firstNugget.ready;
                                return (
                                    <li key={`${point.name}-detail-${point.lat}-${point.lng}-${index}`} style={{
                                        marginBottom: '15px', padding: '10px', borderRadius: '4px',
                                        background: isNavigating && currentTargetPoint && point.name === currentTargetPoint.name && Math.abs(point.lat - currentTargetPoint.lat) < 0.0001 && Math.abs(point.lng - currentTargetPoint.lng) < 0.0001 ? '#fffbe6' : (point.visited ? '#e6f7ff' : 'transparent'),
                                        border: '1px solid #eee'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ flexGrow: 1, fontWeight: 'bold', wordBreak: 'break-word' }}>
                                                {index + 1}: {point.name || `Point ${index + 1}`}
                                            </span>
                                            {!isNavigating && <button onClick={() => removeTourPoint(index)} title="Remove"
                                                style={{ background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: '1.2em', padding: '0 5px' }}>
                                                🗑️
                                            </button>}
                                        </div>
                                        <div style={{ fontSize: '0.9em', marginTop: '5px', color: '#555' }}>
                                            Lat: {point.lat.toFixed(4)}, Lng: {point.lng.toFixed(4)}
                                        </div>
                                        <div style={{ marginTop: '8px', fontSize: '0.9em' }}>
                                            <span style={{ color: isPointContentReady ? 'green' : (firstNugget ? 'orange': '#aaa'), fontWeight: 'bold', marginRight: '15px' }}>
                                                ● {isPointContentReady ? 'Ready' : (firstNugget ? 'Processing...' : 'No Content Yet')}
                                            </span>
                                            <span style={{ color: point.visited ? 'blue' : '#aaa', fontWeight: 'bold' }}>
                                                ● {point.visited ? "Visited" : "Not Visited"}
                                            </span>
                                        </div>
                                        {point.content && point.content.map((nugget, nugIdx) => (
                                            <div key={nugget.id || `nug-${point.lat}-${nugIdx}`} style={{ borderTop: '1px dashed #eee', marginTop: '8px', paddingTop: '8px' }}>
                                                <strong style={{display: 'block', marginBottom: '3px'}}>{nugIdx === 0 ? "Main Content:" : `Follow-up ${nugIdx}:`}</strong>
                                                {nugget.question && <p style={{margin:'3px 0', fontSize: '0.85em', fontStyle: 'italic'}}>Q: {nugget.question}</p>}
                                                {nugget.ready ? (
                                                    <>
                                                      {nugget.answer && <p style={{margin:'3px 0', fontSize: '0.85em'}}>A: {nugget.answer.substring(0,100)}{nugget.answer.length > 100 ? '...' : ''}</p>}
                                                      {nugget.audio_path &&
                                                        <button onClick={() => playAudioForPoint(nugget.audio_path)}
                                                                style={{...buttonStyle, fontSize:'0.8em', padding:'4px 8px', backgroundColor: '#007bff', minWidth:'auto', marginTop: '5px'}}>
                                                            {/* MODIFIED: Clearer button text */}
                                                            {nugIdx === 0 ? `Play Point Audio` : `Play Answer Audio`}
                                                        </button>}
                                                    </>
                                                ) : ( <span style={{color: 'orange', fontSize: '0.85em'}}>(Processing audio for this part...)</span> )}
                                            </div>
                                        ))}
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                )}
            </div>

            {/* "My Tours" Modal */}
            {isMyToursModalOpen && (
                <div style={modalOverlayStyle}>
                    <div style={modalContentStyle}>
                        <div style={modalHeaderStyle}>
                            <span>My Tours</span>
                            <button
                                onClick={() => {
                                    setIsMyToursModalOpen(false);
                                    setSelectedTourInModal('');
                                }}
                                style={modalCloseButtonStyle}
                                title="Close"
                            >
                                ×
                            </button>
                        </div>

                        {isLoadingTourList ? (
                            <p style={{textAlign: 'center', margin: '20px 0'}}>Loading available tours...</p>
                        ) : tourList.length === 0 ? (
                            <p style={{textAlign: 'center', margin: '20px 0'}}>No tours found. You can create one using the "Create Tour" button!</p>
                        ) : (
                            <select
                                value={selectedTourInModal}
                                onChange={e => setSelectedTourInModal(e.target.value)}
                                style={modalSelectStyle}
                            >
                                <option value="">Select a tour to load...</option>
                                {tourList.map(tour => (
                                    <option key={tour.tour_id} value={tour.tour_id}>
                                        {tour.tour_name || `Tour ID: ${tour.tour_id.substring(0,8)}...`}
                                    </option>
                                ))}
                            </select>
                        )}

                        <div style={modalFooterStyle}>
                            <button
                                onClick={() => {
                                    setIsMyToursModalOpen(false);
                                    setSelectedTourInModal('');
                                }}
                                style={{...buttonStyle, backgroundColor: '#6c757d'}}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    if (selectedTourInModal) {
                                        handleLoadSpecificTour(selectedTourInModal);
                                        setIsMyToursModalOpen(false);
                                        setSelectedTourInModal('');
                                    }
                                }}
                                style={(!selectedTourInModal || isLoadingTour) ? disabledButtonStyle : {...buttonStyle, backgroundColor: '#007bff'}}
                                disabled={!selectedTourInModal || isLoadingTour || isLoadingTourList}
                            >
                                {isLoadingTour ? "Loading Tour..." : "Load Selected Tour"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MapComponent;