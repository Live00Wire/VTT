const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const TicTacToe = require('./gameLogic/TicTacToe');
const ConnectFour = require('./gameLogic/ConnectFour');
const Uno = require('./gameLogic/Uno');

const GameRegistry = { 
    'ttt': TicTacToe, 
    'c4': ConnectFour,
    'uno': Uno
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('🟢 Player connected:', socket.id);

    // --- LOBBY & CHAT LOGIC ---
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
        if (room && room.players.length === 1 && room.isPrivate) {
            socket.emit('roomFound', { type: room.type, code: code });
        } else {
            socket.emit('roomError', 'Invalid code or room is full.');
        }
    });

    // --- GAMEPLAY LOGIC ---
    socket.on('joinGame', (data) => {
        const gameType = data.type;
        const username = data.username || 'Guest';
        const isCreatingPrivate = data.private; 
        const joinCode = data.roomCode; 

        let roomToJoin = null;

        if (joinCode) {
            if (rooms[joinCode] && rooms[joinCode].players.length === 1) {
                roomToJoin = joinCode;
            } else {
                socket.emit('opponentLeft'); 
                return;
            }
        } else if (isCreatingPrivate) {
            const newCode = generateRoomCode();
            socket.join(newCode);
            socket.roomId = newCode;
            rooms[newCode] = {
                type: gameType,
                players: [socket.id],
                usernames: { [socket.id]: username },
                gameInstance: null,
                isPrivate: true,
                rematchRequests: [] // NEW: Track who wants a rematch
            };
            socket.emit('waitingForOpponent', newCode);
            return; 
        } else {
            for (const roomId in rooms) {
                if (rooms[roomId].type === gameType && rooms[roomId].players.length === 1 && !rooms[roomId].isPrivate) {
                    roomToJoin = roomId;
                    break;
                }
            }
        }

        if (roomToJoin) {
            const room = rooms[roomToJoin];
            room.players.push(socket.id);
            room.usernames[socket.id] = username; 
            socket.join(roomToJoin);
            socket.roomId = roomToJoin; 
            
            const GameClass = GameRegistry[room.type]; 
            room.gameInstance = new GameClass(room.players);

            const nameMap = {};
            room.players.forEach(id => {
                const symbol = room.gameInstance.symbols[id];
                nameMap[symbol] = room.usernames[id];
            });
            room.nameMap = nameMap;

            // HIDDEN INFO CHECK
            if (typeof room.gameInstance.getGameStateForPlayer === 'function') {
                room.players.forEach(playerId => {
                    io.to(playerId).emit('secretGameStart', {
                        state: room.gameInstance.getGameStateForPlayer(playerId),
                        names: room.nameMap
                    });
                });
            } else {
                io.to(roomToJoin).emit('gameStart', {
                    board: room.gameInstance.board,
                    turn: room.gameInstance.turn,
                    symbols: room.gameInstance.symbols,
                    names: room.nameMap
                });
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
                rematchRequests: [] // NEW: Track who wants a rematch
            };

            socket.emit('waitingForOpponent', null); 
        }
    });

    socket.on('makeMove', (moveData) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId] || !rooms[roomId].gameInstance) return;

        const game = rooms[roomId].gameInstance;
        const isValidMove = game.makeMove(socket.id, moveData);

        if (isValidMove) {
            if (game.winner) {
                io.to(roomId).emit('gameOver', { board: game.board, winner: game.winner, names: rooms[roomId].nameMap });
                rooms[roomId].rematchRequests = []; 
            } else {
                // HIDDEN INFO CHECK: Does this game use secret hands?
                if (typeof game.getGameStateForPlayer === 'function') {
                    // Send custom state to each player individually
                    rooms[roomId].players.forEach(playerId => {
                        io.to(playerId).emit('updateSecretBoard', game.getGameStateForPlayer(playerId));
                    });
                } else {
                    // Public Information Game (TTT, Connect 4)
                    io.to(roomId).emit('updateBoard', { board: game.board, turn: game.turn });
                }
            }
        }
    });

    // --- REMATCH LOGIC (NEW) ---
    socket.on('requestRematch', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        
        // Add this player's vote if they haven't voted yet
        if (!room.rematchRequests.includes(socket.id)) {
            room.rematchRequests.push(socket.id);
        }

        if (room.rematchRequests.length === 2) {
            // Both players voted yes! Reset the game.
            const GameClass = GameRegistry[room.type];
            room.gameInstance = new GameClass(room.players);
            room.rematchRequests = []; // Reset votes for the next time

            io.to(roomId).emit('gameStart', {
                board: room.gameInstance.board,
                turn: room.gameInstance.turn,
                symbols: room.gameInstance.symbols,
                names: room.nameMap
            });
        } else {
            // Tell the other player a rematch was proposed
            socket.to(roomId).emit('rematchProposed');
        }
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            io.to('lobby').emit('systemMessage', `🚪 ${socket.username} left the tavern.`);
        }
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            socket.to(roomId).emit('opponentLeft');
            delete rooms[roomId]; // We DO still delete the room if someone actually closes their tab
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { 
    console.log(`🚀 Server running on port ${PORT}`); 
});