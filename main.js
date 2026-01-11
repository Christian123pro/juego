import { io } from "https://cdn.socket.io/4.8.1/socket.io.esm.min.js";

const socket = io("https://juego-o91w.onrender.com");

// State
let myUsername = "";
let currentRoomCode = null;
let isHost = false;
let myId = "";
let currentGameLives = 3;

// DOM Elements
const loginScreen = document.getElementById("login-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");

const usernameInput = document.getElementById("username-input");
const codeInput = document.getElementById("code-input");
const createBtn = document.getElementById("create-btn");
const joinBtn = document.getElementById("join-btn");
const roomCodeDisplay = document.getElementById("room-code-display");
const playersUl = document.getElementById("players-ul");
const startGameBtn = document.getElementById("start-game-btn");
const waitingMsg = document.getElementById("waiting-msg");

const timeSetting = document.getElementById("time-setting");
const livesSetting = document.getElementById("lives-setting");

// --- Event Listeners ---

createBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    if (!username) return alert("Please enter a username");
    myUsername = username;
    socket.emit("CREATE_ROOM", { username });
});

joinBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!username || !code) return alert("Enter username and room code");
    myUsername = username;
    socket.emit("JOIN_ROOM", { code, username });
});

startGameBtn.addEventListener("click", () => {
    if (!currentRoomCode) return;
    socket.emit("START_GAME", { code: currentRoomCode });
});

const maxPlayersSetting = document.getElementById("max-players-setting");

[timeSetting, livesSetting, maxPlayersSetting].forEach(el => {
    if (!el) return;
    el.addEventListener("change", () => {
        if (!isHost) return;
        socket.emit("UPDATE_SETTINGS", {
            code: currentRoomCode,
            settings: {
                roundTime: timeSetting.value,
                startingLives: livesSetting.value,
                maxPlayers: maxPlayersSetting.value
            }
        });
    });
});

// --- UI Helpers ---

const renderGameUI = () => {
    gameScreen.innerHTML = `
    <div class="game-header">
      <div id="timer-display">10</div>
      <div id="lives-display"></div>
    </div>
    <div class="main-area">
      <div id="constraint-box">
        <span class="label">CONSTRAINT</span>
        <h1 id="constraint-text">---</h1>
      </div>
      <div id="word-input-area">
        <input type="text" id="word-input" placeholder="TYPE WORD HERE" disabled autocomplete="off" />
        <div id="active-player-msg">WAITING...</div>
        <div id="rival-input-display" class="rival-typing"></div> 
      </div>
    </div>
    <ul id="game-log"></ul>
  `;
    updateLivesDisplay(currentGameLives);
};

const updateLivesDisplay = (lives) => {
    const livesEl = document.getElementById("lives-display");
    if (livesEl) {
        livesEl.innerText = "❤️".repeat(Math.max(0, lives));
    }
};

// --- Socket Handlers ---

socket.on("connect", () => {
    console.log("Connected to server with ID:", socket.id);
    myId = socket.id;
});

socket.on("connect_error", (err) => {
    console.error("Socket Connection Error:", err.message);
});

socket.on("ROOM_CREATED", ({ code }) => {
    console.log("Room created! Code:", code);
    currentRoomCode = code;
    isHost = true;
    showLobby(code);
    enableSettings(true);
});

socket.on("JOINED_ROOM", ({ code }) => {
    currentRoomCode = code;
    isHost = false;
    showLobby(code);
    enableSettings(false);
});

socket.on("ROOM_UPDATE", ({ players, hostId, settings }) => {
    renderPlayers(players, hostId);
    if (settings) {
        applySettings(settings);
    }

    if (socket.id === hostId) {
        isHost = true;
        startGameBtn.classList.remove("hidden");
        waitingMsg.classList.add("hidden");
        enableSettings(true);
    } else {
        isHost = false;
        startGameBtn.classList.add("hidden");
        waitingMsg.classList.remove("hidden");
        enableSettings(false);
    }
});

socket.on("SETTINGS_UPDATED", (settings) => {
    applySettings(settings);
});

socket.on("KICKED", ({ message }) => {
    alert(message);
    location.reload();
});

socket.on("PLAYER_TYPING", ({ playerId, word }) => {
    const activeMsg = document.getElementById("active-player-msg");
    const rivalDisplay = document.getElementById("rival-input-display");

    // Only show if it's NOT my turn (activeMsg says "OPPONENT'S TURN")
    // or we can verify activePlayerId from previous state, but simplify:
    if (activeMsg && activeMsg.innerText.includes("OPPONENT")) {
        if (rivalDisplay) {
            rivalDisplay.innerText = word ? `Rival is typing: ${word}` : "";
        }
    }
});

