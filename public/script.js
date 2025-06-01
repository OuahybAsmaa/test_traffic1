var map = L.map('map').setView([33.7066, -7.3944], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

let trafficData = {};
let currentRoutingControl = null;
let routeLayer = null;
let startMarker = null; // Marqueur pour le véhicule en mouvement (icône de voiture)
let startPointMarker = null; // Marqueur pour le point de départ fixe
let endMarker = null; // Marqueur pour le point d'arrivée
let animationFrame = null;
let routeCoordinates = [];
let startCoords = null;
let initialStartCoords = null; // Nouvelle variable pour stocker les coordonnées initiales du point de départ
let endCoords = null;
let currentRouteSegments = [];
let currentIndex = 0;
let isDarkMode = false;
let is3DView = false;
let weatherMode = null;
let isRouteDetailsVisible = false;
let traveledPath = [];
let traveledPathLayer = null;
let trafficUpdateInterval = null;
let selectedRouteLayer = null;
let routeDescriptionBox = null;

// Définir les icônes
const startIcon = L.divIcon({
    html: '<i class="fas fa-map-marker-alt" style="font-size: 24px; color: green;"></i>',
    className: 'custom-start-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24]
});

const endIcon = L.divIcon({
    html: '<i class="fas fa-map-marker-alt" style="font-size: 24px; color: red;"></i>',
    className: 'custom-end-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24]
});

const carIcon = L.divIcon({
    html: '<i class="fas fa-car-side" style="font-size: 24px; color: #2c3e50;"></i>',
    className: 'custom-car-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

fetch('/traffic-data')
    .then(response => response.json())
    .then(data => {
        trafficData = data;
        populateDropdowns();
    })
    .catch(error => console.error('Erreur chargement traffic-data.json:', error));

function populateDropdowns() {
    const startSelect = document.getElementById('start');
    const endSelect = document.getElementById('end');
    Object.keys(trafficData.locations).forEach(location => {
        startSelect.innerHTML += `<option value="${location}">${location}</option>`;
        endSelect.innerHTML += `<option value="${location}">${location}</option>`;
    });
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    lat1 = lat1 * Math.PI / 180;
    lat2 = lat2 * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;
    return bearing;
}

function findClosestIndex(newCoordinates, currentLat, currentLng) {
    let minDistance = Infinity;
    let closestIndex = 0;
    newCoordinates.forEach((coord, index) => {
        const distance = calculateDistance(currentLat, currentLng, coord[0], coord[1]);
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = index;
        }
    });
    return closestIndex;
}

async function generateRoute(newStartCoords = null) {
    if (!newStartCoords && traveledPathLayer) {
        map.removeLayer(traveledPathLayer);
        traveledPath = [];
        traveledPathLayer = null;
    }

    if (currentRoutingControl) {
        map.removeControl(currentRoutingControl);
    }
    clearRoute();

    const startName = newStartCoords ? "Current Position" : document.getElementById('start').value;
    const endName = document.getElementById('end').value;

    if (!newStartCoords) {
        startCoords = trafficData.locations[startName];
        endCoords = trafficData.locations[endName];
        initialStartCoords = { ...startCoords }; // Stocker les coordonnées initiales
        if (startPointMarker) {
            map.removeLayer(startPointMarker);
            startPointMarker = null;
        }
        if (endMarker) {
            map.removeLayer(endMarker);
            endMarker = null;
        }
        // Ajouter le marqueur fixe pour le point de départ
        startPointMarker = L.marker([startCoords.lat, startCoords.lng], {
            icon: startIcon,
            zIndexOffset: 900
        }).addTo(map).bindPopup('Point de départ');
    } else {
        startCoords = newStartCoords;
    }

    // Ajouter le marqueur pour l'arrivée
    endMarker = L.marker([endCoords.lat, endCoords.lng], {
        icon: endIcon,
        zIndexOffset: 900
    }).addTo(map).bindPopup('Point d\'arrivée');

    if (startCoords.lat === endCoords.lat && startCoords.lng === endCoords.lng) {
        alert("Vous êtes arrivé à destination !");
        document.getElementById('start-btn').style.display = 'none';
        map.removeLayer(endMarker);
        endMarker = null;
        return;
    }

    currentRoutingControl = L.Routing.control({
        waypoints: [
            L.latLng(startCoords.lat, startCoords.lng),
            L.latLng(endCoords.lat, endCoords.lng)
        ],
        routeWhileDragging: false,
        createMarker: () => null,
        lineOptions: { styles: [] },
        router: L.Routing.osrmv1({
            serviceUrl: 'https://router.project-osrm.org/route/v1',
            profile: 'driving'
        }),
        showAlternatives: true
    }).addTo(map);

    await new Promise((resolve) => {
        currentRoutingControl.on('routesfound', function(e) {
            const routes = e.routes;
            const routesList = document.getElementById('routes-list');
            routesList.innerHTML = '';
            trafficData.routes = [];
            routeCoordinates = [];
            currentRouteSegments = [];

            let allRoutes = [];

            routes.forEach((route, index) => {
                const routeDetails = route;
                const routeId = `${startName} - ${endName}-${index + 1}`;
                const totalDistance = routeDetails.summary.totalDistance / 1000;

                const segments = [];
                const coords = routeDetails.coordinates;
                let previousTrafficStatus = 'Congestion fluide';
                let previousOccupancyRate = 50;

                for (let i = 0; i < coords.length - 1; i++) {
                    const segmentDistance = calculateDistance(coords[i].lat, coords[i].lng, coords[i + 1].lat, coords[i + 1].lng);
                    const bearing = calculateBearing(coords[i].lat, coords[i].lng, coords[i + 1].lat, coords[i + 1].lng);

                    const trafficConditions = {
                        traffic_lights: Math.floor(Math.random() * 3),
                        intersections: Math.floor(Math.random() * 2),
                        road_work: Math.random() < 0.1,
                        accidents: Math.random() < 0.05
                    };

                    let trafficImpact = 0;
                    trafficImpact += trafficConditions.traffic_lights * 2;
                    trafficImpact += trafficConditions.intersections * 5;
                    if (trafficConditions.road_work) trafficImpact += 10;
                    if (trafficConditions.accidents) trafficImpact += 15;

                    const maxChange = 15;
                    let newOccupancyRate;

                    const willDegrade = Math.random() < 0.5;

                    if (willDegrade) {
                        if (previousTrafficStatus === 'Congestion fluide') {
                            newOccupancyRate = Math.min(100, previousOccupancyRate + (Math.random() * maxChange) + trafficImpact);
                        } else if (previousTrafficStatus === 'Risque de congestion') {
                            newOccupancyRate = Math.min(150, previousOccupancyRate + (Math.random() * maxChange) + trafficImpact);
                        } else {
                            newOccupancyRate = Math.max(60, previousOccupancyRate + ((Math.random() - 0.5) * maxChange) + trafficImpact);
                        }
                    } else {
                        if (previousTrafficStatus === 'Congestion, état bloqué') {
                            newOccupancyRate = Math.max(60, previousOccupancyRate - (Math.random() * maxChange));
                        } else if (previousTrafficStatus === 'Risque de congestion') {
                            newOccupancyRate = Math.max(0, previousOccupancyRate - (Math.random() * maxChange));
                        } else {
                            newOccupancyRate = Math.min(100, previousOccupancyRate + ((Math.random() - 0.5) * maxChange));
                        }
                    }

                    newOccupancyRate = Math.max(0, Math.min(150, newOccupancyRate));

                    const capacity = 600 * 2;
                    const vehicles = Math.floor((newOccupancyRate / 100) * capacity);

                    segments.push({
                        id: `${i + 1}`,
                        start: { lat: coords[i].lat, lng: coords[i].lng },
                        end: { lat: coords[i + 1].lat, lng: coords[i + 1].lng },
                        distance_km: segmentDistance,
                        bearing: bearing,
                        lanes: 2,
                        capacity_per_lane: 600,
                        vehicles: vehicles,
                        traffic_conditions: trafficConditions
                    });

                    previousOccupancyRate = newOccupancyRate;
                    const tempCapacity = 600 * 2;
                    const tempOccupancyRate = (vehicles / tempCapacity) * 100;
                    previousTrafficStatus = tempOccupancyRate < 60 ? 'Congestion fluide' :
                                            tempOccupancyRate <= 100 ? 'Risque de congestion' :
                                            'Congestion, état bloqué';
                }

                segments.forEach(segment => {
                    const capacity = segment.capacity_per_lane * segment.lanes;
                    const occupancyRate = (segment.vehicles / capacity) * 100;
                    segment.occupancy_rate = occupancyRate.toFixed(2);
                    segment.traffic_status = occupancyRate < 60 ? 'Congestion fluide' :
                                            occupancyRate <= 100 ? 'Risque de congestion' :
                                            'Congestion, état bloqué';
                });

                const subRoutes = [];
                let currentRoute = { segments: [segments[0]], distance_km: segments[0].distance_km };
                const directionThreshold = 45;
                const minRouteDistance = 0.1;

                for (let i = 1; i < segments.length; i++) {
                    const prevSegment = segments[i - 1];
                    const currentSegment = segments[i];
                    const directionDiff = Math.abs(currentSegment.bearing - prevSegment.bearing);

                    if (directionDiff <= directionThreshold || currentRoute.distance_km < minRouteDistance) {
                        currentRoute.segments.push(currentSegment);
                        currentRoute.distance_km += currentSegment.distance_km;
                    } else {
                        subRoutes.push(currentRoute);
                        currentRoute = { segments: [currentSegment], distance_km: currentSegment.distance_km };
                    }
                }
                subRoutes.push(currentRoute);

                subRoutes.forEach((route, idx) => {
                    const totalOccupancy = route.segments.reduce((sum, seg) => sum + parseFloat(seg.occupancy_rate), 0);
                    const avgOccupancy = totalOccupancy / route.segments.length;
                    route.id = `Route ${idx + 1}`;
                    route.avg_occupancy_rate = avgOccupancy.toFixed(2);
                    route.traffic_status = avgOccupancy < 60 ? 'Congestion fluide' :
                                          avgOccupancy <= 100 ? 'Risque de congestion' :
                                          'Congestion, état bloqué';
                });

                const totalAvgOccupancy = subRoutes.reduce((sum, r) => sum + parseFloat(r.avg_occupancy_rate), 0) / subRoutes.length;

                const routeData = {
                    id: routeId,
                    start: startName,
                    end: endName,
                    distance_km: totalDistance,
                    routes: subRoutes,
                    avg_occupancy: totalAvgOccupancy.toFixed(2)
                };
                allRoutes.push(routeData);

                const routeItem = document.createElement('p');
                routeItem.className = 'route-item';
                routeItem.innerHTML = `
                    Itinéraire ${index + 1}: ${totalDistance.toFixed(2)} km 
                    (Congestion moyenne: ${totalAvgOccupancy.toFixed(2)}%)
                `;
                routeItem.addEventListener('click', () => displayRouteOnMap(index));
                routesList.appendChild(routeItem);
            });

            trafficData.routes = allRoutes;
            saveTrafficData();
            updateTrafficDisplay();
            document.getElementById('start-btn').style.display = 'inline-block';

            resolve();
        });
    });

    //map.removeControl(currentRoutingControl);
}

function displayRouteOnMap(routeIndex) {
    if (!trafficData.routes[routeIndex]) {
        console.error('Invalid route index:', routeIndex);
        alert('Erreur : Itinéraire non trouvé.');
        return;
    }

    if (routeDescriptionBox) {
        routeDescriptionBox.remove();
        routeDescriptionBox = null;
    }

    const selectedRoute = trafficData.routes[routeIndex];

    if (routeLayer) {
        map.removeLayer(routeLayer);
    }
    routeLayer = L.layerGroup().addTo(map);

    let bounds = L.latLngBounds();

    trafficData.routes.forEach((route, idx) => {
        route.routes.forEach(r => {
            const isSelected = idx === routeIndex;
            const color = r.traffic_status === 'Congestion, état bloqué' ? 'red' :
                          r.traffic_status === 'Risque de congestion' ? 'yellow' : 'green';
            const opacity = isSelected ? 0.8 : 0.5;
            const coords = [];
            r.segments.forEach(segment => {
                coords.push([segment.start.lat, segment.start.lng]);
                if (isSelected) {
                    bounds.extend([segment.start.lat, segment.start.lng]);
                }
                if (segment === r.segments[r.segments.length - 1]) {
                    coords.push([segment.end.lat, segment.end.lng]);
                    if (isSelected) {
                        bounds.extend([segment.end.lat, segment.end.lng]);
                    }
                }
            });

            L.polyline(coords, {
                color,
                weight: 5,
                opacity
            })
                .bindPopup(`${r.id}: ${r.traffic_status} (Taux moyen: ${r.avg_occupancy_rate}%)`)
                .addTo(routeLayer);
        });
    });

    if (bounds.isValid()) {
        map.fitBounds(bounds);
    } else {
        console.warn('No valid bounds for the selected route');
        map.setView([startCoords.lat, startCoords.lng], 12);
    }

    const descriptionBox = document.createElement('div');
    descriptionBox.className = 'route-description-box';
    descriptionBox.innerHTML = `
        <span>Itinéraire ${routeIndex + 1}: ${selectedRoute.distance_km.toFixed(2)} km, Congestion moyenne: ${selectedRoute.avg_occupancy}%</span>
        <button class="close-btn">×</button>
    `;
    console.log('Creating description box for route:', routeIndex + 1);
    document.body.appendChild(descriptionBox);
    routeDescriptionBox = descriptionBox;

    descriptionBox.querySelector('.close-btn').addEventListener('click', () => {
        descriptionBox.remove();
        routeDescriptionBox = null;
        updateTrafficDisplay();
    });
}

function updateTrafficDisplay() {
    fetch('/traffic-data')
        .then(response => response.json())
        .then(data => {
            trafficData = data;

            if (trafficData.routes.length > 0) {
                let currentPosition = startMarker ? startMarker.getLatLng() : null;

                if (routeLayer) {
                    map.removeLayer(routeLayer);
                }
                routeLayer = L.layerGroup().addTo(map);

                if (traveledPath.length > 1) {
                    if (traveledPathLayer) {
                        map.removeLayer(traveledPathLayer);
                    }
                    traveledPathLayer = L.polyline(traveledPath, {
                        color: 'blue',
                        weight: 5,
                        opacity: 0.7
                    }).addTo(map);
                }

                trafficData.routes.forEach((route, index) => {
                    route.routes.forEach(r => {
                        const color = r.traffic_status === 'Congestion, état bloqué' ? 'red' :
                                      r.traffic_status === 'Risque de congestion' ? 'yellow' : 'green';
                        const coords = [];
                        r.segments.forEach(segment => {
                            coords.push([segment.start.lat, segment.start.lng]);
                            if (segment === r.segments[r.segments.length - 1]) {
                                coords.push([segment.end.lat, segment.end.lng]);
                            }
                        });

                        L.polyline(coords, {
                            color,
                            weight: 5,
                            opacity: 0.8
                        })
                            .bindPopup(`${r.id}: ${r.traffic_status} (Taux moyen: ${r.avg_occupancy_rate}%)`)
                            .addTo(routeLayer);
                    });
                });

                // Ajouter ou mettre à jour le marqueur de voiture pour la simulation
                if (!startMarker && startCoords) {
                    startMarker = L.marker([startCoords.lat, startCoords.lng], {
                        icon: carIcon,
                        zIndexOffset: 1000
                    }).addTo(map).bindPopup('Véhicule');
                } else if (currentPosition) {
                    startMarker.setLatLng(currentPosition);
                }

                // Ajouter ou mettre à jour le marqueur pour l'arrivée
                if (!endMarker) {
                    endMarker = L.marker([endCoords.lat, endCoords.lng], {
                        icon: endIcon,
                        zIndexOffset: 900
                    }).addTo(map).bindPopup('Point d\'arrivée');
                }

                let bounds = L.latLngBounds();
                trafficData.routes.forEach(route => {
                    route.routes.forEach(r => {
                        r.segments.forEach(segment => {
                            bounds.extend([segment.start.lat, segment.start.lng]);
                            if (segment === r.segments[r.segments.length - 1]) {
                                bounds.extend([segment.end.lat, segment.end.lng]);
                            }
                        });
                    });
                });
                if (initialStartCoords) {
                    bounds.extend([initialStartCoords.lat, initialStartCoords.lng]);
                }
                if (bounds.isValid()) {
                    map.fitBounds(bounds);
                } else {
                    map.setView([startCoords.lat, startCoords.lng], 12);
                }
            }
        });
}

function clearRoute() {
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    if (selectedRouteLayer) {
        map.removeLayer(selectedRouteLayer);
        selectedRouteLayer = null;
    }
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
    if (routeDescriptionBox) {
        routeDescriptionBox.remove();
        routeDescriptionBox = null;
    }
    if (startMarker) {
        map.removeLayer(startMarker);
        startMarker = null;
    }
    if (endMarker) {
        map.removeLayer(endMarker);
        endMarker = null;
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function saveTrafficData() {
    fetch('/save-traffic-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trafficData)
    }).catch(error => console.error('Erreur sauvegarde:', error));
}

function playCongestionSound() {
    const utterance = new SpeechSynthesisUtterance("Congestion a venir!");
    utterance.lang = 'fr-FR';
    utterance.volume = 1.0;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const frenchVoice = voices.find(voice => voice.lang === 'fr-FR');
    if (frenchVoice) {
        utterance.voice = frenchVoice;
    }

    window.speechSynthesis.speak(utterance);
}

function startMoving() {
    if (!trafficData.routes.length || !startCoords) return;

    let leastCongestedRoute = null;
    let minAvgOccupancy = Infinity;

    trafficData.routes.forEach(route => {
        const totalAvgOccupancy = parseFloat(route.avg_occupancy);
        if (totalAvgOccupancy < minAvgOccupancy) {
            minAvgOccupancy = totalAvgOccupancy;
            leastCongestedRoute = route;
        }
    });

    trafficData.routes = [leastCongestedRoute];
    const routesList = document.getElementById('routes-list');
    routesList.innerHTML = `
        <p class="route-item">Itinéraire optimal: ${leastCongestedRoute.distance_km.toFixed(2)} km 
        (Congestion moyenne: ${minAvgOccupancy}%)</p>
    `;
    saveTrafficData();

    routeCoordinates = [];
    currentRouteSegments = [];
    let totalDistance = 0;

    leastCongestedRoute.routes.forEach(r => {
        r.segments.forEach(segment => {
            routeCoordinates.push([segment.start.lat, segment.start.lng]);
            currentRouteSegments.push({
                start: segment.start,
                end: segment.end,
                traffic_status: r.traffic_status,
                distance_km: segment.distance_km
            });
            totalDistance += segment.distance_km;
            if (segment === r.segments[r.segments.length - 1]) {
                routeCoordinates.push([segment.end.lat, segment.end.lng]);
            }
        });
    });

    currentIndex = 0;
    if (!startMarker) {
        startMarker = L.marker([startCoords.lat, startCoords.lng], {
            icon: carIcon,
            zIndexOffset: 1000
        }).addTo(map).bindPopup('Véhicule');
    } else {
        startMarker.setLatLng([startCoords.lat, startCoords.lng]);
    }

    if (traveledPath.length === 0) {
        traveledPath = [[startCoords.lat, startCoords.lng]];
    }

    if (traveledPathLayer) {
        map.removeLayer(traveledPathLayer);
    }
    traveledPathLayer = L.polyline(traveledPath, {
        color: 'blue',
        weight: 5,
        opacity: 0.7
    }).addTo(map);

    updateTrafficDisplay();

    const speed = 0.00002;
    const lookAheadSegments = 3;
    let traveledDistance = 0;

    function updateProgressBar() {
        const progressPercent = (traveledDistance / totalDistance) * 100;
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        if (progressFill && progressText) {
            progressFill.style.width = `${progressPercent}%`;
            progressText.textContent = `${progressPercent.toFixed(0)}%`;
        }
    }

    function animate() {
        if (currentIndex >= routeCoordinates.length - 1) {
            traveledDistance = totalDistance;
            updateProgressBar();

            Swal.fire({
                icon: 'success',
                title: 'Arrivée !',
                text: 'Vous avez atteint votre destination avec succès.',
                position: 'center',
                showConfirmButton: true,
                confirmButtonText: 'OK',
                confirmButtonColor: '#2a5298',
                timer: 5000,
                customClass: {
                    popup: 'swal-custom-popup',
                    title: 'swal-custom-title',
                    content: 'swal-custom-content'
                }
            });

            if (trafficUpdateInterval) {
                clearInterval(trafficUpdateInterval);
                trafficUpdateInterval = null;
            }

            if (routeLayer) {
                map.removeLayer(routeLayer);
                routeLayer = null;
            }

            if (traveledPathLayer) {
                map.removeLayer(traveledPathLayer);
            }
            traveledPathLayer = L.polyline(traveledPath, {
                color: 'blue',
                weight: 5,
                opacity: 0.7
            }).addTo(map);

            document.getElementById('start-btn').style.display = 'none';
            cancelAnimationFrame(animationFrame);
            return;
        }

        let congestionAhead = false;
        for (let i = 1; i <= lookAheadSegments && currentIndex + i < currentRouteSegments.length; i++) {
            const futureSegment = currentRouteSegments[currentIndex + i];
            if (futureSegment && futureSegment.traffic_status === 'Congestion, état bloqué') {
                congestionAhead = true;
                break;
            }
        }

        if (congestionAhead) {
            Swal.fire({
                icon: 'warning',
                title: 'Congestion à venir !',
                text: 'Une congestion est détectée sur votre trajet. Un nouvel itinéraire est en cours de calcul.',
                position: 'top-end',
                timer: 1500,
                showConfirmButton: false,
                toast: true
            });
            playCongestionSound();

            cancelAnimationFrame(animationFrame);
            const currentLatLng = startMarker.getLatLng();
            startCoords = { lat: currentLatLng.lat, lng: currentLatLng.lng };

            traveledPath.push([currentLatLng.lat, currentLatLng.lng]);
            if (traveledPathLayer) {
                map.removeLayer(traveledPathLayer);
            }
            traveledPathLayer = L.polyline(traveledPath, {
                color: 'blue',
                weight: 5,
                opacity: 0.7
            }).addTo(map);

            generateRoute(startCoords).then(() => {
                const newIndex = findClosestIndex(routeCoordinates, startCoords.lat, startCoords.lng);
                currentIndex = newIndex;
                startMoving();
            });
            return;
        }

        const start = routeCoordinates[currentIndex];
        const end = routeCoordinates[currentIndex + 1];
        const latDiff = end[0] - start[0];
        const lngDiff = end[1] - start[1];
        const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
        const steps = Math.max(1, Math.floor(distance / speed));
        let step = 0;

        const currentSegment = currentRouteSegments[currentIndex];
        if (currentSegment && currentSegment.traffic_status === 'Congestion, état bloqué') {
            Swal.fire({
                icon: 'warning',
                title: 'Attention, congestion !',
                text: 'La route est bloquée devant vous. Un nouvel itinéraire est en cours de calcul.',
                position: 'top-end',
                timer: 1000,
                showConfirmButton: false,
                toast: true
            });
            playCongestionSound();

            cancelAnimationFrame(animationFrame);
            const currentLatLng = startMarker.getLatLng();
            startCoords = { lat: currentLatLng.lat, lng: currentLatLng.lng };

            traveledPath.push([currentLatLng.lat, currentLatLng.lng]);
            if (traveledPathLayer) {
                map.removeLayer(traveledPathLayer);
            }
            traveledPathLayer = L.polyline(traveledPath, {
                color: 'blue',
                weight: 5,
                opacity: 0.7
            }).addTo(map);

            generateRoute(startCoords).then(() => {
                const newIndex = findClosestIndex(routeCoordinates, startCoords.lat, startCoords.lng);
                currentIndex = newIndex;
                startMoving();
            });
            return;
        }

        function moveStep() {
            step++;
            if (step <= steps) {
                const progress = step / steps;
                const newLat = start[0] + (latDiff * progress);
                const newLng = start[1] + (lngDiff * progress);
                startMarker.setLatLng([newLat, newLng]);

                traveledPath.push([newLat, newLng]);
                if (traveledPathLayer) {
                    map.removeLayer(traveledPathLayer);
                }
                traveledPathLayer = L.polyline(traveledPath, {
                    color: 'blue',
                    weight: 5,
                    opacity: 0.7
                }).addTo(map);

                traveledDistance += (currentSegment.distance_km / steps);
                updateProgressBar();

                animationFrame = requestAnimationFrame(moveStep);
            } else {
                currentIndex++;
                if (currentIndex < routeCoordinates.length - 1) {
                    animationFrame = requestAnimationFrame(animate);
                }
            }
        }

        animationFrame = requestAnimationFrame(moveStep);
    }

    updateProgressBar();
    animate();
}

let isRealistMap = false;
let currentTileLayer = null;

function toggleRealistMap() {
    if (currentTileLayer) {
        map.removeLayer(currentTileLayer);
    }

    if (!isRealistMap) {
        currentTileLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '© Google Maps'
        }).addTo(map);
        isRealistMap = true;
    } else {
        currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        isRealistMap = false;
    }
}

currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

document.getElementById('realist_map_btn').addEventListener('click', toggleRealistMap);
document.getElementById('dark-mode-btn').addEventListener('click', toggleDarkMode);
document.getElementById('view-3d-btn').addEventListener('click', toggle3DView);
document.getElementById('rain-btn').addEventListener('click', () => toggleWeather('rain'));
document.getElementById('fog-btn').addEventListener('click', () => toggleWeather('fog'));
document.getElementById('screenshot-btn').addEventListener('click', captureScreenshot);
document.getElementById('share-btn').addEventListener('click', shareRoute);
document.getElementById('route-details-btn').addEventListener('click', toggleRouteDetails);

function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode');
}

