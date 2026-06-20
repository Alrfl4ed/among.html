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
const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Server performance matching engine active on port ${PORT}`);
});