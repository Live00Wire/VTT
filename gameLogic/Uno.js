// gameLogic/Uno.js

class Uno {
    constructor(players) {
        this.players = players; 
        this.hands = {};
        this.symbols = {};
        this.unoSafe = {}; 

        this.players.forEach((id, index) => {
            this.symbols[id] = `P${index + 1}`; 
            this.unoSafe[id] = false;
        });

        this.direction = 1; 
        this.deck = this.generateDeck();
        this.discardPile = [];
        this.turnIndex = 0; 
        this.winner = null;

        this.players.forEach(id => {
            this.hands[id] = [];
            for (let i = 0; i < 7; i++) {
                this.hands[id].push(this.drawCardSafe());
            }
        });

        let firstCard;
        do {
            firstCard = this.drawCardSafe();
            if (['skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(firstCard.value)) {
                this.deck.unshift(firstCard); 
            } else {
                this.discardPile.push(firstCard);
            }
        } while (this.discardPile.length === 0);
    }

    generateDeck() {
        const colors = ['red', 'blue', 'green', 'yellow'];
        const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2'];
        let deck = [];

        for (let color of colors) {
            for (let value of values) {
                deck.push({ color: color, value: value });
                if (value !== '0') deck.push({ color: color, value: value }); 
            }
        }

        for (let i = 0; i < 4; i++) {
            deck.push({ color: 'wild', value: 'wild' });
            deck.push({ color: 'wild', value: 'wild4' });
        }

        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        return deck;
    }

    drawCardSafe() {
        if (this.deck.length === 0) {
            const top = this.discardPile.pop(); 
            this.deck = this.discardPile.sort(() => Math.random() - 0.5);
            this.discardPile = [top];
        }
        return this.deck.pop();
    }

    getTopCard() { 
        return this.discardPile[this.discardPile.length - 1]; 
    }

    canPlay(card) {
        if (card.color === 'wild') return true; 
        const topCard = this.getTopCard();
        const activeColor = topCard.chosenColor || topCard.color;
        return card.color === activeColor || card.value === topCard.value;
    }

    makeMove(playerId, actionData) {
        // --- INSTANT ACTIONS (Anytime) ---
        if (actionData.action === 'catch') {
            let caughtSomeone = false;
            this.players.forEach(victimId => {
                if (this.hands[victimId].length === 1 && !this.unoSafe[victimId]) {
                    this.hands[victimId].push(this.drawCardSafe());
                    this.hands[victimId].push(this.drawCardSafe());
                    caughtSomeone = true;
                }
            });
            return caughtSomeone; 
        }

        if (actionData.action === 'call_uno') {
            if (this.hands[playerId].length <= 2 && !this.unoSafe[playerId]) {
                this.unoSafe[playerId] = true;
                return true; 
            }
            return false;
        }

        // --- TURN-BASED ACTIONS ---
        if (this.players[this.turnIndex] !== playerId || this.winner !== null) return false;

        const hand = this.hands[playerId];

        if (actionData.action === 'play') {
            const cardIndex = actionData.cardIndex;
            const cardToPlay = hand[cardIndex];

            if (!cardToPlay || !this.canPlay(cardToPlay)) return false; 

            if (cardToPlay.color === 'wild') {
                if (!actionData.declaredColor) return false; 
                cardToPlay.chosenColor = actionData.declaredColor;
            }

            hand.splice(cardIndex, 1);
            this.discardPile.push(cardToPlay);

            if (hand.length === 0) {
                this.winner = this.symbols[playerId];
                return true;
            }

            if (cardToPlay.value === 'reverse') {
                if (this.players.length === 2) this.nextTurn(); 
                else this.direction *= -1; 
            } 
            else if (cardToPlay.value === 'skip') {
                this.nextTurn(); 
            } 
            else if (cardToPlay.value === 'draw2') {
                this.nextTurn(); 
                const victimId = this.players[this.turnIndex];
                this.hands[victimId].push(this.drawCardSafe());
                this.hands[victimId].push(this.drawCardSafe());
                this.unoSafe[victimId] = false; 
            }
            else if (cardToPlay.value === 'wild4') {
                this.nextTurn(); 
                const victimId = this.players[this.turnIndex];
                for(let i = 0; i < 4; i++) this.hands[victimId].push(this.drawCardSafe());
                this.unoSafe[victimId] = false; 
            }

            this.nextTurn(); 
            return true;
        } 
        
        else if (actionData.action === 'draw') {
            hand.push(this.drawCardSafe());
            this.unoSafe[playerId] = false; 
            this.nextTurn();
            return true;
        }

        return false; 
    }

    nextTurn() {
        this.turnIndex = (this.turnIndex + this.direction) % this.players.length;
        if (this.turnIndex < 0) this.turnIndex += this.players.length;
    }

    getGameStateForPlayer(playerId) {
        const opponentCardCounts = {};
        const safePlayers = {}; 
        
        this.players.forEach(id => {
            if (id !== playerId) opponentCardCounts[this.symbols[id]] = this.hands[id].length;
            safePlayers[this.symbols[id]] = this.unoSafe[id];
        });

        return {
            myHand: this.hands[playerId],
            topCard: this.getTopCard(),
            currentTurn: this.symbols[this.players[this.turnIndex]], 
            direction: this.direction,
            opponentCards: opponentCardCounts,
            winner: this.winner,
            mySymbol: this.symbols[playerId],
            unoSafe: this.unoSafe[playerId], 
            safePlayers: safePlayers, 
            playerOrder: this.players.map(id => this.symbols[id]) 
        };
    }
}

module.exports = Uno;