// gameLogic/TicTacToe.js

class TicTacToe {
    constructor(players) {
        // players is an array of two socket IDs: [player1_id, player2_id]
        this.symbols = {};
        this.symbols[players[0]] = 'X';
        this.symbols[players[1]] = 'O';
        
        this.board = ["", "", "", "", "", "", "", "", ""];
        this.turn = 'X';
        this.winner = null; // Will be 'X', 'O', 'Draw', or null
    }

    // The server calls this when a player tries to move
    makeMove(playerId, index) {
        const playerSymbol = this.symbols[playerId];

        // Reject move if it's not their turn, game is over, or cell is full
        if (this.turn !== playerSymbol || this.winner !== null || this.board[index] !== "") {
            return false; 
        }

        // Apply the move
        this.board[index] = playerSymbol;
        this.checkWin();

        // Switch turns if no one won yet
        if (!this.winner) {
            this.turn = this.turn === 'X' ? 'O' : 'X';
        }

        return true; // Move was successful
    }

    checkWin() {
        const winConditions = [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];

        for (let [a, b, c] of winConditions) {
            if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) {
                this.winner = this.board[a];
                return;
            }
        }
        
        if (!this.board.includes("")) {
            this.winner = 'Draw';
        }
    }
}

module.exports = TicTacToe;