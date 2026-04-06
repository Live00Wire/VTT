const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const TicTacToe = require('./gameLogic/TicTacToe');
const ConnectFour = require('./gameLogic/ConnectFour');
const Uno = require('./gameLogic/Uno');

const GameConfig = { 
    'ttt': { class: TicTacToe, maxPlayers: 2, manualStart: false }, 
    'c4': { class: ConnectFour, maxPlayers: 2, manualStart: false },
    'uno': { class: Uno, maxPlayers: 4, manualStart: true } 
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getLobbyState(room, code, max) {
    return {
        code: code,
        players: room.players.map(id => ({ id: id, name: room.usernames[id] })),
        hostId: room.host,
        maxPlayers: max
    };
}

function startGameInstance(room, roomId, io) {
    const GameClass = GameConfig[room.type].class;
    room.gameInstance = new GameClass(room.players);
    
    const nameMap = {};
    room.players.forEach(id => {
        const symbol = room.gameInstance.symbols[id];
        nameMap[symbol] = room.usernames[id];
    });
    room.nameMap = nameMap;

    if (typeof room.gameInstance.getGameStateForPlayer === 'function') {
        room.players.forEach(playerId => {
            io.to(playerId).emit('secretGameStart', {
                state: room.gameInstance.getGameStateForPlayer(playerId),
                names: room.nameMap
            });
        });
    } else {
        io.to(roomId).emit('gameStart', {
            board: room.gameInstance.board,
            turn: room.gameInstance.turn,
            symbols: room.gameInstance.symbols,
            names: room.nameMap
        });
    }
    console.log(`⚔️ Match started in room ${roomId}`);
}

io.on('connection', (socket) => {
    console.log('🟢 Player connected:', socket.id);

    socket.on('joinLobby', (username) => {
        socket.username = username;
        socket.join('lobby');
        io.to('lobby').emit('systemMessage', `👋 ${username} has entered the tavern.`);
    });

    socket.on('sendLobbyChat', (message) => {
        if (socket.username) {
            io.to('lobby').emit('chatMessage', { user: socket.username, text: message });
        }
    });

    socket.on('checkRoom', (code) => {
        code = code.toUpperCase();
        const room = rooms[code];
        if (room && !room.isStarted && room.isPrivate) {
            const config = GameConfig[room.type];
            if (room.players.length < config.maxPlayers) {
                socket.emit('roomFound', { type: room.type, code: code });
                return;
            }
        }
        socket.emit('roomError', 'Invalid code or room is full.');
    });

    socket.on('joinGame', (data) => {
        const gameType = data.type;
        const username = data.username || 'Guest';
        const isCreatingPrivate = data.private; 
        const joinCode = data.roomCode; 

        const config = GameConfig[gameType];
        const maxPlayers = config.maxPlayers;
        const isManualStart = config.manualStart;

        if (joinCode) {
            const room = rooms[joinCode];
            if (room && !room.isStarted && room.players.length < maxPlayers && room.isPrivate) {
                room.players.push(socket.id);
                room.usernames[socket.id] = username;
                socket.join(joinCode);
                socket.roomId = joinCode;

                if (isManualStart) {
                    io.to(joinCode).emit('lobbyUpdate', getLobbyState(room, joinCode, maxPlayers));
                } else {
                    if (room.players.length === maxPlayers) {
                        room.isStarted = true;
                        startGameInstance(room, joinCode, io);
                    } else {
                        socket.emit('waitingForOpponent', joinCode);
                    }
                }
            } else {
                socket.emit('opponentLeft'); 
            }
            return;
        } 
        else if (isCreatingPrivate) {
            const newCode = generateRoomCode();
            socket.join(newCode);
            socket.roomId = newCode;
            rooms[newCode] = {
                type: gameType,
                players: [socket.id],
                usernames: { [socket.id]: username },
                gameInstance: null,
                isPrivate: true,
                isStarted: false,
                host: socket.id, 
                rematchRequests: []
            };

            if (isManualStart) {
                socket.emit('lobbyUpdate', getLobbyState(rooms[newCode], newCode, maxPlayers));
            } else {
                socket.emit('waitingForOpponent', newCode);
            }
            return; 
        } 
        else {
            let roomToJoin = null;
            for (const roomId in rooms) {
                if (rooms[roomId].type === gameType && rooms[roomId].players.length < maxPlayers && !rooms[roomId].isPrivate && !rooms[roomId].isStarted) {
                    roomToJoin = roomId;
                    break;
                }
            }

            if (roomToJoin) {
                const room = rooms[roomToJoin];
                room.players.push(socket.id);
                room.usernames[socket.id] = username;
                socket.join(roomToJoin);
                socket.roomId = roomToJoin; 

                if (isManualStart) {
                    io.to(roomToJoin).emit('lobbyUpdate', getLobbyState(room, null, maxPlayers));
                } else {
                    if (room.players.length === maxPlayers) {
                        room.isStarted = true;
                        startGameInstance(room, roomToJoin, io);
                    } else {
                        socket.emit('waitingForOpponent', null);
                    }
                }
            } else {
                const newRoomId = 'room_' + socket.id;
                socket.join(newRoomId);
                socket.roomId = newRoomId;
                rooms[newRoomId] = {
                    type: gameType,
                    players: [socket.id],
                    usernames: { [socket.id]: username },
                    gameInstance: null,
                    isPrivate: false,
                    isStarted: false,
                    host: socket.id,
                    rematchRequests: []
                };

                if (isManualStart) {
                    socket.emit('lobbyUpdate', getLobbyState(rooms[newRoomId], null, maxPlayers));
                } else {
                    socket.emit('waitingForOpponent', null); 
                }
            }
        }
    });

    socket.on('hostStartGame', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.host === socket.id && room.players.length >= 2 && !room.isStarted) {
            room.isStarted = true;
            startGameInstance(room, roomId, io);
        }
    });

    socket.on('makeMove', (moveData) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId] || !rooms[roomId].gameInstance) return;

        const game = rooms[roomId].gameInstance;
        const isValidMove = game.makeMove(socket.id, moveData);

        if (isValidMove) {
            // Trigger the global UNO sound effect for everyone else
            if (moveData.action === 'call_uno') {
                socket.to(roomId).emit('playerCalledUno');
            }

            if (game.winner) {
                io.to(roomId).emit('gameOver', { board: game.board, winner: game.winner, names: rooms[roomId].nameMap });
                rooms[roomId].rematchRequests = []; 
            } else {
                if (typeof game.getGameStateForPlayer === 'function') {
                    rooms[roomId].players.forEach(playerId => {
                        io.to(playerId).emit('updateSecretBoard', game.getGameStateForPlayer(playerId));
                    });
                } else {
                    io.to(roomId).emit('updateBoard', { board: game.board, turn: game.turn });
                }
            }
        }
    });

    socket.on('requestRematch', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (!room.rematchRequests.includes(socket.id)) room.rematchRequests.push(socket.id);

        if (room.rematchRequests.length === room.players.length) {
            room.rematchRequests = []; 
            startGameInstance(room, roomId, io);
        } else {
            socket.to(roomId).emit('rematchProposed');
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            io.to('lobby').emit('systemMessage', `🚪 ${socket.username} left the tavern.`);
        }
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            if (!rooms[roomId].isStarted && rooms[roomId].isPrivate && GameConfig[rooms[roomId].type].manualStart) {
                rooms[roomId].players = rooms[roomId].players.filter(id => id !== socket.id);
                if (rooms[roomId].host === socket.id || rooms[roomId].players.length === 0) {
                    socket.to(roomId).emit('opponentLeft');
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('lobbyUpdate', getLobbyState(rooms[roomId], roomId, GameConfig[rooms[roomId].type].maxPlayers));
                }
            } else {
                socket.to(roomId).emit('opponentLeft');
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`🚀 Server running on port ${PORT}`); });