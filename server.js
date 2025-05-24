const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Route pour servir index.html à la racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let trafficData;

async function loadTrafficData() {
    try {
        const rawData = await fs.readFile('traffic-data.json', 'utf8');
        trafficData = JSON.parse(rawData);
        console.log('Données chargées avec succès');
    } catch (error) {
        console.error('Erreur chargement traffic-data.json:', error);
        trafficData = { locations: {}, routes: [] };
    }
}

function calculateTrafficStatus(segment) {
    const capacity = segment.capacity_per_lane * segment.lanes;
    const occupancyRate = (segment.vehicles / capacity) * 100;
    let trafficStatus;
    if (occupancyRate < 60) trafficStatus = 'Fluide';
    else if (occupancyRate <= 100) trafficStatus = 'Moyen';
    else trafficStatus = 'Bloqué';
    return { occupancyRate: occupancyRate.toFixed(2), trafficStatus };
}

function updateTrafficData() {
    if (!Array.isArray(trafficData.routes) || trafficData.routes.length === 0) {
        return;
    }

    trafficData.routes.forEach(route => {
        route.routes.forEach(r => {
            let previousTrafficStatus = 'Fluide';

            r.segments.forEach((segment, index) => {
                const maxCapacity = segment.capacity_per_lane * segment.lanes;

                segment.traffic_conditions.road_work = Math.random() < 0.1;
                segment.traffic_conditions.accidents = Math.random() < 0.05;
                segment.traffic_conditions.traffic_lights = Math.floor(Math.random() * 3);
                segment.traffic_conditions.intersections = Math.floor(Math.random() * 2);

                let trafficImpact = 0;
                trafficImpact += segment.traffic_conditions.traffic_lights * 2;
                trafficImpact += segment.traffic_conditions.intersections * 5;
                if (segment.traffic_conditions.road_work) trafficImpact += 10;
                if (segment.traffic_conditions.accidents) trafficImpact += 15;

                let currentOccupancyRate = parseFloat(segment.occupancy_rate) || 50;

                const maxChange = 15;
                let newOccupancyRate;

                const currentStatus = segment.traffic_status || previousTrafficStatus;
                const willDegrade = Math.random() < 0.5;

                if (willDegrade) {
                    if (currentStatus === 'Fluide') {
                        newOccupancyRate = Math.min(100, currentOccupancyRate + (Math.random() * maxChange) + trafficImpact);
                    } else if (currentStatus === 'Moyen') {
                        newOccupancyRate = Math.min(150, currentOccupancyRate + (Math.random() * maxChange) + trafficImpact);
                    } else {
                        newOccupancyRate = Math.max(60, currentOccupancyRate + ((Math.random() - 0.5) * maxChange) + trafficImpact);
                    }
                } else {
                    if (currentStatus === 'Bloqué') {
                        newOccupancyRate = Math.max(60, currentOccupancyRate - (Math.random() * maxChange));
                    } else if (currentStatus === 'Moyen') {
                        newOccupancyRate = Math.max(0, currentOccupancyRate - (Math.random() * maxChange));
                    } else {
                        newOccupancyRate = Math.min(100, currentOccupancyRate + ((Math.random() - 0.5) * maxChange));
                    }
                }

                newOccupancyRate = Math.max(0, Math.min(150, newOccupancyRate));

                segment.vehicles = Math.floor((newOccupancyRate / 100) * maxCapacity);

                const { occupancyRate, trafficStatus } = calculateTrafficStatus(segment);
                segment.occupancy_rate = occupancyRate;
                segment.traffic_status = trafficStatus;

                previousTrafficStatus = trafficStatus;
            });

            const totalOccupancy = r.segments.reduce((sum, seg) => sum + parseFloat(seg.occupancy_rate), 0);
            const avgOccupancy = totalOccupancy / r.segments.length;
            r.avg_occupancy_rate = avgOccupancy.toFixed(2);
            r.traffic_status = avgOccupancy < 60 ? 'Fluide' :
                              avgOccupancy <= 100 ? 'Moyen' :
                              'Bloqué';
        });

        const totalAvgOccupancy = route.routes.reduce((sum, r) => sum + parseFloat(r.avg_occupancy_rate), 0) / route.routes.length;
        route.avg_occupancy = totalAvgOccupancy.toFixed(2);
    });

    // Remove the file write operation since Vercel doesn't support it
    // try {
    //     fs.writeFile('traffic-data.json', JSON.stringify(trafficData, null, 2), 'utf8');
    // } catch (error) {
    //     console.error('Erreur écriture fichier JSON:', error);
    // }
}

app.get('/traffic-data', async (req, res) => {
    try {
        res.json(trafficData);
    } catch (error) {
        res.status(500).json({ error: 'Erreur récupération données' });
    }
});

app.post('/save-traffic-data', async (req, res) => {
    try {
        trafficData = req.body;
        // Remove file write operation
        // await fs.writeFile('traffic-data.json', JSON.stringify(trafficData, null, 2), 'utf8');
        res.json({ message: 'Données sauvegardées avec succès (in memory)' });
    } catch (error) {
        console.error('Erreur sauvegarde:', error);
        res.status(500).json({ error: 'Erreur sauvegarde données' });
    }
});

async function startServer() {
    await loadTrafficData();
    setInterval(updateTrafficData, 10000);
}

startServer().catch(error => {
    console.error('Erreur démarrage serveur:', error);
});

// Export pour Vercel
module.exports = app;