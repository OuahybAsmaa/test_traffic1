const express = require('express');
const path = require('path');
const app = express();

// Importer les données directement
const trafficData = require('./traffic-data.json'); // Assurez-vous que traffic-data.json est dans le même répertoire que server.js

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Route pour servir index.html à la racine
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fonction pour calculer le taux d'occupation et l'état du trafic
function calculateTrafficStatus(segment) {
    const capacity = segment.capacity_per_lane * segment.lanes;
    const occupancyRate = (segment.vehicles / capacity) * 100;
    let trafficStatus;
    if (occupancyRate < 60) trafficStatus = 'Congestion fluide';
    else if (occupancyRate <= 100) trafficStatus = 'Risque de congestion';
    else trafficStatus = 'Congestion, état bloqué';
    return { occupancyRate: occupancyRate.toFixed(2), trafficStatus };
}

// Mettre à jour les données de trafic avec des transitions logiques
function updateTrafficData() {
    if (!Array.isArray(trafficData.routes) || trafficData.routes.length === 0) {
        return;
    }

    trafficData.routes.forEach(route => {
        route.routes.forEach(r => {
            let previousTrafficStatus = 'Congestion fluide'; // État initial pour le premier segment

            r.segments.forEach(segment => {
                const maxCapacity = segment.capacity_per_lane * segment.lanes;

                // Générer les conditions de trafic
                segment.traffic_conditions.road_work = Math.random() < 0.1;
                segment.traffic_conditions.accidents = Math.random() < 0.05;
                segment.traffic_conditions.traffic_lights = Math.floor(Math.random() * 3);
                segment.traffic_conditions.intersections = Math.floor(Math.random() * 2);

                // Calculer l'impact des conditions de trafic
                let trafficImpact = 0;
                trafficImpact += segment.traffic_conditions.traffic_lights * 2; // +2% par feu
                trafficImpact += segment.traffic_conditions.intersections * 5; // +5% par intersection
                if (segment.traffic_conditions.road_work) trafficImpact += 10; // +10% pour travaux
                if (segment.traffic_conditions.accidents) trafficImpact += 15; // +15% pour accident

                // Récupérer le taux d'occupation actuel
                let currentOccupancyRate = parseFloat(segment.occupancy_rate) || 50;
                let currentStatus = segment.traffic_status || previousTrafficStatus;

                // Définir les transitions autorisées
                const maxChange = 15; // Variation maximale
                let newOccupancyRate;

                // Probabilité de changement d'état (50% pour rester, 50% pour changer)
                const willChange = Math.random() < 0.5;

                if (willChange) {
                    if (currentStatus === 'Congestion fluide') {
                        // Vert : Peut rester vert ou devenir jaune
                        if (Math.random() < 0.5) {
                            // Rester vert
                            newOccupancyRate = Math.min(59.9, currentOccupancyRate + ((Math.random() - 0.5) * maxChange));
                        } else {
                            // Devenir jaune
                            newOccupancyRate = Math.min(100, 60 + (Math.random() * (100 - 60)));
                        }
                    } else if (currentStatus === 'Risque de congestion') {
                        // Jaune : Peut devenir vert, rester jaune ou devenir rouge
                        const rand = Math.random();
                        if (rand < 0.33) {
                            // Devenir vert
                            newOccupancyRate = Math.max(0, Math.min(59.9, currentOccupancyRate - (Math.random() * maxChange)));
                        } else if (rand < 0.66) {
                            // Rester jaune
                            newOccupancyRate = Math.max(60, Math.min(100, currentOccupancyRate + ((Math.random() - 0.5) * maxChange)));
                        } else {
                            // Devenir rouge
                            newOccupancyRate = Math.min(150, 100.1 + (Math.random() * (150 - 100.1)));
                        }
                    } else {
                        // Rouge : Peut devenir jaune ou rester rouge
                        if (Math.random() < 0.5) {
                            // Rester rouge
                            newOccupancyRate = Math.max(100.1, currentOccupancyRate + ((Math.random() - 0.5) * maxChange));
                        } else {
                            // Devenir jaune
                            newOccupancyRate = Math.max(60, Math.min(100, currentOccupancyRate - (Math.random() * maxChange)));
                        }
                    }
                } else {
                    // Rester dans l'état actuel avec une petite variation
                    if (currentStatus === 'Congestion fluide') {
                        newOccupancyRate = Math.max(0, Math.min(59.9, currentOccupancyRate + ((Math.random() - 0.5) * maxChange)));
                    } else if (currentStatus === 'Risque de congestion') {
                        newOccupancyRate = Math.max(60, Math.min(100, currentOccupancyRate + ((Math.random() - 0.5) * maxChange)));
                    } else {
                        newOccupancyRate = Math.max(100.1, currentOccupancyRate + ((Math.random() - 0.5) * maxChange));
                    }
                }

                // Appliquer l'impact du trafic
                newOccupancyRate = Math.min(150, newOccupancyRate + trafficImpact);

                // Calculer le nombre de véhicules
                segment.vehicles = Math.floor((newOccupancyRate / 100) * maxCapacity);

                // Mettre à jour le taux d'occupation et le statut
                const { occupancyRate, trafficStatus } = calculateTrafficStatus(segment);
                segment.occupancy_rate = occupancyRate;
                segment.traffic_status = trafficStatus;

                // Mettre à jour l'état pour le prochain segment
                previousTrafficStatus = trafficStatus;
            });

            // Recalculer les moyennes pour la sous-route
            const totalOccupancy = r.segments.reduce((sum, seg) => sum + parseFloat(seg.occupancy_rate), 0);
            const avgOccupancy = totalOccupancy / r.segments.length;
            r.avg_occupancy_rate = avgOccupancy.toFixed(2);
            r.traffic_status = avgOccupancy < 60 ? 'Congestion fluide' :
                              avgOccupancy <= 100 ? 'Risque de congestion' :
                              'Congestion, état bloqué';
        });

        // Recalculer la moyenne pour l'itinéraire global
        const totalAvgOccupancy = route.routes.reduce((sum, r) => sum + parseFloat(r.avg_occupancy_rate), 0) / route.routes.length;
        route.avg_occupancy = totalAvgOccupancy.toFixed(2);
    });
}

// API pour fournir les données de trafic
app.get('/traffic-data', async (req, res) => {
    try {
        res.json(trafficData);
    } catch (error) {
        res.status(500).json({ error: 'Erreur récupération données' });
    }
});

// API pour sauvegarder les nouvelles données (in-memory)
app.post('/save-traffic-data', async (req, res) => {
    try {
        trafficData = req.body;
        res.json({ message: 'Données sauvegardées avec succès (in memory)' });
    } catch (error) {
        console.error('Erreur sauvegarde:', error);
        res.status(500).json({ error: 'Erreur sauvegarde données' });
    }
});

// Mettre à jour les données toutes les 10 secondes
setInterval(updateTrafficData, 10000);

// Export pour Vercel
module.exports = app;