const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Use the port provided by the hosting platform, or default to 3000 locally
// Serve the index.html file
const path = require('path');
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve your other files (like css/js if they are in folders)
app.use(express.static(__dirname));

// Start the server
http.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
