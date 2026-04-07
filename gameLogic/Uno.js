class Uno {
    constructor(players, rules = {}) {
        this.players = [...players]; 
        this.hands = {};
        this.symbols = {};
        this.unoSafe = {}; 

        this.rules = {
            playDrawn: rules.playDrawn !== undefined ? rules.playDrawn : true,
            drawUntilPlay: rules.drawUntilPlay || false,
            stacking: rules.stacking || false,
            jumpIn: rules.jumpIn || false,
            zeroPass: rules.zeroPass || false 
        };

        this.stackPenalty = 0; 
        this.hasDrawn = false; 

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
            for (let i = 0; i < 7; i++) this.hands[id].push(this.drawCardSafe());
        });

        let firstCard;
        do {
            firstCard = this.drawCardSafe();
            if (['skip', 'reverse', 'draw2', 'wild', 'wild4'].includes(firstCard.value)) {
                this.deck.unshift(firstCard); 
            } else { this.discardPile.push(firstCard); }
        } while (this.discardPile.length === 0);
    }

    updatePlayerId(oldId, newId) {
        const index = this.players.indexOf(oldId);
        if (index !== -1) {
            this.players[index] = newId;
        }
        
        if (this.hands[oldId] !== undefined) {
            this.hands[newId] = this.hands[oldId];
            delete this.hands[oldId];
        }
        
        if (this.symbols[oldId] !== undefined) {
            this.symbols[newId] = this.symbols[oldId];
            delete this.symbols[oldId];
        }
        
        if (this.unoSafe[oldId] !== undefined) {
            this.unoSafe[newId] = this.unoSafe[oldId];
            delete this.unoSafe[oldId];
        }
        
        return true;
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

    getTopCard() { return this.discardPile[this.discardPile.length - 1]; }

    canPlay(card) {
        if (card.color === 'wild') return true; 
        const topCard = this.getTopCard();
        const activeColor = topCard.chosenColor || topCard.color;
        return card.color === activeColor || card.value === topCard.value;
    }

    makeMove(playerId, actionData) {
        if (this.winner !== null) return false;

        if (actionData.action === 'catch') {
            let caughtSomeone = false;
            this.players.forEach(victimId => {
                if (this.hands[victimId] && this.hands[victimId].length === 1 && !this.unoSafe[victimId]) {
                    this.hands[victimId].push(this.drawCardSafe());
                    this.hands[victimId].push(this.drawCardSafe());
                    caughtSomeone = true;
                }
            });
            return caughtSomeone; 
        }

        if (actionData.action === 'call_uno') {
            if (this.players[this.turnIndex] === playerId && !this.unoSafe[playerId]) {
                const hand = this.hands[playerId];
                let hasPlayable = false;
                
                for (let card of hand) {
                    if (this.stackPenalty > 0) {
                        if (card.value === 'draw2' || card.value === 'wild4') hasPlayable = true;
                    } else if (this.canPlay(card)) {
                        hasPlayable = true;
                    }
                }

                if ((hand.length === 2 && hasPlayable) || hand.length === 1) {
                    this.unoSafe[playerId] = true; 
                    return true; 
                }
            }
            return false;
        }

        let isMyTurn = this.players[this.turnIndex] === playerId;
        const topCard = this.getTopCard();

        if (!isMyTurn) {
            if (this.rules.jumpIn && actionData.action === 'play') {
                const card = this.hands[playerId][actionData.cardIndex];
                if (card && card.color !== 'wild' && card.color === topCard.color && card.value === topCard.value && this.stackPenalty === 0) {
                    this.turnIndex = this.players.indexOf(playerId); 
                    isMyTurn = true; 
                } else { return false; }
            } else { return false; }
        }

        const hand = this.hands[playerId];

        if (actionData.action === 'timeout') {
            if (this.stackPenalty > 0) {
                for(let i=0; i<this.stackPenalty; i++) this.hands[playerId].push(this.drawCardSafe());
                this.stackPenalty = 0;
            } else if (!this.hasDrawn) {
                this.hands[playerId].push(this.drawCardSafe());
                this.unoSafe[playerId] = false;
            }
            
            this.hasDrawn = false;
            this.nextTurn();
            return true;
        }

        if (actionData.action === 'play') {
            const cardIndex = actionData.cardIndex;
            const cardToPlay = hand[cardIndex];

            if (this.stackPenalty > 0) {
                if (cardToPlay.value !== 'draw2' && cardToPlay.value !== 'wild4') return false; 
            }

            if (!cardToPlay || !this.canPlay(cardToPlay)) return false; 

            if (cardToPlay.color === 'wild') {
                if (!actionData.declaredColor) return false; 
                cardToPlay.chosenColor = actionData.declaredColor;
            }

            hand.splice(cardIndex, 1);
            this.discardPile.push(cardToPlay);
            this.hasDrawn = false; 

            if (hand.length === 0) {
                this.winner = this.symbols[playerId]; return true;
            }

            if (this.rules.stacking) {
                if (cardToPlay.value === 'draw2') this.stackPenalty += 2;
                if (cardToPlay.value === 'wild4') this.stackPenalty += 4;
            }

            if (cardToPlay.value === 'reverse') {
                if (this.players.length === 2) this.nextTurn(); 
                else this.direction *= -1; 
            } 
            else if (cardToPlay.value === 'skip') { this.nextTurn(); } 
            else if (cardToPlay.value === 'draw2' && !this.rules.stacking) {
                this.nextTurn(); 
                const victimId = this.players[this.turnIndex];
                this.hands[victimId].push(this.drawCardSafe()); this.hands[victimId].push(this.drawCardSafe());
                this.unoSafe[victimId] = false; 
            }
            else if (cardToPlay.value === 'wild4' && !this.rules.stacking) {
                this.nextTurn(); 
                const victimId = this.players[this.turnIndex];
                for(let i = 0; i < 4; i++) this.hands[victimId].push(this.drawCardSafe());
                this.unoSafe[victimId] = false; 
            }

            if (this.rules.zeroPass && cardToPlay.value === '0') {
                let newHands = {};
                for(let i=0; i<this.players.length; i++) {
                    let nextI = (i + this.direction) % this.players.length;
                    if(nextI < 0) nextI += this.players.length;
                    newHands[this.players[nextI]] = this.hands[this.players[i]];
                }
                this.hands = newHands;
            }

            this.nextTurn(); 
            return true;
        } 
        
        else if (actionData.action === 'draw') {
            if (this.stackPenalty > 0) {
                for(let i=0; i<this.stackPenalty; i++) this.hands[playerId].push(this.drawCardSafe());
                this.stackPenalty = 0;
                this.nextTurn();
                return true;
            }

            if (this.hasDrawn) return false; 

            if (this.rules.drawUntilPlay) {
                let drawnCard;
                do {
                    drawnCard = this.drawCardSafe();
                    this.hands[playerId].push(drawnCard);
                } while(!this.canPlay(drawnCard));
                this.unoSafe[playerId] = false; 
                this.hasDrawn = true; 
                return true;
            } else {
                this.hands[playerId].push(this.drawCardSafe());
                this.unoSafe[playerId] = false; 
                
                if (this.rules.playDrawn) {
                    this.hasDrawn = true; 
                } else {
                    this.nextTurn();
                }
                return true;
            }
        }

        else if (actionData.action === 'pass') {
            if (this.hasDrawn) {
                this.hasDrawn = false;
                this.nextTurn();
                return true;
            }
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
            if (id !== playerId && this.hands[id]) opponentCardCounts[this.symbols[id]] = this.hands[id].length;
            if (this.symbols[id]) safePlayers[this.symbols[id]] = this.unoSafe[id];
        });

        return {
            myHand: this.hands[playerId] || [],
            topCard: this.getTopCard(),
            currentTurn: this.symbols[this.players[this.turnIndex]], 
            direction: this.direction,
            opponentCards: opponentCardCounts,
            winner: this.winner,
            mySymbol: this.symbols[playerId],
            unoSafe: this.unoSafe[playerId], 
            safePlayers: safePlayers, 
            playerOrder: this.players.map(id => this.symbols[id]),
            rules: this.rules,
            stackPenalty: this.stackPenalty,
            hasDrawn: (this.players[this.turnIndex] === playerId) ? this.hasDrawn : false
        };
    }
}

module.exports = Uno;