socket.on("NEXT_TURN", ({ activePlayerId, constraint, timeLeft, playerLives }) => {
    lobbyScreen.classList.add("hidden");
    gameScreen.classList.remove("hidden");

    if (!document.getElementById("word-input")) {
        currentGameLives = playerLives;
        renderGameUI();
    }

    const wordInput = document.getElementById("word-input");
    const constraintText = document.getElementById("constraint-text");
    const activeMsg = document.getElementById("active-player-msg");
    const timerDisplay = document.getElementById("timer-display");
    const rivalDisplay = document.getElementById("rival-input-display");

    if (rivalDisplay) rivalDisplay.innerText = ""; // Clear previous typing

    constraintText.innerText = `CONTAINS: ${constraint}`;
    timerDisplay.innerText = timeLeft;

    if (window.turnInterval) clearInterval(window.turnInterval);
    let time = timeLeft;
    window.turnInterval = setInterval(() => {
        time--;
        timerDisplay.innerText = Math.max(0, time);
        if (time <= 0) clearInterval(window.turnInterval);
    }, 1000);

    if (activePlayerId === socket.id) {
        wordInput.disabled = false;
        wordInput.focus();
        activeMsg.innerText = "YOUR TURN!";
        activeMsg.style.color = "#00ffcc";
        wordInput.value = "";

        // Emit typing event
        wordInput.oninput = () => {
            socket.emit("WORD_INPUT", { code: currentRoomCode, word: wordInput.value });
        };

        wordInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const word = wordInput.value;
                socket.emit('SUBMIT_WORD', { code: currentRoomCode, word });
                wordInput.value = "";
                socket.emit("WORD_INPUT", { code: currentRoomCode, word: "" }); // Clear remote buffer
            }
        };
    } else {
        wordInput.disabled = true;
        wordInput.value = "";
        activeMsg.innerText = "OPPONENT'S TURN";
        activeMsg.style.color = "#888";
        wordInput.onkeydown = null;
        wordInput.oninput = null;
    }
});

socket.on("LIFE_LOST", ({ playerId, lives }) => {
    if (playerId === socket.id) {
        currentGameLives = lives;
        updateLivesDisplay(lives);
        gameScreen.classList.add("shake");
        setTimeout(() => gameScreen.classList.remove("shake"), 500);
    }
});

socket.on("WORD_ACCEPTED", () => {
    const input = document.getElementById("word-input");
    if (input) {
        input.style.borderColor = "#00ff00";
        setTimeout(() => input.style.borderColor = "#333", 500);
    }
});

socket.on("WORD_REJECTED", ({ reason }) => {
    const input = document.getElementById("word-input");
    if (input) {
        input.classList.add("shake");
        setTimeout(() => input.classList.remove("shake"), 500);
    }
    console.log("Rejected:", reason);
});

socket.on("GAME_OVER", ({ winner }) => {
    alert(`GAME OVER! Winner: ${winner}`);
    location.reload();
});

socket.on("ERROR", ({ message }) => {
    alert(message);
});

// --- Helpers ---

function showLobby(code) {
    loginScreen.classList.add("hidden");
    lobbyScreen.classList.remove("hidden");
    roomCodeDisplay.innerText = code;
}

function renderPlayers(players, hostId) {
    playersUl.innerHTML = "";
    players.forEach(p => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${p.username}</span>`;
        if (p.id === hostId) {
            li.classList.add("host");
            li.innerHTML += ' 👑';
        } else if (isHost) {
            // Add Kick Button for host
            const kickBtn = document.createElement("button");
            kickBtn.innerText = "❌";
            kickBtn.className = "kick-btn";
            kickBtn.onclick = () => {
                if (confirm(`Kick ${p.username}?`)) {
                    socket.emit("KICK_PLAYER", { code: currentRoomCode, targetId: p.id });
                }
            };
            li.appendChild(kickBtn);
        }
        playersUl.appendChild(li);
    });
}

function enableSettings(enabled) {
    timeSetting.disabled = !enabled;
    livesSetting.disabled = !enabled;
    if (maxPlayersSetting) maxPlayersSetting.disabled = !enabled;
}

function applySettings(settings) {
    timeSetting.value = settings.roundTime;
    livesSetting.value = settings.startingLives;
    if (maxPlayersSetting) maxPlayersSetting.value = settings.maxPlayers || 12;
    currentGameLives = settings.startingLives;
}
