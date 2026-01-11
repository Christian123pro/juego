const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameManager = require('./gamestate');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // In production you should set this to your GitHub Pages URL
        methods: ["GET", "POST"]
    }
});

// Set IO in gameManager to avoid circular dependency
gameManager.setIO(io);

const PORT = process.env.PORT || 3000;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('CREATE_ROOM', ({ username }) => {
        console.log(`Creating room for user: ${username}`);
        const room = gameManager.createRoom(socket.id, username);
        socket.join(room.code);
        socket.emit('ROOM_CREATED', { code: room.code });
        io.to(room.code).emit('ROOM_UPDATE', {
            players: Array.from(room.players.values()),
            hostId: room.hostId,
            settings: room.settings
        });
    });

    socket.on('JOIN_ROOM', ({ code, username }) => {
        console.log(`User ${username} joining room: ${code}`);
        const result = gameManager.joinRoom(code, socket.id, username);
        if (result.error) {
            console.error(`Join error: ${result.error}`);
            socket.emit('ERROR', { message: result.error });
            return;
        }
        socket.join(code);
        socket.emit('JOINED_ROOM', { code });
        io.to(code).emit('ROOM_UPDATE', {
            players: Array.from(result.room.players.values()),
            hostId: result.room.hostId,
            settings: result.room.settings
        });
    });

    socket.on('START_GAME', ({ code }) => {
        gameManager.startGame(code);
    });

    socket.on('UPDATE_SETTINGS', ({ code, settings }) => {
        gameManager.updateSettings(code, settings);
    });

    socket.on('SUBMIT_WORD', ({ code, word }) => {
        const result = gameManager.handleSubmission(code, socket.id, word);
        if (result.isValid) {
            socket.emit('WORD_ACCEPTED');
            io.to(code).emit('ANIMATION_EVENT', { type: 'SUCCESS', playerId: socket.id });
        } else {
            socket.emit('WORD_REJECTED', { reason: result.reason });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const result = gameManager.removePlayer(socket.id);
        if (result) {
            io.to(result.roomCode).emit('ROOM_UPDATE', {
                players: Array.from(result.room.players.values()),
                hostId: result.room.hostId
            });
        }
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
