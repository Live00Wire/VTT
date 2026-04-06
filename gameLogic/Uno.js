// gameLogic/Uno.js

class Uno {
    constructor(players) {
        this.players = players; // Array of socket IDs
        this.hands = {};
        this.deck = this.generateDeck();
        this.discardPile = [];
        this.turnIndex = 0; // Starts with the first player
        this.winner = null;

        // 1. Deal 7 cards to each player
        this.players.forEach(id => {
            this.hands[id] = [];
            for (let i = 0; i < 7; i++) {
                this.hands[id].push(this.deck.pop());
            }
        });

        // 2. Flip the first card to start the discard pile
        // (We ensure the first card is a number, not a wild/action card for now)
        let firstCard = this.deck.pop();
        this.discardPile.push(firstCard);
    }

    generateDeck() {
        const colors = ['red', 'blue', 'green', 'yellow'];
        const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        let deck = [];

        // Build the deck
        for (let color of colors) {
            for (let value of values) {
                deck.push({ color: color, value: value });
                // Uno has two of every number 1-9 per color
                if (value !== '0') {
                    deck.push({ color: color, value: value });
                }
            }
        }

        // Shuffle the deck (Fisher-Yates Algorithm)
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        return deck;
    }

    getTopCard() {
        return this.discardPile[this.discardPile.length - 1];
    }

    // Rule Check: Can I play this card?
    canPlay(card) {
        const topCard = this.getTopCard();
        return card.color === topCard.color || card.value === topCard.value;
    }

    // The server calls this when a player clicks a card or the draw deck
    makeMove(playerId, actionData) {
        // Reject if it's not their turn
        if (this.players[this.turnIndex] !== playerId || this.winner !== null) {
            return false;
        }

        const hand = this.hands[playerId];

        // ACTION: PLAY A CARD
        if (actionData.action === 'play') {
            const cardIndex = actionData.cardIndex;
            const cardToPlay = hand[cardIndex];

            // Validate the play
            if (!cardToPlay || !this.canPlay(cardToPlay)) {
                return false; 
            }

            // Move card from hand to discard pile
            hand.splice(cardIndex, 1);
            this.discardPile.push(cardToPlay);

            // Check if they won!
            if (hand.length === 0) {
                this.winner = playerId;
            } else {
                this.nextTurn();
            }
            return true;
        } 
        
        // ACTION: DRAW A CARD
        else if (actionData.action === 'draw') {
            // (If the deck empties, we would reshuffle the discard pile here later)
            hand.push(this.deck.pop());
            this.nextTurn();
            return true;
        }

        return false; // Unknown action
    }

    nextTurn() {
        // Move to the next player. If we hit the end of the array, loop back to 0.
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
    }

    // THE MOST IMPORTANT FUNCTION FOR CARD GAMES:
    // This creates a custom "care package" of data tailored for ONE specific player.
    // It hides opponent hands so players can't cheat!
    getGameStateForPlayer(playerId) {
        // Count how many cards opponents have
        const opponentCardCounts = {};
        this.players.forEach(id => {
            if (id !== playerId) {
                opponentCardCounts[id] = this.hands[id].length;
            }
        });

        return {
            myHand: this.hands[playerId],
            topCard: this.getTopCard(),
            currentTurn: this.players[this.turnIndex], 
            opponentCards: opponentCardCounts,
            winner: this.winner
        };
    }
}

module.exports = Uno;