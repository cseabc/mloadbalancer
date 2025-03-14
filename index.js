const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
const PORT = process.env.LB_PORT || 3000;

app.use(cors());
app.use(express.json());

// Load backend URLs from environment variable (comma-separated)
let backends = [];
if (process.env.BACKEND_URLS) {
    backends = process.env.BACKEND_URLS.split(',').map(url => ({
        url: url.trim(),
        healthy: true,
        activeConnections: 0,
        totalRequests: 0
    }));
} else {
    console.error('No backend URLs provided in BACKEND_URLS');
    process.exit(1);
}

// Health check: ping each backend's /health endpoint
const performHealthCheck = async () => {
    for (let backend of backends) {
        try {
            const response = await axios.get(`${backend.url}/health`, { timeout: 5000 });
            // Accept both "ok" and "UP" as healthy statuses
            backend.healthy = response.data && (response.data.status === 'ok' || response.data.status === 'UP');
        } catch (error) {
            console.error(`Health check failed for ${backend.url}:`, error.message);
            backend.healthy = false;
        }
    }
};

// Run health check every 10 seconds
setInterval(performHealthCheck, 10000);
performHealthCheck();

// Basic round-robin load balancing
let currentIndex = 0;
const selectBackend = () => {
    const healthyBackends = backends.filter(b => b.healthy);
    if (healthyBackends.length === 0) return null;
    const backend = healthyBackends[currentIndex % healthyBackends.length];
    currentIndex++;
    return backend;
};

app.all('*', async (req, res) => {
    const backend = selectBackend();
    if (!backend) {
        return res.status(503).json({ message: 'No healthy backend available' });
    }
    const targetUrl = backend.url + req.originalUrl;
    backend.activeConnections++;
    backend.totalRequests++;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: req.headers,
            data: req.body,
            params: req.query,
            timeout: 10000
        });
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('Error forwarding request:', error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ message: 'Error forwarding request' });
        }
    } finally {
        backend.activeConnections--;
    }
});

app.listen(PORT, () => {
    console.log(`Load Balancer running on port ${PORT}`);
});
