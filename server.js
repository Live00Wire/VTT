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
        maxPlayers: max,
        rules: room.rules 
    };
}

function resetTurnTimer(roomId, io) {
    const room = rooms[roomId];
    if (!room || !room.isStarted || !room.gameInstance || room.gameInstance.winner || room.type !== 'uno') {
        if (room && room.turnTimer) {
            clearTimeout(room.turnTimer);
            room.turnTimer = null;
        }
        return;
    }

    if (room.turnTimer) clearTimeout(room.turnTimer);

    room.turnTimer = setTimeout(() => {
        const game = room.gameInstance;
        if (!game) return;
        
        const currentPlayerId = game.players[game.turnIndex];
        const isValidMove = game.makeMove(currentPlayerId, { action: 'timeout' });
        
        if (isValidMove) {
            if (game.winner) {
                io.to(roomId).emit('gameOver', { board: game.board, winner: game.winner, names: room.nameMap });
                room.rematchRequests = [];
                clearTimeout(room.turnTimer);
                room.turnTimer = null;
            } else {
                room.players.forEach(pId => {
                    io.to(pId).emit('updateSecretBoard', game.getGameStateForPlayer(pId));
                });
                resetTurnTimer(roomId, io);
            }
        }
    }, 15000);
}

function startGameInstance(room, roomId, io) {
    const GameClass = GameConfig[room.type].class;
    room.gameInstance = new GameClass(room.players, room.rules);
    
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
        io.to(roomId).emit('gameStart', { board: room.gameInstance.board, turn: room.gameInstance.turn, symbols: room.gameInstance.symbols, names: room.nameMap });
    }
    
    if (room.type === 'uno') resetTurnTimer(roomId, io);
}

