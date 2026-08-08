const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Serve static assets from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// GAME ENGINE STATE
let gameState = 'waiting'; // 'waiting' | 'flying' | 'crashed'
let currentMultiplier = 1.00;
let crashPoint = 1.00;
let roundNumber = 1;
let history = [1.45, 2.10, 1.12, 5.40, 1.85, 3.20]; // Default starter history
let activeBets = new Map(); // socket.id -> { amount, cashedOut, name }
let gameTimer = null;
let startTime = 0;

const WAITING_TIME = 7000; // 7 seconds waiting time between rounds

// Weighted Random Crash Point Generator
function generateCrashPoint() {
    const r = Math.random() * 100;
    // 3% instant crash chance at 1.00x
    if (r < 3) return 1.00;
    
    // Standard crash curve algorithm
    const e = 100;
    const h = Math.random() * (e - 1);
    let val = Math.floor((100 * e) / (e - h)) / 100;
    return Math.min(Math.max(val, 1.01), 120.00);
}

// 1. WAITING PHASE
function startWaitingPhase() {
    gameState = 'waiting';
    currentMultiplier = 1.00;
    activeBets.clear();
    roundNumber++;

    console.log(`\n========================================`);
    console.log(`⏳ [ROUND #${roundNumber}] Waiting Phase Started (${WAITING_TIME / 1000}s)`);
    console.log(`========================================`);

    io.emit('round:waiting', {
        roundNumber: roundNumber,
        duration: WAITING_TIME
    });

    setTimeout(() => {
        startFlyingPhase();
    }, WAITING_TIME);
}

// 2. FLYING PHASE
function startFlyingPhase() {
    gameState = 'flying';
    crashPoint = generateCrashPoint();
    startTime = Date.now();
    currentMultiplier = 1.00;

    console.log(`🚀 [ROUND #${roundNumber}] Flight Started! Target Crash: ${crashPoint.toFixed(2)}x`);

    io.emit('round:start', { roundNumber });

    gameTimer = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        
        // Exponential multiplier progression formula
        currentMultiplier = Number((1.00 + 0.06 * Math.pow(elapsedSec, 1.85)).toFixed(2));

        if (currentMultiplier >= crashPoint) {
            triggerCrash();
        } else {
            io.emit('round:tick', { multiplier: currentMultiplier });
        }
    }, 100);
}

// 3. CRASH PHASE
function triggerCrash() {
    clearInterval(gameTimer);
    gameState = 'crashed';
    currentMultiplier = crashPoint;

    // Add to history (keep max 25 entries)
    history.push(Number(crashPoint.toFixed(2)));
    if (history.length > 25) history.shift();

    console.log(`💥 [ROUND #${roundNumber}] CRASHED at ${crashPoint.toFixed(2)}x!`);

    io.emit('round:crash', {
        crashPoint: crashPoint,
        history: history
    });

    setTimeout(() => {
        startWaitingPhase();
    }, 3500);
}

// SOCKET.IO REAL-TIME CONNECTIONS
io.on('connection', (socket) => {
    socket.playerName = 'Guest Pilot';

    // Send history on join
    socket.emit('init:history', { history });

    // Send current round state if joining mid-game
    if (gameState === 'waiting') {
        socket.emit('round:waiting', { roundNumber, duration: WAITING_TIME });
    }

    // 🟢 LISTEN: Player logs in
    socket.on('player:login', (data) => {
        socket.playerName = (data && data.name) ? data.name.trim() : 'Pilot';
        console.log(`🟢 [LOGIN] Player "${socket.playerName}" logged in! (Socket ID: ${socket.id})`);
    });

    // 💰 LISTEN: Place Bet
    socket.on('bet:place', (amount) => {
        if (gameState !== 'waiting') return;
        const betAmt = parseInt(amount, 10);
        if (isNaN(betAmt) || betAmt <= 0) return;

        activeBets.set(socket.id, {
            amount: betAmt,
            cashedOut: false,
            name: socket.playerName
        });

        console.log(`💰 [BET] ${socket.playerName} placed a bet of ₹${betAmt}`);
        socket.emit('bet:confirmed', { amount: betAmt });
    });

    // ❌ LISTEN: Cancel Bet
    socket.on('bet:cancel', () => {
        if (gameState !== 'waiting') return;
        const playerBet = activeBets.get(socket.id);
        if (playerBet) {
            activeBets.delete(socket.id);
            console.log(`❌ [CANCEL] ${socket.playerName} cancelled bet of ₹${playerBet.amount}`);
            socket.emit('bet:cancelled', { amount: playerBet.amount });
        }
    });

    // 🎉 LISTEN: Cash Out
    socket.on('bet:cashout', () => {
        if (gameState !== 'flying') return;
        const playerBet = activeBets.get(socket.id);

        if (playerBet && !playerBet.cashedOut) {
            playerBet.cashedOut = true;
            const winnings = Math.floor(playerBet.amount * currentMultiplier);

            console.log(`🎉 [CASHOUT] ${socket.playerName} cashed out at ${currentMultiplier.toFixed(2)}x (+₹${winnings})`);

            socket.emit('you:cashedout', {
                multiplier: currentMultiplier,
                winnings: winnings
            });
        }
    });

    // 🔴 LISTEN: Disconnect / Tab Close
    socket.on('disconnect', () => {
        console.log(`🔴 [DISCONNECT] Player "${socket.playerName}" left the game.`);
        activeBets.delete(socket.id);
    });
});

// START EXPRESS SERVER & GAME LOOP
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 AVIATOR PRO SERVER LIVE ON PORT ${PORT}`);
    console.log(`========================================\n`);
    startWaitingPhase();
});
