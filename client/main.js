import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

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

[timeSetting, livesSetting].forEach(el => {
    el.addEventListener("change", () => {
        if (!isHost) return;
        socket.emit("UPDATE_SETTINGS", {
            code: currentRoomCode,
            settings: {
                roundTime: timeSetting.value,
                startingLives: livesSetting.value
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
    console.log("Connected");
    myId = socket.id;
});

socket.on("ROOM_CREATED", ({ code }) => {
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

        wordInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const word = wordInput.value;
                socket.emit('SUBMIT_WORD', { code: currentRoomCode, word });
                wordInput.value = "";
            }
        };
    } else {
        wordInput.disabled = true;
        wordInput.value = "";
        activeMsg.innerText = "OPPONENT'S TURN";
        activeMsg.style.color = "#888";
        wordInput.onkeydown = null;
    }
});

socket.on("LIFE_LOST", ({ playerId, lives }) => {
    if (playerId === socket.id) {
        currentGameLives = lives;
        updateLivesDisplay(lives);
        // Shake screen or something
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
    // Notification could be better than alert
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
        li.innerText = p.username;
        if (p.id === hostId) li.classList.add("host");
        playersUl.appendChild(li);
    });
}

function enableSettings(enabled) {
    timeSetting.disabled = !enabled;
    livesSetting.disabled = !enabled;
}

function applySettings(settings) {
    timeSetting.value = settings.roundTime;
    livesSetting.value = settings.startingLives;
    currentGameLives = settings.startingLives;
}