io.on('connection', (socket) => {

    socket.on('joinLobby', (username) => {
        socket.username = username;
        socket.join('lobby');
        io.to('lobby').emit('systemMessage', `${username} has entered the tavern.`);
    });

    socket.on('sendLobbyChat', (message) => {
        if (socket.username) io.to('lobby').emit('chatMessage', { user: socket.username, text: message });
    });

    socket.on('sendRoomChat', (message) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const senderName = rooms[roomId].usernames[socket.id] || socket.username || 'Player';
            io.to(roomId).emit('roomChatMessage', { user: senderName, text: message });
        }
    });

    socket.on('checkRoom', (code) => {
        code = code.toUpperCase();
        const room = rooms[code];
        if (room && !room.isStarted && room.isPrivate) {
            if (room.players.length < GameConfig[room.type].maxPlayers) {
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
        const sessionId = data.sessionId;

        socket.username = username;
        socket.sessionId = sessionId;

        for (const rId in rooms) {
            const room = rooms[rId];
            if (room.isStarted && room.disconnected && room.disconnected[sessionId]) {
                const oldSocketId = room.disconnected[sessionId].socketId;
                clearTimeout(room.disconnected[sessionId].timeout);
                delete room.disconnected[sessionId];

                const pIndex = room.players.indexOf(oldSocketId);
                if (pIndex !== -1) room.players[pIndex] = socket.id;
                
                room.usernames[socket.id] = room.usernames[oldSocketId];
                delete room.usernames[oldSocketId];
                
                if (room.host === oldSocketId) room.host = socket.id;

                const rIndex = room.rematchRequests.indexOf(oldSocketId);
                if (rIndex !== -1) room.rematchRequests[rIndex] = socket.id;
                
                room.restartVotes = [];

                socket.join(rId);
                socket.roomId = rId;

                if (room.gameInstance && typeof room.gameInstance.updatePlayerId === 'function') {
                    room.gameInstance.updatePlayerId(oldSocketId, socket.id);
                    
                    socket.emit('secretGameStart', { state: room.gameInstance.getGameStateForPlayer(socket.id), names: room.nameMap });
                    io.to(rId).emit('playerReconnected', room.usernames[socket.id]);
                    
                    room.players.forEach(pId => {
                        io.to(pId).emit('updateSecretBoard', room.gameInstance.getGameStateForPlayer(pId));
                    });

                    resetTurnTimer(rId, io);
                }
                return; 
            }
        }

        const config = GameConfig[gameType];
        const maxPlayers = config.maxPlayers;
        const isManualStart = config.manualStart;
        const defaultRules = { playDrawn: true, drawUntilPlay: false, stacking: false, jumpIn: false, zeroPass: false };

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
                        room.isStarted = true; startGameInstance(room, joinCode, io);
                    } else {
                        socket.emit('waitingForOpponent', joinCode);
                    }
                }
            } else { socket.emit('opponentLeft'); }
            return;
        } 
        else if (isCreatingPrivate) {
            const newCode = generateRoomCode();
            socket.join(newCode);
            socket.roomId = newCode;
            rooms[newCode] = {
                type: gameType, players: [socket.id], usernames: { [socket.id]: username },
                gameInstance: null, isPrivate: true, isStarted: false, host: socket.id, rematchRequests: [],
                rules: defaultRules, turnTimer: null, disconnected: {}, restartVotes: []
            };

            if (isManualStart) socket.emit('lobbyUpdate', getLobbyState(rooms[newCode], newCode, maxPlayers));
            else socket.emit('waitingForOpponent', newCode);
            return; 
        } 
        else {
            let roomToJoin = null;
            for (const roomId in rooms) {
                if (rooms[roomId].type === gameType && rooms[roomId].players.length < maxPlayers && !rooms[roomId].isPrivate && !rooms[roomId].isStarted) {
                    roomToJoin = roomId; break;
                }
            }

            if (roomToJoin) {
                const room = rooms[roomToJoin];
                room.players.push(socket.id); room.usernames[socket.id] = username;
                socket.join(roomToJoin); socket.roomId = roomToJoin; 

                if (isManualStart) {
                    io.to(roomToJoin).emit('lobbyUpdate', getLobbyState(room, null, maxPlayers));
                } else {
                    if (room.players.length === maxPlayers) {
                        room.isStarted = true; startGameInstance(room, roomToJoin, io);
                    } else { socket.emit('waitingForOpponent', null); }
                }
            } else {
                const newRoomId = 'room_' + socket.id;
                socket.join(newRoomId); socket.roomId = newRoomId;
                rooms[newRoomId] = {
                    type: gameType, players: [socket.id], usernames: { [socket.id]: username },
                    gameInstance: null, isPrivate: false, isStarted: false, host: socket.id, rematchRequests: [],
                    rules: defaultRules, turnTimer: null, disconnected: {}, restartVotes: []
                };

                if (isManualStart) socket.emit('lobbyUpdate', getLobbyState(rooms[newRoomId], null, maxPlayers));
                else socket.emit('waitingForOpponent', null); 
            }
        }
    });

    socket.on('updateRules', (rules) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId] && rooms[roomId].host === socket.id && !rooms[roomId].isStarted) {
            rooms[roomId].rules = rules;
            socket.to(roomId).emit('rulesUpdated', rules);
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
            if (moveData.action === 'call_uno') socket.to(roomId).emit('playerCalledUno');

            if (game.winner) {
                io.to(roomId).emit('gameOver', { board: game.board, winner: game.winner, names: rooms[roomId].nameMap });
                rooms[roomId].rematchRequests = []; 
                if (rooms[roomId].turnTimer) {
                    clearTimeout(rooms[roomId].turnTimer);
                    rooms[roomId].turnTimer = null;
                }
            } else {
                if (typeof game.getGameStateForPlayer === 'function') {
                    rooms[roomId].players.forEach(playerId => {
                        io.to(playerId).emit('updateSecretBoard', game.getGameStateForPlayer(playerId));
                    });
                } else {
                    io.to(roomId).emit('updateBoard', { board: game.board, turn: game.turn });
                }
                if (rooms[roomId].type === 'uno') resetTurnTimer(roomId, io);
            }
        }
    });

    socket.on('requestRematch', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        if (!room.rematchRequests.includes(socket.id)) {
            room.rematchRequests.push(socket.id);
        }

        if (room.rematchRequests.length === room.players.length) {
            room.rematchRequests = []; 
            startGameInstance(room, roomId, io);
        } else {
            io.to(roomId).emit('rematchUpdate', {
                current: room.rematchRequests.length,
                total: room.players.length
            });
        }
    });

    socket.on('voteRestartLobby', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (!room.restartVotes) room.restartVotes = [];
        if (!room.restartVotes.includes(socket.id)) {
            room.restartVotes.push(socket.id);
        }

        const activePlayers = room.players.filter(pId => {
            return !Object.values(room.disconnected || {}).some(d => d.socketId === pId);
        });

        if (activePlayers.length > 0 && room.restartVotes.length >= activePlayers.length) {
            if (room.turnTimer) {
                clearTimeout(room.turnTimer);
                room.turnTimer = null;
            }
            if (room.disconnected) {
                Object.values(room.disconnected).forEach(d => clearTimeout(d.timeout));
            }
            
            room.players = activePlayers;
            if (!activePlayers.includes(room.host)) room.host = activePlayers[0];
            
            room.disconnected = {};
            room.restartVotes = [];
            room.isStarted = false;
            room.gameInstance = null;
            
            io.to(roomId).emit('lobbyUpdate', getLobbyState(room, roomId, GameConfig[room.type].maxPlayers));
        } else {
            io.to(roomId).emit('restartVoteUpdate', { current: room.restartVotes.length, total: activePlayers.length });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) io.to('lobby').emit('systemMessage', `${socket.username} left the tavern.`);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (room.isStarted && room.type === 'uno') {
                if (!room.disconnected) room.disconnected = {};
                
                io.to(roomId).emit('playerDisconnectWarning', room.usernames[socket.id]);
                
                if (room.turnTimer) {
                    clearTimeout(room.turnTimer);
                    room.turnTimer = null;
                }

                room.disconnected[socket.sessionId] = {
                    socketId: socket.id,
                    timeout: setTimeout(() => {
                        io.to(roomId).emit('opponentLeft');
                        if (room.turnTimer) clearTimeout(room.turnTimer);
                        delete rooms[roomId];
                    }, 20000) 
                };
                room.restartVotes = [];
            } else {
                if (room.turnTimer) {
                    clearTimeout(room.turnTimer);
                    room.turnTimer = null;
                }
                if (!room.isStarted && room.isPrivate && GameConfig[room.type].manualStart) {
                    room.players = room.players.filter(id => id !== socket.id);
                    if (room.host === socket.id || room.players.length === 0) {
                        socket.to(roomId).emit('opponentLeft'); delete rooms[roomId];
                    } else {
                        io.to(roomId).emit('lobbyUpdate', getLobbyState(room, roomId, GameConfig[room.type].maxPlayers));
                    }
                } else {
                    socket.to(roomId).emit('opponentLeft'); delete rooms[roomId];
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });