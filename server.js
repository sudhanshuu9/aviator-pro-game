// ==========================================
// Aviator Pro Backend — 100% Verified Engine
// ==========================================
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
app.use(express.static(path.join(__dirname, 'public')));
// Force Express to serve index.html for any incoming web request
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Game Timing (Milliseconds)
const WAITING_TIME = 7000; // 7 seconds countdown phase
const CRASHED_TIME = 4000; // 4 seconds crash view phase

let currentState = 'waiting'; // 'waiting', 'flying', 'crashed'
let currentMultiplier = 1.0;
let crashPoint = 1.0;
let roundNumber = 0;
let gameLoopInterval = null;

// Store up to 25 recent plane crash multipliers
const planeCrashHistory = [];

// Store active bets: socketId -> { amount, cashedOut }
const activeBets = new Map();

function generateCrashPoint() {
    const rand = Math.random();
    if (rand < 0.05) return 1.00; // Instant crash
    return parseFloat((1 + Math.random() * (rand > 0.85 ? 8.5 : 2.5)).toFixed(2));
}

function startWaiting() {
    currentState = 'waiting';
    currentMultiplier = 1.0;
    roundNumber++;
    activeBets.clear();
    
    io.emit('round:waiting', { roundNumber, duration: WAITING_TIME });
    console.log(`[Round #${roundNumber}] Betting phase open...`);

    setTimeout(startFlying, WAITING_TIME);
}

function startFlying() {
    currentState = 'flying';
    currentMultiplier = 1.0;
    crashPoint = generateCrashPoint();
    console.log(`[Round #${roundNumber}] Takeoff! Crash point: ${crashPoint}x`);
    
    io.emit('round:start');

    gameLoopInterval = setInterval(() => {
        currentMultiplier += 0.01;
        const formattedMultiplier = parseFloat(currentMultiplier.toFixed(2));

        io.emit('round:tick', { multiplier: formattedMultiplier });

        if (formattedMultiplier >= crashPoint) {
            clearInterval(gameLoopInterval);
            startCrashed();
        }
    }, 100); 
}

function startCrashed() {
    currentState = 'crashed';
    console.log(`[Round #${roundNumber}] Crashed at ${crashPoint}x`);
    
    planeCrashHistory.push(crashPoint);
    if (planeCrashHistory.length > 25) {
        planeCrashHistory.shift();
    }

    io.emit('round:crash', { crashPoint, history: planeCrashHistory });
    
    setTimeout(startWaiting, CRASHED_TIME);
}

// Socket Connection Handler
io.on('connection', (socket) => {
    socket.emit('init:history', { history: planeCrashHistory });

    if (currentState === 'waiting') {
        socket.emit('round:waiting', { roundNumber, duration: WAITING_TIME });
    } else if (currentState === 'flying') {
        socket.emit('round:start');
    }

    // Place Bet
    socket.on('bet:place', (betData) => {
        if (currentState !== 'waiting') return;
        
        const amount = typeof betData === 'object' ? betData.amount : parseInt(betData, 10);
        if (isNaN(amount) || amount < 1) return;

        activeBets.set(socket.id, { amount, cashedOut: false });
        socket.emit('bet:confirmed', { amount });
    });

    // Cancel Bet (Before Takeoff)
    socket.on('bet:cancel', () => {
        if (currentState !== 'waiting') return;

        const playerBet = activeBets.get(socket.id);
        if (playerBet && !playerBet.cashedOut) {
            const refundedAmount = playerBet.amount;
            activeBets.delete(socket.id);
            socket.emit('bet:cancelled', { amount: refundedAmount });
        }
    });

    // Cash Out (During Flight)
    socket.on('bet:cashout', () => {
        if (currentState !== 'flying') return;

        const playerBet = activeBets.get(socket.id);
        if (!playerBet || playerBet.cashedOut) return;

        const liveMultiplier = parseFloat(currentMultiplier.toFixed(2));
        const winnings = Math.floor(playerBet.amount * liveMultiplier);

        playerBet.cashedOut = true;

        socket.emit('you:cashedout', { multiplier: liveMultiplier, winnings });
    });

    socket.on('disconnect', () => {
        activeBets.delete(socket.id);
    });
});

// Start Game Engine
startWaiting();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
