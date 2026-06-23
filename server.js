const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const lobbies = {};

io.on('connection', (socket) => {
    let currentRoom = null;
    let playerId = socket.id;

    socket.on('joinLobby', ({ roomId, name, color, cosmetic }) => {
        if (!lobbies[roomId]) {
            lobbies[roomId] = {
                id: roomId,
                host: playerId,
                players: {},
                settings: {
                    crewmateVis: 1.0,
                    imposterVis: 1.5
                },
                gameStarted: false,
                lightsSabotaged: false
            };
        }

        currentRoom = roomId;
        socket.join(roomId);

        lobbies[roomId].players[playerId] = {
            id: playerId,
            name: name || 'Player',
            color: color || '#ffffff',
            cosmetic: cosmetic || 'none',
            isHost: lobbies[roomId].host === playerId,
            x: 0,
            y: 0,
            isImposter: false,
            isDead: false
        };

        io.to(roomId).emit('lobbyUpdate', {
            players: Object.values(lobbies[roomId].players),
            settings: lobbies[roomId].settings,
            gameStarted: lobbies[roomId].gameStarted
        });
    });

    socket.on('updateSettings', (newSettings) => {
        if (currentRoom && lobbies[currentRoom] && lobbies[currentRoom].host === playerId) {
            lobbies[currentRoom].settings = { ...lobbies[currentRoom].settings, ...newSettings };
            io.to(currentRoom).emit('settingsUpdated', lobbies[currentRoom].settings);
        }
    });

    socket.on('lobbyChat', (msg) => {
        if (currentRoom && lobbies[currentRoom]) {
            const player = lobbies[currentRoom].players[playerId];
            if (player) {
                io.to(currentRoom).emit('lobbyMessage', {
                    sender: player.name,
                    text: msg
                });
            }
        }
    });

    socket.on('playerMove', (data) => {
        if (currentRoom && lobbies[currentRoom] && lobbies[currentRoom].players[playerId]) {
            lobbies[currentRoom].players[playerId].x = data.x;
            lobbies[currentRoom].players[playerId].y = data.y;
            socket.to(currentRoom).emit('playerMoved', { id: playerId, x: data.x, y: data.y });
        }
    });

    socket.on('sabotageLights', () => {
        if (currentRoom && lobbies[currentRoom]) {
            lobbies[currentRoom].lightsSabotaged = true;
            io.to(currentRoom).emit('lightsStatus', { broken: true });
        }
    });

    socket.on('fixLights', () => {
        if (currentRoom && lobbies[currentRoom]) {
            lobbies[currentRoom].lightsSabotaged = false;
            io.to(currentRoom).emit('lightsStatus', { broken: false });
        }
    });

    socket.on('endGame', () => {
        if (currentRoom && lobbies[currentRoom]) {
            lobbies[currentRoom].gameStarted = false;
            lobbies[currentRoom].lightsSabotaged = false;
            for (let id in lobbies[currentRoom].players) {
                lobbies[currentRoom].players[id].isImposter = false;
                lobbies[currentRoom].players[id].isDead = false;
            }
            io.to(currentRoom).emit('gameEnded', {
                players: Object.values(lobbies[currentRoom].players),
                settings: lobbies[currentRoom].settings
            });
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && lobbies[currentRoom]) {
            delete lobbies[currentRoom].players[playerId];
            
            if (Object.keys(lobbies[currentRoom].players).length === 0) {
                delete lobbies[currentRoom];
            } else {
                if (lobbies[currentRoom].host === playerId) {
                    const playerIds = Object.keys(lobbies[currentRoom].players);
                    const newHostId = playerIds[Math.floor(Math.random() * playerIds.length)];
                    lobbies[currentRoom].host = newHostId;
                    lobbies[currentRoom].players[newHostId].isHost = true;
                }
                io.to(currentRoom).emit('lobbyUpdate', {
                    players: Object.values(lobbies[currentRoom].players),
                    settings: lobbies[currentRoom].settings,
                    gameStarted: lobbies[currentRoom].gameStarted
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {});
