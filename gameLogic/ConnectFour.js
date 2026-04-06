// gameLogic/ConnectFour.js

class ConnectFour {
    constructor(players) {
        this.symbols = {};
        this.symbols[players[0]] = 1; // 1 for Red
        this.symbols[players[1]] = 2; // 2 for Yellow
        
        this.board = Array(6).fill().map(() => Array(7).fill(0));
        this.turn = 1;
        this.winner = null;
    }

    makeMove(playerId, col) {
        const playerSymbol = this.symbols[playerId];

        if (this.turn !== playerSymbol || this.winner !== null) {
            return false;
        }

        // Gravity: Find the lowest empty row in this column
        let rowToUpdate = -1;
        for (let r = 5; r >= 0; r--) {
            if (this.board[r][col] === 0) {
                this.board[r][col] = playerSymbol;
                rowToUpdate = r;
                break;
            }
        }

        if (rowToUpdate === -1) return false; // Column is completely full

        this.checkWin(playerSymbol);

        if (!this.winner) {
            this.turn = this.turn === 1 ? 2 : 1;
        }

        return true;
    }

    checkWin(player) {
        // Horizontal
        for (let r = 0; r < 6; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.board[r][c] === player && this.board[r][c+1] === player && this.board[r][c+2] === player && this.board[r][c+3] === player) {
                    this.winner = player; return;
                }
            }
        }
        // Vertical
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 7; c++) {
                if (this.board[r][c] === player && this.board[r+1][c] === player && this.board[r+2][c] === player && this.board[r+3][c] === player) {
                    this.winner = player; return;
                }
            }
        }
        // Diagonal Right
        for (let r = 3; r < 6; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.board[r][c] === player && this.board[r-1][c+1] === player && this.board[r-2][c+2] === player && this.board[r-3][c+3] === player) {
                    this.winner = player; return;
                }
            }
        }
        // Diagonal Left
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 4; c++) {
                if (this.board[r][c] === player && this.board[r+1][c+1] === player && this.board[r+2][c+2] === player && this.board[r+3][c+3] === player) {
                    this.winner = player; return;
                }
            }
        }
        // Draw Check
        let isDraw = true;
        for (let c = 0; c < 7; c++) {
            if (this.board[0][c] === 0) isDraw = false;
        }
        if (isDraw) this.winner = 'Draw';
    }
}

module.exports = ConnectFour;