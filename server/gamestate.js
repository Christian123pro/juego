const fs = require('fs');
const path = require('path');

class GameManager {
    constructor() {
        this.rooms = new Map();
        this.io = null;
    }

    setIO(ioInstance) {
        this.io = ioInstance;
    }

    generateRoomCode() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let code = "";
        do {
            code = "";
            for (let i = 0; i < 4; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
        } while (this.rooms.has(code));
        return code;
    }

    createRoom(hostId, username) {
        const code = this.generateRoomCode();
        const room = {
            code,
            players: new Map(),
            state: "LOBBY",
            settings: {
                maxPlayers: 12,
                roundTime: 10,
                startingLives: 3
            },
            hostId: hostId,
        };

        this.addPlayerToRoom(room, hostId, username, true);
        this.rooms.set(code, room);
        return room;
    }

    updateSettings(code, settings) {
        const room = this.rooms.get(code);
        if (!room || room.state !== "LOBBY") return;

        if (settings.roundTime) room.settings.roundTime = parseInt(settings.roundTime) || 10;
        if (settings.startingLives) room.settings.startingLives = parseInt(settings.startingLives) || 3;
        if (settings.maxPlayers) room.settings.maxPlayers = parseInt(settings.maxPlayers) || 12;

        // Notify all in room
        if (this.io) {
            this.io.to(code).emit('SETTINGS_UPDATED', room.settings);
        }
    }

    joinRoom(code, playerId, username) {
        const room = this.rooms.get(code);
        if (!room) return { error: "Room not found" };
        if (room.state !== "LOBBY") return { error: "Game already in progress" };
        if (room.players.size >= room.settings.maxPlayers) return { error: "Room is full" };

        this.addPlayerToRoom(room, playerId, username, false);
        return { room };
    }

    kickPlayer(code, hostId, targetId) {
        const room = this.rooms.get(code);
        if (!room) return { error: "Room not found" };
        if (room.hostId !== hostId) return { error: "Only host can kick" };
        if (hostId === targetId) return { error: "Cannot kick yourself" };

        if (!room.players.has(targetId)) return { error: "Player not found" };

        room.players.delete(targetId);

        // Notify the kicked player specifically (optional, usually disconnect handles it but we want explicit)
        if (this.io) {
            const targetSocket = this.io.sockets.sockets.get(targetId);
            if (targetSocket) {
                targetSocket.leave(code);
                targetSocket.emit('KICKED', { message: "You have been kicked by the host." });
            }

            this.io.to(code).emit('ROOM_UPDATE', {
                players: Array.from(room.players.values()),
                hostId: room.hostId,
                settings: room.settings
            });
        }
        return { success: true };
    }

    addPlayerToRoom(room, playerId, username, isHost) {
        const player = {
            id: playerId,
            username,
            isHost,
            score: 0,
            lives: room.settings.startingLives,
            isAlive: true,
        };
        room.players.set(playerId, player);
    }

    removePlayer(socketId) {
        for (const [code, room] of this.rooms) {
            if (room.players.has(socketId)) {
                room.players.delete(socketId);

                if (room.players.size === 0) {
                    this.rooms.delete(code);
                } else if (room.hostId === socketId) {
                    const nextPlayerId = room.players.keys().next().value;
                    room.players.get(nextPlayerId).isHost = true;
                    room.hostId = nextPlayerId;
                    if (this.io) this.io.to(code).emit('NEW_HOST', { hostId: room.hostId });
                }
                return { roomCode: code, room };
            }
        }
        return null;
    }

    startGame(code) {
        const room = this.rooms.get(code);
        if (!room) return;

        room.state = "PLAYING";
        room.activePlayerIndex = 0;
        room.playersArray = Array.from(room.players.keys());
        room.usedWords = new Set();

        // Set lives for all players based on current settings
        for (let player of room.players.values()) {
            player.lives = room.settings.startingLives;
            player.isAlive = true;
        }

        this.startTurn(room);
    }

    startTurn(room) {
        if (room.timer) clearTimeout(room.timer);

        const constraints = [
            "A", "E", "I", "O", "U", "AR", "ER", "IR", "OR", "UR",
            "BL", "BR", "CL", "CR", "FL", "FR", "GL", "GR", "PL", "PR", "TR", "DR",
            "ION", "IA", "IO", "UE", "UO", "MB", "MP", "NV", "NF", "CH", "LL", "RR", "Ñ"
        ];
        room.constraint = constraints[Math.floor(Math.random() * constraints.length)];
        const activePlayerId = room.playersArray[room.activePlayerIndex];
        const player = room.players.get(activePlayerId);

        if (this.io) {
            this.io.to(room.code).emit('NEXT_TURN', {
                activePlayerId,
                constraint: room.constraint,
                timeLeft: room.settings.roundTime,
                playerLives: player.lives
            });
        }

        room.timer = setTimeout(() => {
            this.handleTurnTimeout(room);
        }, room.settings.roundTime * 1000 + 1000);
    }

    handleTurnTimeout(room) {
        const activePlayerId = room.playersArray[room.activePlayerIndex];
        const player = room.players.get(activePlayerId);
        if (!player) return;

        player.lives -= 1;

        // Trigger animation for life loss on client
        if (this.io) {
            this.io.to(room.code).emit('LIFE_LOST', { playerId: activePlayerId, lives: player.lives });
        }

        if (player.lives <= 0) {
            player.isAlive = false;
            const alivePlayers = room.playersArray.filter(pid => room.players.get(pid).isAlive);
            if (alivePlayers.length <= 1) {
                this.endGame(room, alivePlayers[0] || activePlayerId);
                return;
            }
        }

        this.nextPlayer(room);
    }

    nextPlayer(room) {
        let loop = 0;
        do {
            room.activePlayerIndex = (room.activePlayerIndex + 1) % room.playersArray.length;
            loop++;
        } while (!room.players.get(room.playersArray[room.activePlayerIndex]).isAlive && loop < room.playersArray.length);

        this.startTurn(room);
    }

    handleSubmission(code, playerId, word) {
        const room = this.rooms.get(code);
        if (!room || room.state !== "PLAYING") return { error: "Game not active" };

        const activePlayerId = room.playersArray[room.activePlayerIndex];
        if (playerId !== activePlayerId) return { error: "Not your turn" };

        word = word.toUpperCase().trim();
        if (room.usedWords.has(word)) return { isValid: false, reason: "Already used" };

        if (!word.includes(room.constraint)) return { isValid: false, reason: `Must contain ${room.constraint}` };

        const dictionary = require('./dictionary');
        if (!dictionary.isValid(word)) return { isValid: false, reason: "Not a word" };

        room.usedWords.add(word);
        this.nextPlayer(room);
        return { isValid: true };
    }

    endGame(room, winnerId) {
        if (room.timer) clearTimeout(room.timer);
        room.state = "ENDED";
        if (this.io) {
            this.io.to(room.code).emit('GAME_OVER', {
                winner: room.players.get(winnerId)?.username || "No one"
            });
        }

        setTimeout(() => {
            room.state = "LOBBY";
            room.usedWords = new Set();
            if (this.io) {
                this.io.to(room.code).emit('ROOM_UPDATE', {
                    players: Array.from(room.players.values()),
                    hostId: room.hostId,
                    settings: room.settings
                });
            }
        }, 5000);
    }
}

module.exports = new GameManager();
