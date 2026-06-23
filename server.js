const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function getRoomList() {
    return Object.keys(rooms).map(roomId => ({
        id: roomId,
        name: rooms[roomId].name,
        players: rooms[roomId].players.length,
        maxPlayers: rooms[roomId].maxPlayers,
        status: rooms[roomId].status
    }));
}

io.on('connection', (socket) => {
    let currentRoomId = null;
    let playerId = socket.id;

    socket.emit('roomList', getRoomList());

    socket.on('requestRoomList', () => {
        socket.emit('roomList', getRoomList());
    });

    socket.on('createRoom', (data) => {
        const roomId = data.roomId || Math.random().toString(36).substring(2, 7).toUpperCase();
        rooms[roomId] = {
            id: roomId,
            name: data.roomName || `${data.playerName}'s Lobby`,
            maxPlayers: data.maxPlayers || 10,
            status: 'lobby',
            hostId: playerId,
            players: [],
            settings: {
                crewmateVis: data.crewmateVis || 5,
                impVis: data.impVis || 15
            },
            sabotages: {
                lights: { active: false, bulbs: [false, false, false] }
            }
        };
        socket.emit('roomCreated', roomId);
        io.emit('roomList', getRoomList());
    });

    socket.on('joinRoom', (data) => {
        const { roomId, playerName, color, cosmetic } = data;
        const room = rooms[roomId];

        if (!room) {
            socket.emit('joinError', 'Room not found.');
            return;
        }
        if (room.status !== 'lobby' && room.status !== 'ended') {
            socket.emit('joinError', 'Game has already started.');
            return;
        }
        if (room.players.length >= room.maxPlayers) {
            socket.emit('joinError', 'Room is full.');
            return;
        }

        currentRoomId = roomId;
        socket.join(roomId);

        const newPlayer = {
            id: playerId,
            name: playerName,
            color: color || '#ffffff',
            cosmetic: cosmetic || 'none',
            x: 0, y: 0, z: 0,
            role: 'crewmate',
            isAlive: true
        };

        room.players.push(newPlayer);

        socket.emit('joinSuccess', { 
            roomId, 
            players: room.players, 
            hostId: room.hostId,
            settings: room.settings 
        });
        socket.to(roomId).emit('playerJoined', newPlayer);
        io.emit('roomList', getRoomList());
    });

    socket.on('updatePlayerProfile', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const player = room.players.find(p => p.id === playerId);
        if (player) {
            player.color = data.color || player.color;
            player.cosmetic = data.cosmetic || player.cosmetic;
            player.name = data.name || player.name;
            io.to(currentRoomId).emit('playerProfileUpdated', player);
        }
    });

    socket.on('updateSettings', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        if (room.hostId !== playerId) return;

        room.settings.crewmateVis = data.crewmateVis ?? room.settings.crewmateVis;
        room.settings.impVis = data.impVis ?? room.settings.impVis;
        
        io.to(currentRoomId).emit('settingsUpdated', room.settings);
    });

    socket.on('sendChatMessage', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const player = room.players.find(p => p.id === playerId);
        if (player) {
            io.to(currentRoomId).emit('chatMessageReceived', {
                senderId: playerId,
                senderName: player.name,
                text: data.text
            });
        }
    });

    socket.on('startMatch', () => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        if (room.hostId !== playerId) return;

        room.status = 'playing';
        room.sabotages.lights = { active: false, bulbs: [false, false, false] };

        if (room.players.length > 0) {
            const imposterIndex = Math.floor(Math.random() * room.players.length);
            room.players.forEach((player, index) => {
                player.role = (index === imposterIndex) ? 'imposter' : 'crewmate';
                player.isAlive = true;
            });
        }

        io.to(currentRoomId).emit('matchStarted', room.players);
        io.emit('roomList', getRoomList());
    });

    socket.on('endMatch', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        room.status = 'lobby';
        io.to(currentRoomId).emit('matchEnded', { winner: data.winner, players: room.players });
        io.emit('roomList', getRoomList());
    });

    socket.on('triggerSabotage', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        if (data.type === 'lights') {
            room.sabotages.lights.active = true;
            room.sabotages.lights.bulbs = [false, false, false];
            io.to(currentRoomId).emit('sabotageTriggered', { type: 'lights', bulbs: room.sabotages.lights.bulbs });
        }
    });

    socket.on('fixLightBulb', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        if (!room.sabotages.lights.active) return;

        const index = data.index;
        if (index >= 0 && index < 3) {
            room.sabotages.lights.bulbs[index] = data.state;
            io.to(currentRoomId).emit('lightsStateUpdated', { bulbs: room.sabotages.lights.bulbs });

            if (room.sabotages.lights.bulbs.every(b => b === true)) {
                room.sabotages.lights.active = false;
                io.to(currentRoomId).emit('sabotageFixed', { type: 'lights' });
            }
        }
    });

    socket.on('syncPosition', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const player = room.players.find(p => p.id === playerId);
        if (player) {
            player.x = data.x;
            player.y = data.y;
            player.z = data.z;
            socket.to(currentRoomId).emit('positionUpdated', { id: playerId, x: data.x, y: data.y, z: data.z });
        }
    });

    socket.on('callMeeting', (data) => {
        if (!currentRoomId) return;
        io.to(currentRoomId).emit('meetingCalled', { callerId: playerId, bodyFound: data?.bodyFound || false });
    });

    socket.on('submitVote', (data) => {
        if (!currentRoomId) return;
        io.to(currentRoomId).emit('voteRegistered', { voterId: playerId, targetId: data.targetId });
    });

    socket.on('killPlayer', (data) => {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        const target = room.players.find(p => p.id === data.targetId);
        if (target) {
            target.isAlive = false;
            io.to(currentRoomId).emit('playerKilled', data.targetId);
        }
    });

    socket.on('taskCompleted', (data) => {
        if (!currentRoomId) return;
        io.to(currentRoomId).emit('taskProgressUpdated', data);
    });

    socket.on('leaveRoom', () => {
        handleUserLeave();
    });

    socket.on('disconnect', () => {
        handleUserLeave();
    });

    function handleUserLeave() {
        if (!currentRoomId || !rooms[currentRoomId]) return;
        const room = rooms[currentRoomId];
        room.players = room.players.filter(p => p.id !== playerId);
        socket.to(currentRoomId).emit('playerLeft', playerId);

        if (room.players.length === 0) {
            delete rooms[currentRoomId];
        } else if (room.hostId === playerId) {
            const randomPlayer = room.players[Math.floor(Math.random() * room.players.length)];
            room.hostId = randomPlayer.id;
            io.to(currentRoomId).emit('hostChanged', { hostId: room.hostId });
        }

        currentRoomId = null;
        io.emit('roomList', getRoomList());
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