function toggle3DView() {
    is3DView = !is3DView;
    const mapDiv = document.getElementById('map');
    if (mapDiv) {
        if (is3DView) {
            mapDiv.classList.add('view-3d');
        } else {
            mapDiv.classList.remove('view-3d');
        }
    }
    if (typeof map !== 'undefined' && map.invalidateSize) {
        map.invalidateSize();
    }
}

function toggleWeather(mode) {
    const mapDiv = document.getElementById('map');
    const weatherIcon = document.getElementById('weather-icon');
    const weatherText = document.getElementById('weather-text');

    if (!mapDiv || !weatherIcon || !weatherText) return;

    if (weatherMode === mode) {
        weatherMode = null;
        mapDiv.classList.remove('rain-mode', 'fog-mode');
        weatherIcon.className = 'fas fa-sun';
        weatherText.textContent = 'Soleil';
    } else {
        weatherMode = mode;
        mapDiv.classList.remove('rain-mode', 'fog-mode');
        if (mode === 'rain') {
            mapDiv.classList.add('rain-mode');
            weatherIcon.className = 'fas fa-cloud-rain';
            weatherText.textContent = 'Pluie';
        } else if (mode === 'fog') {
            mapDiv.classList.add('fog-mode');
            weatherIcon.className = 'fas fa-smog';
            weatherText.textContent = 'Brouillard';
        }
    }
}

