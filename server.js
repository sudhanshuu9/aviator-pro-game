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

app.use(express.static(path.join(__dirname, 'public')));

let gameState = 'waiting';
let currentMultiplier = 1.00;
let crashPoint = 1.00;
let roundNumber = 1;
let history = [1.45, 2.10, 1.12, 5.40, 1.85, 3.20];
let activeBets = new Map();
let gameTimer = null;
let startTime = 0;

const WAITING_TIME = 7000;

function generateCrashPoint() {
    const r = Math.random() * 100;
    if (r < 3) return 1.00;
    const e = 100;
    const h = Math.random() * (e - 1);
    let val = Math.floor((100 * e) / (e - h)) / 100;
    return Math.min(Math.max(val, 1.01), 120.00);
}

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

function startFlyingPhase() {
    gameState = 'flying';
    crashPoint = generateCrashPoint();
    startTime = Date.now();
    currentMultiplier = 1.00;

    console.log(`🚀 [ROUND #${roundNumber}] Flight Started! Target Crash: ${crashPoint.toFixed(2)}x`);

    io.emit('round:start', { roundNumber });

    gameTimer = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        currentMultiplier = Number((Math.pow(1.07, elapsedSec * 1.5)).toFixed(2));

        if (currentMultiplier >= crashPoint) {
            triggerCrash();
        } else {
            io.emit('round:tick', { multiplier: currentMultiplier });
        }
    }, 50);
}

function triggerCrash() {
    clearInterval(gameTimer);
    gameState = 'crashed';
    currentMultiplier = crashPoint;

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

io.on('connection', (socket) => {
    socket.playerName = 'Guest Pilot';

    socket.emit('init:history', { history });

    if (gameState === 'waiting') {
        socket.emit('round:waiting', { roundNumber, duration: WAITING_TIME });
    }

    // 🟢 MULTI-PLAYER ROBUST LOGIN HANDLER
    socket.on('player:login', (data) => {
        if (data && data.name) {
            socket.playerName = data.name.trim();
        }
        console.log(`🟢 [LOGIN] Player "${socket.playerName}" logged in successfully! (Socket ID: ${socket.id})`);
    });

    socket.on('bet:place', (amount) => {
        const betAmt = parseInt(amount, 10);
        if (isNaN(betAmt) || betAmt <= 0) return;

        activeBets.set(socket.id, {
            amount: betAmt,
            cashedOut: false,
            name: socket.playerName
        });

        console.log(`💰 [BET] ${socket.playerName} placed a bet of ₹${betAmt} for Round #${roundNumber}`);
        socket.emit('bet:confirmed', { amount: betAmt });
    });

    socket.on('bet:queue', (amount) => {
        const betAmt = parseInt(amount, 10);
        if (isNaN(betAmt) || betAmt <= 0) return;

        console.log(`⏳ [BET QUEUED] ${socket.playerName} queued ₹${betAmt} for Next Round`);
        socket.emit('bet:queue_confirmed', { amount: betAmt });
    });

    socket.on('bet:cancel', () => {
        const playerBet = activeBets.get(socket.id);
        const betAmt = playerBet ? playerBet.amount : 'bet';
        activeBets.delete(socket.id);
        console.log(`❌ [CANCEL] ${socket.playerName} cancelled bet of ₹${betAmt}`);
        socket.emit('bet:cancelled', { amount: betAmt });
    });

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

    socket.on('disconnect', () => {
        console.log(`🔴 [DISCONNECT] Player "${socket.playerName}" left the game.`);
        activeBets.delete(socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 AVIATOR PRO SERVER LIVE ON PORT ${PORT}`);
    console.log(`========================================\n`);
    startWaitingPhase();
});