function captureScreenshot() {
    const mapElement = document.getElementById('map');
    if (mapElement && typeof html2canvas !== 'undefined') {
        html2canvas(mapElement).then(canvas => {
            const link = document.createElement('a');
            link.download = 'carte-itineraire.png';
            link.href = canvas.toDataURL();
            link.click();
        });
    } else {
        alert('Impossible de capturer la carte (html2canvas manquant ou élément introuvable).');
    }
}

function shareRoute() {
    const startSelect = document.getElementById('start');
    const endSelect = document.getElementById('end');
    if (startSelect && endSelect) {
        const shareLink = `https://example.com/route?start=${encodeURIComponent(startSelect.value)}&end=${encodeURIComponent(endSelect.value)}`;
        navigator.clipboard.writeText(shareLink).then(() => {
            Swal.fire({
                icon: 'success',
                title: 'Lien copié !',
                text: "Le lien de l'itinéraire a été copié dans le presse-papiers.",
                position: 'top-end',
                timer: 1500,
                showConfirmButton: false,
                toast: true
            });
        }).catch(() => {
            alert('Erreur lors de la copie du lien.');
        });
    }
}

function toggleRouteDetails() {
    isRouteDetailsVisible = !isRouteDetailsVisible;
    const routeDetails = document.getElementById('route-details');
    const routeDetailsContent = document.getElementById('route-details-content');

    if (routeDetails && routeDetailsContent) {
        routeDetails.style.display = isRouteDetailsVisible ? 'block' : 'none';

        if (isRouteDetailsVisible && trafficData.routes.length > 0) {
            let selectedRoute = trafficData.routes[0];
            let content = `<h5>Itinéraire: ${selectedRoute.start} → ${selectedRoute.end}</h5>`;
            content += `<p><strong>Distance totale:</strong> ${selectedRoute.distance_km.toFixed(2)} km</p>`;
            content += `<p><strong>Congestion moyenne:</strong> ${selectedRoute.avg_occupancy}%</p>`;
            content += `<h6>Segments:</h6><ul>`;

            selectedRoute.routes.forEach((subRoute, index) => {
                content += `<li><strong>Route ${index + 1}</strong>: ${subRoute.traffic_status} (Taux moyen: ${subRoute.avg_occupancy_rate}%)</li>`;
                subRoute.segments.forEach((segment, segIndex) => {
                    content += `
                        <ul>
                            <li>Segment ${segIndex + 1}: ${segment.distance_km.toFixed(2)} km, 
                            ${segment.traffic_status} (Taux: ${segment.occupancy_rate}%)</li>
                        </ul>
                    `;
                });
            });

            content += `</ul>`;
            routeDetailsContent.innerHTML = content;
        } else if (isRouteDetailsVisible && trafficData.routes.length === 0) {
            routeDetailsContent.innerHTML = `<p>Aucun itinéraire disponible. Veuillez générer un itinéraire.</p>`;
        }
    }
}
