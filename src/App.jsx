import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  saveMoveToFirebase,
  signInAdmin,
  signOutAdmin,
  listenToAuth,
  isAdminUser,
  getAllMoveRecords,
  createOnlineRoom,
  joinOnlineRoom,
  listenOnlineRoom,
  updateOnlineRoom,
} from "./firebase";

const GRID_SIZE = 9;
const GAMES_PER_SESSION = 3;
const PARTICIPANT_START = { r: 0, c: 0 };
const AI_START = { r: 0, c: 8 };
const GOAL = { r: 8, c: 4 };

const DIFFICULTY = {
  Easy: { wallCount: 14, maxTurns: 40, aiMin: 52, aiMax: 70 },
  Normal: { wallCount: 18, maxTurns: 35, aiMin: 55, aiMax: 80 },
  Hard: { wallCount: 22, maxTurns: 30, aiMin: 62, aiMax: 88 },
};

const DIRS = [
  { name: "Up", dr: -1, dc: 0, key: "ArrowUp", icon: "↑" },
  { name: "Down", dr: 1, dc: 0, key: "ArrowDown", icon: "↓" },
  { name: "Left", dr: 0, dc: -1, key: "ArrowLeft", icon: "←" },
  { name: "Right", dr: 0, dc: 1, key: "ArrowRight", icon: "→" },
];

const PLAYER_EMOJIS = [
  { emoji: "👦", label: "Boy" },
  { emoji: "👧", label: "Girl" },
  { emoji: "👨", label: "Man" },
  { emoji: "👩", label: "Woman" },
  { emoji: "🧑", label: "Unisex" },
  { emoji: "🧒", label: "Kid" },
  { emoji: "🧙", label: "Mystic" },
  { emoji: "🏃", label: "Runner" },
];

const BACKGROUND_THEMES = [
  { id: "temple", label: "Temple", color: "🟤" },
  { id: "forest", label: "Forest", color: "🟢" },
  { id: "ocean", label: "Ocean", color: "🔵" },
  { id: "sunset", label: "Sunset", color: "🟠" },
  { id: "royal", label: "Royal", color: "🟣" },
  { id: "night", label: "Night", color: "⚫" },
];

const keyOf = (p) => `${p.r},${p.c}`;
const same = (a, b) => a.r === b.r && a.c === b.c;
const manhattan = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const inBounds = (p) => p.r >= 0 && p.r < GRID_SIZE && p.c >= 0 && p.c < GRID_SIZE;

function parseParticipantId(value) {
  const trimmed = value.trim().replace(/\s+/g, " ");

  // Valid examples:
  // Vinay07 -> VI
  // Vinay Kumar07 -> VK
  // Invalid examples:
  // 123, Vinay, Vinay Kumar, 07Vinay, Vinay 07, Vinay07 Kumar
  const match = trimmed.match(/^([A-Za-z]+)(?:\s+([A-Za-z]+))?(\d+)$/);

  if (!match) {
    return {
      isValid: false,
      initials: "",
      normalizedId: trimmed,
    };
  }

  const firstWord = match[1];
  const secondWord = match[2] || "";
  const number = match[3];

  const initials = secondWord
    ? `${firstWord[0]}${secondWord[0]}`.toUpperCase()
    : firstWord.slice(0, 2).toUpperCase();

  return {
    isValid: true,
    initials,
    normalizedId: secondWord
      ? `${firstWord} ${secondWord}${number}`
      : `${firstWord}${number}`,
  };
}

function isValidAge(value) {
  const ageNumber = Number(value);
  return Number.isInteger(ageNumber) && ageNumber > 0 && ageNumber <= 120;
}

function getSuggestedEmoji(age, gender) {
  const ageNumber = Number(age);
  const normalizedGender = String(gender || "").toLowerCase();

  if (!Number.isFinite(ageNumber) || !age) return "🧑";

  if (normalizedGender === "male") return ageNumber < 18 ? "👦" : "👨";
  if (normalizedGender === "female") return ageNumber < 18 ? "👧" : "👩";

  return ageNumber < 18 ? "🧒" : "🧑";
}

function neighbors(pos, walls) {
  return DIRS.map((d) => ({
    r: pos.r + d.dr,
    c: pos.c + d.dc,
    move: d.name,
    icon: d.icon,
  })).filter((p) => inBounds(p) && !walls.has(keyOf(p)));
}

function shortestPathExists(start, goal, walls) {
  const q = [start];
  const seen = new Set([keyOf(start)]);

  while (q.length > 0) {
    const current = q.shift();

    if (same(current, goal)) return true;

    for (const n of neighbors(current, walls)) {
      const k = keyOf(n);

      if (!seen.has(k)) {
        seen.add(k);
        q.push(n);
      }
    }
  }

  return false;
}

function createWalls(level, wallCount) {
  const protectedCells = new Set([
    keyOf(PARTICIPANT_START),
    keyOf(AI_START),
    keyOf(GOAL),
  ]);

  for (let attempts = 0; attempts < 700; attempts++) {
    const walls = new Set();
    const midCol = 3 + ((level + Math.floor(Math.random() * 3)) % 3);

    for (let r = 1; r < GRID_SIZE - 1; r++) {
      if (Math.random() < 0.55) walls.add(`${r},${midCol}`);
    }

    while (walls.size < wallCount) {
      const p = {
        r: Math.floor(Math.random() * GRID_SIZE),
        c: Math.floor(Math.random() * GRID_SIZE),
      };

      const k = keyOf(p);

      if (!protectedCells.has(k)) walls.add(k);
    }

    if (
      shortestPathExists(PARTICIPANT_START, GOAL, walls) &&
      shortestPathExists(AI_START, PARTICIPANT_START, walls)
    ) {
      return walls;
    }
  }

  return new Set();
}

function aiMoveOptions(ai, participant, walls, difficultySettings) {
  const opts = neighbors(ai, walls).map((p) => ({
    ...p,
    label: p.move,
    distanceToPlayer: manhattan(p, participant),
  }));

  if (opts.length === 0) return [];

  opts.sort((a, b) => a.distanceToPlayer - b.distanceToPlayer);

  const top = opts.slice(0, 2);

  if (top.length === 1) return [{ ...top[0], probability: 100 }];

  const firstScore = Math.max(1, 10 - top[0].distanceToPlayer);
  const secondScore = Math.max(1, 10 - top[1].distanceToPlayer);
  const total = firstScore + secondScore;

  let p1 = Math.round((firstScore / total) * 100);
  p1 = Math.max(difficultySettings.aiMin, Math.min(difficultySettings.aiMax, p1));

  return [
    { ...top[0], probability: p1 },
    { ...top[1], probability: 100 - p1 },
  ];
}

function guardianPreview(aiOptions) {
  if (!aiOptions.length) {
    return {
      captureChance: 0,
      alternativeChance: 100,
      captureLabel: "No route",
      alternativeLabel: "Wait",
    };
  }

  const captureOption = aiOptions[0];
  const alternativeOption = aiOptions[1];

  return {
    captureChance: captureOption.probability,
    alternativeChance: alternativeOption ? alternativeOption.probability : 0,
    captureLabel: captureOption.label,
    alternativeLabel: alternativeOption ? alternativeOption.label : "None",
  };
}

function chooseWeighted(options) {
  if (options.length === 0) return null;

  const roll = Math.random() * 100;
  let total = 0;

  for (const opt of options) {
    total += opt.probability;

    if (roll <= total) return opt;
  }

  return options[options.length - 1];
}

function possiblePlayerMoves(player, ai, walls) {
  return neighbors(player, walls).map((p) => ({
    ...p,
    distanceToGoal: manhattan(p, GOAL),
    distanceFromAI: manhattan(p, ai),
    risk:
      manhattan(p, ai) <= 2
        ? "High"
        : manhattan(p, ai) <= 4
          ? "Medium"
          : "Low",
  }));
}

function possibleDiceMoves(player, ai, walls, diceValue) {
  if (!diceValue || diceValue < 1) return [];

  let frontier = [{ pos: player, path: [] }];

  for (let step = 0; step < diceValue; step++) {
    const nextFrontier = [];

    for (const item of frontier) {
      for (const n of neighbors(item.pos, walls)) {
        const alreadyVisited = item.path.some((p) => p.r === n.r && p.c === n.c);

        if (alreadyVisited) continue;

        nextFrontier.push({
          pos: { r: n.r, c: n.c },
          path: [...item.path, n],
        });
      }
    }

    frontier = nextFrontier;
  }

  const uniqueTargets = new Map();

  for (const item of frontier) {
    const k = keyOf(item.pos);

    if (same(item.pos, player)) continue;

    if (!uniqueTargets.has(k)) {
      uniqueTargets.set(k, item);
    }
  }

  return Array.from(uniqueTargets.values()).map((item) => {
    const route = item.path.map((p) => p.move).join(" → ");
    const final = item.pos;

    return {
      r: final.r,
      c: final.c,
      move: route,
      icon: "🎲",
      stepsMoved: diceValue,
      distanceToGoal: manhattan(final, GOAL),
      distanceFromAI: manhattan(final, ai),
      risk:
        manhattan(final, ai) <= 2
          ? "High"
          : manhattan(final, ai) <= 4
            ? "Medium"
            : "Low",
    };
  });
}


function possibleGuardianDiceMoves(guardian, participantTarget, walls, diceValue) {
  if (!diceValue || diceValue < 1) return [];

  let frontier = [{ pos: guardian, path: [] }];
  const allRoutes = [];

  for (let step = 0; step < diceValue; step++) {
    const nextFrontier = [];

    for (const item of frontier) {
      for (const n of neighbors(item.pos, walls)) {
        const alreadyVisited = item.path.some((p) => p.r === n.r && p.c === n.c);

        if (alreadyVisited) continue;

        const nextItem = {
          pos: { r: n.r, c: n.c },
          path: [...item.path, n],
        };

        nextFrontier.push(nextItem);
        allRoutes.push(nextItem);
      }
    }

    frontier = nextFrontier;

    if (frontier.length === 0) break;
  }

  const uniqueTargets = new Map();

  for (const item of allRoutes) {
    const k = keyOf(item.pos);

    if (!uniqueTargets.has(k)) {
      uniqueTargets.set(k, item);
    }
  }

  return Array.from(uniqueTargets.values())
    .map((item) => {
      const final = item.pos;

      return {
        r: final.r,
        c: final.c,
        move: item.path.map((p) => p.move).join(" → "),
        stepsMoved: item.path.length,
        distanceToPlayer: manhattan(final, participantTarget),
        isCapture: same(final, participantTarget),
      };
    })
    .sort((a, b) => {
      if (a.isCapture && !b.isCapture) return -1;
      if (!a.isCapture && b.isCapture) return 1;
      return a.distanceToPlayer - b.distanceToPlayer;
    });
}

function chooseGuardianRoute(routes) {
  if (!routes.length) return null;

  const captureRoute = routes.find((route) => route.isCapture);

  if (captureRoute && Math.random() < 0.85) {
    return captureRoute;
  }

  const topRoutes = routes.slice(0, 2);

  if (topRoutes.length === 1) return topRoutes[0];

  return Math.random() < 0.75 ? topRoutes[0] : topRoutes[1];
}


function shortestDistance(start, goal, walls) {
  if (same(start, goal)) return 0;

  const q = [{ pos: start, distance: 0 }];
  const seen = new Set([keyOf(start)]);

  while (q.length > 0) {
    const current = q.shift();

    for (const n of neighbors(current.pos, walls)) {
      const k = keyOf(n);

      if (seen.has(k)) continue;
      if (same(n, goal)) return current.distance + 1;

      seen.add(k);
      q.push({ pos: { r: n.r, c: n.c }, distance: current.distance + 1 });
    }
  }

  return 999;
}

function getBlockingScore(position, participant, walls) {
  const participantGoalDistance = shortestDistance(participant, GOAL, walls);
  const participantToGuardianDistance = shortestDistance(participant, position, walls);
  const guardianToGoalDistance = shortestDistance(position, GOAL, walls);

  return participantToGuardianDistance + guardianToGoalDistance + Math.abs(guardianToGoalDistance - participantGoalDistance);
}

function chooseGuardianProtectRoute(routes, participantTarget, walls) {
  if (!routes.length) {
    return {
      route: null,
      strategy: "No route",
      captureChance: 0,
      blockChance: 0,
      alternativeChance: 100,
    };
  }

  const captureRoutes = routes.filter((route) => route.isCapture);
  const defensiveRoutes = routes
    .map((route) => ({
      ...route,
      blockingScore: getBlockingScore({ r: route.r, c: route.c }, participantTarget, walls),
    }))
    .sort((a, b) => a.blockingScore - b.blockingScore || a.distanceToPlayer - b.distanceToPlayer);

  if (captureRoutes.length > 0) {
    const shouldCapture = Math.random() < 0.75;

    return {
      route: shouldCapture ? captureRoutes[0] : defensiveRoutes[0],
      strategy: shouldCapture ? "Capture" : "Protect goal path",
      captureChance: 75,
      blockChance: 25,
      alternativeChance: 0,
    };
  }

  const shouldBlock = Math.random() < 0.8;
  const topAlternative = routes
    .slice()
    .sort((a, b) => a.distanceToPlayer - b.distanceToPlayer)[0];

  return {
    route: shouldBlock ? defensiveRoutes[0] : topAlternative,
    strategy: shouldBlock ? "Protect goal path" : "Move closer",
    captureChance: 0,
    blockChance: 80,
    alternativeChance: 20,
  };
}

function downloadCSV(rows) {
  const headers = [
    "sessionId",
    "participantId",
    "participantInitials",
    "age",
    "gender",
    "participantEmoji",
    "backgroundTheme",
    "difficulty",
    "mode",
    "game",
    "turn",
    "diceRoll",
    "stepsMoved",
    "capturedThisTurn",
    "captureCount",
    "participantResetToStart",
    "guardianCaptureChance",
    "guardianAlternativeChance",
    "guardianDiceRoll",
    "guardianStepsMoved",
    "guardianMoveRoute",
    "guardianStrategy",
    "participantRow",
    "participantCol",
    "aiRow",
    "aiCol",
    "participantMove",
    "aiPreview",
    "aiChosenMove",
    "risk",
    "goalDistance",
    "aiDistance",
    "reactionTimeMs",
    "reactionTimeSeconds",
    "totalElapsedMs",
    "totalElapsedSeconds",
    "result",
    "roundWinner",
    "roundEndReason",
    "timestamp",
  ];

  const csv = [headers.join(",")]
    .concat(rows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(",")))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `Ancient_Escape_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const [participantId, setParticipantId] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Prefer not to say");
  const [selectedEmoji, setSelectedEmoji] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("temple");
  const [difficulty, setDifficulty] = useState("Normal");
  const [mode, setMode] = useState("Experiment");
  const [game, setGame] = useState(1);
  const [turn, setTurn] = useState(1);
  const [walls, setWalls] = useState(() => createWalls(1, DIFFICULTY.Normal.wallCount));
  const [player, setPlayer] = useState(PARTICIPANT_START);
  const [ai, setAi] = useState(AI_START);
  const [message, setMessage] = useState("Roll the dice to reveal your movement options.");
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [lastRoundWinner, setLastRoundWinner] = useState("");
  const [lastRoundReason, setLastRoundReason] = useState("");
  const [lastRoundGame, setLastRoundGame] = useState(null);
  const [modal, setModal] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [isAdminRoute] = useState(() => window.location.pathname === "/admin");
  const [adminUser, setAdminUser] = useState(null);
  const [adminRows, setAdminRows] = useState([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [turnStartedAt, setTurnStartedAt] = useState(Date.now());
  const [gameStartedAt, setGameStartedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [sessionId, setSessionId] = useState(() => `AE-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
  const [onlineSaveStatus, setOnlineSaveStatus] = useState("Ready");
  const [onlineRoomCode, setOnlineRoomCode] = useState("");
  const [joinRoomCode, setJoinRoomCode] = useState("");
  const [onlineRole, setOnlineRole] = useState("");
  const [onlineRoomStatus, setOnlineRoomStatus] = useState("");
  const [onlineRoomData, setOnlineRoomData] = useState(null);
  const [copiedRoomLink, setCopiedRoomLink] = useState(false);
  const [diceValue, setDiceValue] = useState(null);
  const [hasRolled, setHasRolled] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [guardianDiceValue, setGuardianDiceValue] = useState(null);
  const [lastGuardianMove, setLastGuardianMove] = useState("Waiting");

  const settings = DIFFICULTY[difficulty];
  const totalGames = mode === "Practice" ? 1 : GAMES_PER_SESSION;
  const aiOptions = useMemo(() => aiMoveOptions(ai, player, walls, settings), [ai, player, walls, settings]);
  const guardianStats = useMemo(() => guardianPreview(aiOptions), [aiOptions]);
  const playerOptions = useMemo(
    () => (hasRolled && diceValue ? possibleDiceMoves(player, ai, walls, diceValue) : []),
    [player, ai, walls, hasRolled, diceValue]
  );
  const progress = Math.min(100, Math.round((turn / settings.maxTurns) * 100));
  const currentReactionSeconds = Math.round((now - turnStartedAt) / 1000);
  const totalElapsedSeconds = Math.round((now - gameStartedAt) / 1000);

  const participantInfo = parseParticipantId(participantId);
  const participantIdValid = participantInfo.isValid;
  const participantInitials = participantInfo.initials;
  const ageValid = isValidAge(age);
  const canStart = participantIdValid && ageValid;
  const suggestedEmoji = getSuggestedEmoji(age, gender);
  const participantEmoji = selectedEmoji || suggestedEmoji;

  const adminStats = useMemo(() => {
    const sessionIds = new Set(adminRows.map((row) => row.sessionId).filter(Boolean));
    const participantIds = new Set(adminRows.map((row) => row.participantId).filter(Boolean));
    const finalRows = adminRows.filter((row) => ["escaped", "caught", "timeout"].includes(row.result));
    const escapes = finalRows.filter((row) => row.result === "escaped").length;
    const failed = finalRows.filter((row) => row.result === "caught" || row.result === "timeout").length;
    const reactionValues = adminRows
      .map((row) => Number(row.reactionTimeMs))
      .filter((value) => Number.isFinite(value));

    const avgReactionMs = reactionValues.length
      ? Math.round(reactionValues.reduce((sum, value) => sum + value, 0) / reactionValues.length)
      : 0;

    return {
      totalMoves: adminRows.length,
      totalSessions: sessionIds.size,
      totalParticipants: participantIds.size,
      escapes,
      failed,
      avgReactionSeconds: (avgReactionMs / 1000).toFixed(2),
    };
  }, [adminRows]);

  useEffect(() => {
    const unsubscribe = listenToAuth((user) => {
      setAdminUser(user);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromLink = params.get("room");

    if (roomFromLink) {
      setJoinRoomCode(roomFromLink.trim().toUpperCase());
      setModal("online");
    }
  }, []);

  useEffect(() => {
    if (!onlineRoomCode) return;

    const unsubscribe = listenOnlineRoom(onlineRoomCode, (room) => {
      setOnlineRoomData(room);

      if (room?.gameState) {
        setGame(room.gameState.game || 1);
        setTurn(room.gameState.turn || 1);
        setPlayer(room.gameState.player || PARTICIPANT_START);
        setAi(room.gameState.ai || AI_START);
        setWalls(new Set(room.gameState.walls || []));
        setDiceValue(room.gameState.diceValue || null);
        setHasRolled(Boolean(room.gameState.hasRolled));
        setResult(room.gameState.result || null);
        setMessage(room.gameState.message || "Online game synced.");
      }

      if (room?.status === "ready" && screen === "onlineWaiting") {
        setScreen("game");
      }

      if (room?.status === "ready" && modal === "onlineRoom") {
        setModal(null);
        setScreen("game");
      }
    });

    return () => unsubscribe();
  }, [onlineRoomCode, screen, modal]);

  useEffect(() => {
    if (logs.length === 0) return;

    const savedSessions = JSON.parse(localStorage.getItem("ancientEscapeSessions") || "[]");
    const filteredSessions = savedSessions.filter((session) => session.sessionId !== sessionId);

    const updatedSession = {
      sessionId,
      participantId: participantInfo.normalizedId,
      participantInitials,
      age,
      gender,
      participantEmoji,
      backgroundTheme: selectedTheme,
      difficulty,
      mode,
      savedAt: new Date().toISOString(),
      rows: logs,
    };

    localStorage.setItem("ancientEscapeSessions", JSON.stringify([...filteredSessions, updatedSession]));
  }, [
    logs,
    sessionId,
    participantId,
    participantInfo.normalizedId,
    participantInitials,
    age,
    gender,
    participantEmoji,
    selectedTheme,
    difficulty,
    mode,
  ]);

  function resetLevel(nextGame = game) {
    setGame(nextGame);
    setTurn(1);
    setWalls(createWalls(nextGame, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
    setMessage("Roll the dice to reveal your movement options.");
    setDiceValue(null);
    setHasRolled(false);
    setGuardianDiceValue(null);
    setLastGuardianMove("Waiting");
    setTurnStartedAt(Date.now());
  }

  function startSession(selectedMode = "Experiment") {
    if (!canStart) {
      setModal("validation");
      return;
    }

    setMode(selectedMode);
    setSessionId(`AE-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    setLogs([]);
    setWins(0);
    setLosses(0);
    setCaptureCount(0);
    setLastRoundWinner("");
    setLastRoundReason("");
    setLastRoundGame(null);
    setTurn(1);
    setGame(1);
    setWalls(createWalls(1, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
    setDiceValue(null);
    setHasRolled(false);
    setGuardianDiceValue(null);
    setLastGuardianMove("Waiting");
    setGameStartedAt(Date.now());
    setTurnStartedAt(Date.now());

    if (selectedMode === "Experiment") {
      setScreen("consent");
    } else {
      setScreen("instructions");
    }
  }

  function beginGame() {
    setTurn(1);
    setGame(1);
    setWalls(createWalls(1, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
    setDiceValue(null);
    setHasRolled(false);
    setGuardianDiceValue(null);
    setLastGuardianMove("Waiting");
    setMessage("Roll the dice to reveal your movement options.");
    setGameStartedAt(Date.now());
    setTurnStartedAt(Date.now());
    setScreen("game");
  }

  function finishGame(status) {
    setResult(status);

    let winner = "";
    let reason = "";
    let finalMessage = "";

    if (status === "escaped") {
      winner = "Participant";
      reason = `${participantInitials} reached the goal`;
      finalMessage = `${participantInitials} reached the goal and wins Round ${game}!`;
      setWins((w) => w + 1);
    } else if (status === "participant_killed_guardian") {
      winner = "Participant";
      reason = `${participantInitials} captured the Guardian`;
      finalMessage = `${participantInitials} captured the Guardian and wins Round ${game}!`;
      setWins((w) => w + 1);
    } else if (status === "guardian_killed_participant") {
      winner = "Guardian";
      reason = `Guardian captured ${participantInitials}`;
      finalMessage = `Guardian captured ${participantInitials} and wins Round ${game}!`;
      setLosses((l) => l + 1);
    } else {
      winner = "Guardian";
      reason = "Guardian protected the temple until the turn limit";
      finalMessage = `Guardian protected the temple and wins Round ${game}!`;
      setLosses((l) => l + 1);
    }

    setLastRoundWinner(winner);
    setLastRoundReason(reason);
    setLastRoundGame(game);
    setMessage(finalMessage);
    setScreen("roundComplete");
  }

  function continueAfterRound() {
    if (game >= totalGames) {
      setScreen("summary");
      return;
    }

    resetLevel(game + 1);
    setScreen("game");
  }

  function quitSession() {
    setScreen("summary");
  }

  async function rollDice() {
    if (result || screen !== "game" || hasRolled) return;

    const roll = Math.floor(Math.random() * 6) + 1;
    const rollMessage = `${participantInitials || "Player"} rolled ${roll}. Choose one highlighted route.`;

    setDiceValue(roll);
    setHasRolled(true);
    setTurnStartedAt(Date.now());
    setMessage(rollMessage);

    if (onlineRoomCode) {
      await updateOnlineRoom(onlineRoomCode, {
        status: "ready",
        lastActionBy: onlineRole || "player",
        gameState: {
          game,
          turn,
          player,
          ai,
          walls: Array.from(walls),
          diceValue: roll,
          hasRolled: true,
          result,
          message: rollMessage,
        },
      });
    }
  }

  async function movePlayer(target) {
    if (result || screen !== "game" || !hasRolled || !diceValue) return;

    const moveTime = Date.now();
    const reactionTimeMs = moveTime - turnStartedAt;
    const totalElapsedMs = moveTime - gameStartedAt;

    const nextPlayerBeforeGuardian = { r: target.r, c: target.c };

    let finalPlayer = nextPlayerBeforeGuardian;
    let nextAi = ai;
    let status = "playing";
    let roundWinner = "";
    let roundEndReason = "";
    let aiChosenMove = "No move";
    let capturedThisTurn = false;
    let participantResetToStart = false;
    let nextCaptureCount = captureCount;
    let guardianDiceRoll = 0;
    let guardianStepsMoved = 0;
    let guardianMoveRoute = "Guardian did not move";
    let guardianStrategy = "Waiting";
    let guardianCaptureChance = 0;
    let guardianAlternativeChance = 100;
    let aiPreview = "Guardian did not move";

    // Participant can capture/kill Guardian by landing on Guardian.
    // In that case the round ends immediately and participant wins the round.
    if (same(nextPlayerBeforeGuardian, ai)) {
      status = "participant_killed_guardian";
      roundWinner = "Participant";
      roundEndReason = "Participant captured Guardian";
      aiChosenMove = "None";
      guardianStrategy = "Captured by participant";
      aiPreview = "Participant landed on Guardian. Participant wins this round.";
      setGuardianDiceValue(null);
      setLastGuardianMove("Captured by participant");
    } else if (same(nextPlayerBeforeGuardian, GOAL)) {
      status = "escaped";
      roundWinner = "Participant";
      roundEndReason = "Participant reached goal";
      aiChosenMove = "None";
      guardianStrategy = "Goal reached";
      aiPreview = "Participant reached the goal. Participant wins this round.";
      setGuardianDiceValue(null);
      setLastGuardianMove("Guardian did not move because goal was reached");
    } else {
      guardianDiceRoll = Math.floor(Math.random() * 6) + 1;
      const guardianRoutes = possibleGuardianDiceMoves(
        ai,
        nextPlayerBeforeGuardian,
        walls,
        guardianDiceRoll
      );

      const guardianDecision = chooseGuardianProtectRoute(
        guardianRoutes,
        nextPlayerBeforeGuardian,
        walls
      );

      const chosenGuardianRoute = guardianDecision.route;
      guardianStrategy = guardianDecision.strategy;
      guardianCaptureChance = guardianDecision.captureChance;
      guardianAlternativeChance = guardianDecision.alternativeChance;

      if (chosenGuardianRoute) {
        nextAi = { r: chosenGuardianRoute.r, c: chosenGuardianRoute.c };
        aiChosenMove = chosenGuardianRoute.move || "Move";
        guardianStepsMoved = chosenGuardianRoute.stepsMoved || 0;
        guardianMoveRoute = chosenGuardianRoute.move || "Move";

        // Guardian captures/kills Participant by landing on Participant.
        // The round ends immediately and Guardian wins the round.
        if (same(nextAi, nextPlayerBeforeGuardian)) {
          capturedThisTurn = true;
          nextCaptureCount = captureCount + 1;
          status = "guardian_killed_participant";
          roundWinner = "Guardian";
          roundEndReason = "Guardian captured participant";
          guardianStrategy = "Capture";
        }

        setGuardianDiceValue(guardianDiceRoll);
        setLastGuardianMove(guardianMoveRoute);
      } else {
        setGuardianDiceValue(guardianDiceRoll);
        setLastGuardianMove("No route available");
      }

      if (status === "playing" && turn >= settings.maxTurns) {
        status = "timeout";
        roundWinner = "Guardian";
        roundEndReason = "Guardian protected temple until turn limit";
      }

      aiPreview =
        guardianCaptureChance > 0
          ? `Guardian rolled ${guardianDiceRoll}. Capture ${guardianCaptureChance}% | Protect goal ${guardianDecision.blockChance}%`
          : `Guardian rolled ${guardianDiceRoll}. Protect goal ${guardianDecision.blockChance}% | Move closer ${guardianAlternativeChance}%`;
    }

    const row = {
      sessionId,
      participantId: participantInfo.normalizedId,
      participantInitials,
      age,
      gender,
      participantEmoji,
      backgroundTheme: selectedTheme,
      difficulty,
      mode,
      game,
      turn,
      diceRoll: diceValue,
      stepsMoved: target.stepsMoved || diceValue,
      capturedThisTurn,
      captureCount: nextCaptureCount,
      participantResetToStart,
      guardianCaptureChance,
      guardianAlternativeChance,
      guardianDiceRoll,
      guardianStepsMoved,
      guardianMoveRoute,
      guardianStrategy,
      participantRow: finalPlayer.r,
      participantCol: finalPlayer.c,
      aiRow: nextAi.r,
      aiCol: nextAi.c,
      participantMove: target.move,
      aiPreview,
      aiChosenMove,
      risk: target.risk,
      goalDistance: target.distanceToGoal,
      aiDistance: target.distanceFromAI,
      reactionTimeMs,
      reactionTimeSeconds: (reactionTimeMs / 1000).toFixed(2),
      totalElapsedMs,
      totalElapsedSeconds: (totalElapsedMs / 1000).toFixed(2),
      result: status,
      roundWinner,
      roundEndReason,
      timestamp: new Date().toISOString(),
    };

    setLogs((oldLogs) => [...oldLogs, row]);
    setPlayer(finalPlayer);
    setAi(nextAi);
    setCaptureCount(nextCaptureCount);
    setTurn((t) => t + 1);
    setDiceValue(null);
    setHasRolled(false);
    setTurnStartedAt(Date.now());

    if (onlineRoomCode) {
      await updateOnlineRoom(onlineRoomCode, {
        status: status === "playing" ? "ready" : "finished",
        lastActionBy: onlineRole || "player",
        gameState: {
          game,
          turn: turn + 1,
          player: finalPlayer,
          ai: nextAi,
          walls: Array.from(walls),
          diceValue: null,
          hasRolled: false,
          result: status,
          message:
            status === "playing"
              ? `${participantInitials} moved. Roll again.`
              : roundEndReason,
        },
      });
    }

    setOnlineSaveStatus("Saving...");

    saveMoveToFirebase(row).then((saved) => {
      setOnlineSaveStatus(saved ? "Saved online" : "Local only");
    });

    if (status !== "playing") {
      finishGame(status);
    } else if (guardianStrategy === "Protect goal path") {
      setMessage(
        `${participantInitials} moved ${target.stepsMoved || diceValue} steps. Guardian rolled ${guardianDiceRoll} and moved to protect the goal path. Roll again.`
      );
    } else {
      setMessage(
        `${participantInitials} moved ${target.stepsMoved || diceValue} steps. Guardian rolled ${guardianDiceRoll} and moved ${guardianStepsMoved} step${guardianStepsMoved === 1 ? "" : "s"}. Roll again.`
      );
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      const dir = DIRS.find((d) => d.key === e.key);

      if (!dir) return;

      const target = playerOptions.find((o) => o.move === dir.name);

      if (target) movePlayer(target);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [playerOptions, result, screen]);

  async function createRoomAndShare() {
    if (!canStart) {
      setModal("validation");
      return;
    }

    try {
      const startingWalls = createWalls(1, settings.wallCount);

      const roomCode = await createOnlineRoom({
        host: {
          participantId: participantInfo.normalizedId,
          initials: participantInitials,
          emoji: participantEmoji,
          age,
          gender,
        },
        difficulty,
        selectedTheme,
        gameState: {
          game: 1,
          turn: 1,
          player: PARTICIPANT_START,
          ai: AI_START,
          walls: Array.from(startingWalls),
          diceValue: null,
          hasRolled: false,
          result: null,
          message: "Waiting for second player to join.",
        },
      });

      setOnlineRoomCode(roomCode);
      setOnlineRole("host");
      setOnlineRoomStatus("Room created. Share the room code or link with your friend.");
      setCopiedRoomLink(false);
      setModal("onlineRoom");
    } catch (error) {
      console.error(error);
      setOnlineRoomStatus("Unable to create online room. Check Firebase rules.");
    }
  }

  async function joinRoom() {
    if (!canStart) {
      setModal("validation");
      return;
    }

    if (!joinRoomCode.trim()) {
      setOnlineRoomStatus("Enter a room code first.");
      return;
    }

    try {
      const roomCode = await joinOnlineRoom(joinRoomCode, {
        participantId: participantInfo.normalizedId,
        initials: participantInitials,
        emoji: participantEmoji,
        age,
        gender,
      });

      setOnlineRoomCode(roomCode);
      setOnlineRole("guest");
      setOnlineRoomStatus("Joined room successfully.");
      setModal(null);
      setScreen("onlineWaiting");
    } catch (error) {
      console.error(error);
      setOnlineRoomStatus("Room not found or already full.");
    }
  }

  function copyRoomLink() {
    const roomLink = `${window.location.origin}${window.location.pathname}?room=${onlineRoomCode}`;
    navigator.clipboard.writeText(roomLink);
    setCopiedRoomLink(true);
  }

  function downloadAdminRows() {
    if (adminRows.length === 0) {
      alert("No Firebase records loaded yet.");
      return;
    }

    downloadCSV(adminRows);
  }

  async function loadAdminRows() {
    setAdminError("");
    setAdminLoading(true);

    try {
      const rows = await getAllMoveRecords();
      setAdminRows(rows);
    } catch (error) {
      console.error("Admin load failed:", error);
      setAdminError("Unable to load Firebase data. Check login and Firestore rules.");
    } finally {
      setAdminLoading(false);
    }
  }

  async function handleAdminSignIn() {
    setAdminError("");

    try {
      const user = await signInAdmin();

      if (!isAdminUser(user)) {
        setAdminError("This Google account is not allowed to access the admin dashboard.");
        await signOutAdmin();
        return;
      }

      await loadAdminRows();
    } catch (error) {
      console.error("Admin sign-in failed:", error);
      setAdminError("Admin sign-in failed.");
    }
  }

  function downloadSavedSessions() {
    const savedSessions = JSON.parse(localStorage.getItem("ancientEscapeSessions") || "[]");
    const allRows = savedSessions.flatMap((session) => session.rows || []);

    if (allRows.length === 0) {
      alert("No saved session data found on this device yet.");
      return;
    }

    downloadCSV(allRows);
  }

  function clearSavedSessions() {
    const confirmClear = window.confirm("Clear all Ancient Escape saved data from this device?");

    if (!confirmClear) return;

    localStorage.removeItem("ancientEscapeSessions");
    alert("Saved data cleared from this device.");
  }

  function sendFeedback() {
    const subject = encodeURIComponent("Ancient Escape Feedback");
    const body = encodeURIComponent(feedback || "Feedback about Ancient Escape:");

    window.location.href = `mailto:pavulurivinay@gmail.com?subject=${subject}&body=${body}`;
  }

  function cellContent(r, c) {
    const p = { r, c };

    if (same(p, player)) return participantEmoji;
    if (same(p, ai)) return "🛡️";
    if (same(p, GOAL)) return "🏁";

    return "";
  }

  if (isAdminRoute) {
    const allowedAdmin = isAdminUser(adminUser);

    return (
      <div className="page adminPage">
        <div className="adminShell premiumPanel lightPanel">
          <div className="adminHeader">
            <div>
              <div className="badge darkBadge">Admin Dashboard</div>
              <h1>Ancient Escape Data</h1>
              <p>View Firebase records and export gameplay data.</p>
            </div>

            <button className="secondaryButton" onClick={() => window.location.href = "/"}>
              Back to App
            </button>
          </div>

          {!adminUser && (
            <div className="adminLoginBox">
              <h2>Admin Login Required</h2>
              <p>Sign in with the authorized Google account to view collected data.</p>
              <button className="primaryButton" onClick={handleAdminSignIn}>
                Sign in with Google
              </button>
            </div>
          )}

          {adminUser && !allowedAdmin && (
            <div className="adminLoginBox dangerBox">
              <h2>Access Denied</h2>
              <p>{adminUser.email} is not allowed to access this dashboard.</p>
              <button className="secondaryButton" onClick={signOutAdmin}>
                Sign out
              </button>
            </div>
          )}

          {adminUser && allowedAdmin && (
            <>
              <div className="adminUserRow">
                <span>
                  Signed in as <b>{adminUser.email}</b>
                </span>

                <div className="buttonRow adminActions">
                  <button className="primaryButton" onClick={loadAdminRows} disabled={adminLoading}>
                    {adminLoading ? "Loading..." : "Refresh Data"}
                  </button>

                  <button className="secondaryButton" onClick={downloadAdminRows}>
                    Download CSV
                  </button>

                  <button className="secondaryButton" onClick={signOutAdmin}>
                    Sign Out
                  </button>
                </div>
              </div>

              <div className="adminStatsGrid">
                <div><strong>{adminStats.totalMoves}</strong><span>Total Moves</span></div>
                <div><strong>{adminStats.totalSessions}</strong><span>Sessions</span></div>
                <div><strong>{adminStats.totalParticipants}</strong><span>Participants</span></div>
                <div><strong>{adminStats.escapes}</strong><span>Participant Wins</span></div>
                <div><strong>{adminStats.failed}</strong><span>Caught / Timeout</span></div>
                <div><strong>{adminStats.avgReactionSeconds}s</strong><span>Avg Reaction</span></div>
              </div>

              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>Participant</th>
                      <th>Mode</th>
                      <th>Difficulty</th>
                      <th>Game</th>
                      <th>Turn</th>
                      <th>Move</th>
                      <th>Guardian Move</th>
                      <th>Risk</th>
                      <th>Reaction</th>
                      <th>Result</th>
                    </tr>
                  </thead>

                  <tbody>
                    {adminRows.slice(0, 100).map((row) => (
                      <tr key={row.id}>
                        <td>{row.participantId}</td>
                        <td>{row.mode}</td>
                        <td>{row.difficulty}</td>
                        <td>{row.game}</td>
                        <td>{row.turn}</td>
                        <td>{row.participantMove}</td>
                        <td>{row.aiChosenMove}</td>
                        <td>{row.risk}</td>
                        <td>{row.reactionTimeSeconds}s</td>
                        <td>{row.result}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {adminRows.length > 100 && (
                <p className="adminNote">
                  Showing latest 100 rows. Use Download CSV for all loaded records.
                </p>
              )}
            </>
          )}

          {adminError && <div className="adminError">{adminError}</div>}
        </div>
      </div>
    );
  }

  if (screen === "onlineWaiting") {
    return (
      <div className="page centerPage">
        <div className="summaryCard premiumPanel lightPanel">
          <div className="badge darkBadge">Online Multiplayer</div>
          <h1>Waiting Room</h1>

          <p>
            Room Code: <b>{onlineRoomCode}</b>
          </p>

          <p>{onlineRoomStatus || "Waiting for the other player to join..."}</p>

          {onlineRoomData?.host && (
            <p>
              Host: <b>{onlineRoomData.host.initials}</b>
            </p>
          )}

          {onlineRoomData?.guest && (
            <p>
              Guest: <b>{onlineRoomData.guest.initials}</b>
            </p>
          )}

          <button className="secondaryButton" onClick={() => setScreen("welcome")}>
            Back Home
          </button>
        </div>
      </div>
    );
  }

  if (screen === "welcome") {
    return (
      <div className="homePage">
        <div className="homeOverlay" />

        <button className="settingsButton" onClick={() => setModal("settings")}>
          ⚙️
        </button>

        <main className="homeContent">
          <div className="logoBlock">
            <h1>ANCIENT ESCAPE</h1>
            <p>INDIAN STRATEGY BATTLE</p>
          </div>

          <section className="installCard">
            <h2>Download Ancient Escape</h2>
            <p>Install the game to your home screen for the best full-screen experience.</p>
            <div className="installHint">
              👆 Tap browser menu, then choose <b>Install App</b> or <b>Add to Home Screen</b>
            </div>
          </section>

          <section className="quickSetup">
            <div className="inputGroup">
              <input
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value)}
                placeholder="Participant ID, example Vinay07 or Vinay Kumar07"
                required
              />

              {participantId.trim() && !participantIdValid && (
                <div className="fieldError">
                  Participant ID must be word + number or two words + number. Example: Vinay07 or Vinay Kumar07.
                </div>
              )}

              {participantIdValid && (
                <div className="fieldSuccess">
                  Initials: {participantInitials}
                </div>
              )}
            </div>

            <div className="compactRow">
              <div className="inputGroup">
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="Age"
                  required
                />

                {age.trim() && !ageValid && (
                  <div className="fieldError">
                    Age is mandatory and must be between 1 and 120.
                  </div>
                )}
              </div>

              <div className="inputGroup">
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                  <option>Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="emojiPicker">
              <div className="emojiPickerTitle">Choose your character</div>
              <div className="emojiOptions">
                {PLAYER_EMOJIS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={participantEmoji === item.emoji ? "emojiChoice activeEmoji" : "emojiChoice"}
                    onClick={() => setSelectedEmoji(item.emoji)}
                    title={item.label}
                  >
                    <span>{item.emoji}</span>
                    <small>{item.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="themePicker">
              <div className="emojiPickerTitle">Choose game background</div>
              <div className="themeOptions">
                {BACKGROUND_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    className={selectedTheme === theme.id ? "themeChoice activeTheme" : "themeChoice"}
                    onClick={() => setSelectedTheme(theme.id)}
                  >
                    <span>{theme.color}</span>
                    <small>{theme.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="difficultyPills">
              {Object.keys(DIFFICULTY).map((d) => (
                <button
                  key={d}
                  className={difficulty === d ? "active" : ""}
                  onClick={() => setDifficulty(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </section>

          <div className="homeButtons">
            <button className="mainPlayButton" onClick={() => startSession("Experiment")} disabled={!canStart}>
              🧠 Play Now
            </button>

            <button className="menuButton" onClick={() => setModal("online")}>
              👥 Online Multiplayer
            </button>

            <button className="menuButton" onClick={() => startSession("Practice")} disabled={!canStart}>
              🤖 Practice with Guardian
            </button>

            <div className="twoButtonRow">
              <button className="menuButton smallMenu" onClick={() => setModal("feedback")}>
                💬 Feedback
              </button>

              <button className="menuButton smallMenu" onClick={() => setModal("learn")}>
                📖 Learn
              </button>

              <button className="menuButton smallMenu" onClick={() => setModal("savedData")}>
                💾 Saved Data
              </button>
            </div>
          </div>
        </main>

        {modal && (
          <div className="modalOverlay" onClick={() => setModal(null)}>
            <div className="modalCard" onClick={(e) => e.stopPropagation()}>
              {modal === "validation" && (
                <>
                  <h2>Missing Required Details</h2>
                  <p>Please enter a valid Participant ID and Age before starting.</p>
                  <p><b>Participant ID examples:</b> Vinay07 or Vinay Kumar07.</p>
                  <p><b>Age:</b> enter a number between 1 and 120.</p>
                </>
              )}

              {modal === "online" && (
                <>
                  <h2>Online Multiplayer</h2>
                  <p>
                    Create a Firebase room and share the room code with your friend, or join an existing room.
                  </p>

                  <button className="primaryButton" onClick={createRoomAndShare}>
                    Create Online Room
                  </button>

                  <div style={{ marginTop: "18px" }}>
                    <input
                      value={joinRoomCode}
                      onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
                      placeholder="Enter room code"
                      style={{
                        width: "100%",
                        padding: "12px",
                        borderRadius: "12px",
                        border: "1px solid #c5a74a",
                        marginBottom: "10px",
                      }}
                    />

                    <button className="secondaryButton" onClick={joinRoom}>
                      Join Room
                    </button>
                  </div>

                  {onlineRoomStatus && (
                    <p style={{ fontWeight: 800, color: "#9b3d3a" }}>
                      {onlineRoomStatus}
                    </p>
                  )}
                </>
              )}

              {modal === "onlineRoom" && (
                <>
                  <h2>Room Created</h2>

                  <p>Share this room code or link with your friend.</p>

                  <div className="installHint">
                    Room Code: <b>{onlineRoomCode}</b>
                  </div>

                  <button className="primaryButton" onClick={copyRoomLink}>
                    Copy Room Link
                  </button>

                  {copiedRoomLink && (
                    <p style={{ fontWeight: 800, color: "#1f7a3f" }}>
                      Room link copied!
                    </p>
                  )}

                  <p>Waiting for another player to join...</p>
                </>
              )}

              {modal === "feedback" && (
                <>
                  <h2>Send Feedback</h2>
                  <p>Write feedback, then send it through your email app.</p>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Type your feedback here..."
                  />
                  <button className="primaryButton" onClick={sendFeedback}>
                    Send Feedback
                  </button>
                </>
              )}

              {modal === "learn" && (
                <>
                  <h2>How to Play</h2>
                  <p>
                    Reach 🏁 while avoiding the Guardian 🛡️. If the Guardian captures you, Guardian wins that round.
                  </p>
                  <p>Roll the dice, choose a route, and try to capture Guardian or reach the goal before Guardian captures you.</p>
                  <p>You can use highlighted cells, move buttons, or keyboard arrow keys.</p>
                </>
              )}

              {modal === "settings" && (
                <>
                  <h2>Game Settings</h2>
                  <p>Difficulty controls wall count, turn limit, and Guardian chase strength.</p>
                  <div className="difficultyPills modalPills">
                    {Object.keys(DIFFICULTY).map((d) => (
                      <button
                        key={d}
                        className={difficulty === d ? "active" : ""}
                        onClick={() => setDifficulty(d)}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {modal === "savedData" && (
                <>
                  <h2>Saved Data</h2>
                  <p>Ancient Escape now automatically saves gameplay rows on this device after each move.</p>
                  <p>You can download all saved sessions from this browser, or clear saved data after exporting.</p>
                  <div className="buttonRow modalButtonRow">
                    <button className="primaryButton" onClick={downloadSavedSessions}>
                      Download Saved CSV
                    </button>

                    <button className="secondaryButton" onClick={clearSavedSessions}>
                      Clear Saved Data
                    </button>
                  </div>
                </>
              )}

              <button className="secondaryButton modalClose" onClick={() => setModal(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === "consent") {
    return (
      <div className="page centerPage">
        <div className="flowCard premiumPanel lightPanel">
          <div className="badge darkBadge">Participant Consent</div>
          <h1>Before You Begin</h1>
          <p>
            You are about to take part in Ancient Escape, a decision-making strategy task. The game records
            your moves, Guardian probability previews, difficulty, result, and timestamps for each turn.
          </p>

          <div className="consentBox">
            <label className="checkLine"><input type="checkbox" /> I understand this is a game-based task.</label>
            <label className="checkLine"><input type="checkbox" /> I understand my gameplay data may be exported as CSV.</label>
            <label className="checkLine"><input type="checkbox" /> I am ready to continue to the instructions.</label>
          </div>

          <div className="buttonRow">
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>Back</button>
            <button className="primaryButton" onClick={() => setScreen("instructions")}>I Agree & Continue</button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "instructions") {
    return (
      <div className="page centerPage">
        <div className="flowCard premiumPanel lightPanel">
          <div className="badge darkBadge">How to Play</div>
          <h1>{mode === "Practice" ? "Practice Round" : "Experiment Instructions"}</h1>

          <div className="instructionGrid">
            <div><strong>{participantEmoji} Your role</strong><span>Move through the maze and reach the goal.</span></div>
            <div><strong>🏁 Goal</strong><span>Escape before the Guardian catches you.</span></div>
            <div><strong>🛡️ Guardian</strong><span>If you land on Guardian, you win the round. If Guardian lands on you, Guardian wins the round.</span></div>
            <div><strong>📊 Probability</strong><span>Two likely Guardian moves are shown before you choose.</span></div>
            <div><strong>⚠️ Risk</strong><span>Some faster routes may be more dangerous.</span></div>
            <div><strong>🎲 Dice</strong><span>Roll the dice, then choose one highlighted route.</span></div>
          </div>

          <div className="flowNote">
            {mode === "Practice"
              ? "Practice mode runs one game only and helps users understand the rules before the main task."
              : "Experiment mode runs three games and saves detailed move-by-move data for CSV export."}
          </div>

          <div className="buttonRow">
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>Back Home</button>
            <button className="primaryButton" onClick={beginGame}>
              {mode === "Practice" ? "Start Practice" : "Start Experiment"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "roundComplete") {
    const hasNextRound = game < totalGames;

    return (
      <div className="page centerPage">
        <div className="roundCompleteCard premiumPanel lightPanel">
          <div className="badge darkBadge">Round {lastRoundGame || game} Complete</div>
          <h1>{lastRoundWinner} Wins This Round</h1>
          <p className="roundReason">{lastRoundReason}</p>

          <div className="roundWinnerPanel">
            <div>
              <span>Round Winner</span>
              <strong>{lastRoundWinner}</strong>
            </div>
            <div>
              <span>Current Score</span>
              <strong>{participantInitials || "Participant"} {wins} - {losses} Guardian</strong>
            </div>
          </div>

          <div className="buttonRow">
            {hasNextRound ? (
              <button className="primaryButton" onClick={continueAfterRound}>
                Continue to Round {game + 1}
              </button>
            ) : (
              <button className="primaryButton" onClick={() => setScreen("summary")}>
                View Final Results
              </button>
            )}

            <button className="secondaryButton" onClick={quitSession}>
              Quit Game
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "summary") {
    return (
      <div className="page centerPage">
        <div className="summaryCard premiumPanel lightPanel">
          <div className="badge darkBadge">🏁 Session Complete</div>
          <h1>Ancient Escape Results</h1>
          <p>{mode} mode complete for {participantInfo.normalizedId || "Practice Player"}.</p>

          <div className="scoreGrid">
            <div className="scoreBox winBox"><strong>{wins}</strong><span>Participant Wins</span></div>
            <div className="scoreBox lossBox"><strong>{losses}</strong><span>Guardian Wins</span></div>
            <div className="scoreBox captureSummaryBox"><strong>{captureCount}</strong><span>Guardian Captures</span></div>
          </div>

          <div className="buttonRow">
            <button className="primaryButton" onClick={() => downloadCSV(logs)}>Download Current CSV</button>
            <button className="secondaryButton" onClick={downloadSavedSessions}>Download Saved Data</button>
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`page gamePage gameTheme-${selectedTheme}`}>
      <main className="gameLayout">
        <section className="boardCard premiumPanel lightPanel">
          <div className="gameHeader">
            <div>
              <div className="smallCaps">{mode} Mode</div>
              <h1>Temple Maze</h1>
              <p>Game {game} of {totalGames} · Turn {turn} of {settings.maxTurns} · {difficulty}</p>
              <p className="timerLine">⏱️ Total: {totalElapsedSeconds}s · Current decision: {currentReactionSeconds}s</p>
              <p className="saveStatusLine">☁️ Online save: {onlineSaveStatus}</p>
            </div>

            <button className="secondaryButton" onClick={() => resetLevel(game)}>Restart Level</button>
          </div>

          <div className="progressTrack"><div style={{ width: `${progress}%` }} /></div>
          <div className="messageBox">{message}</div>

          <div className="dicePanel">
            <div className="diceDisplay">{diceValue || "🎲"}</div>
            <button className="diceButton" onClick={rollDice} disabled={hasRolled || !!result}>
              {hasRolled ? "Choose a route" : "Roll Dice"}
            </button>
            <p>
              {hasRolled
                ? `Move exactly ${diceValue} block${diceValue === 1 ? "" : "s"} using one highlighted option.`
                : "Roll first. Your movement options will appear after the dice roll."}
            </p>
          </div>

          <div className="grid" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}>
            {Array.from({ length: GRID_SIZE }).map((_, r) =>
              Array.from({ length: GRID_SIZE }).map((_, c) => {
                const isWall = walls.has(`${r},${c}`);
                const isGoal = same({ r, c }, GOAL);
                const isPlayer = same({ r, c }, player);
                const isAi = same({ r, c }, ai);
                const moveOption = playerOptions.find((o) => o.r === r && o.c === c);

                let className = "cell";
                if (isWall) className += " wall";
                if (isGoal) className += " goal";
                if (isPlayer) className += " player";
                if (isAi) className += " guardian";
                if (moveOption) className += " option";

                return (
                  <button
                    key={`${r}-${c}`}
                    onClick={() => moveOption && movePlayer(moveOption)}
                    disabled={!moveOption || !!result}
                    className={className}
                  >
                    {cellContent(r, c)}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <aside className="sidePanel">
          <section className="panelCard premiumPanel darkPanel">
            <h2>Guardian Protection Strategy</h2>
            <p>After {participantInitials || "the participant"} moves, Guardian rolls automatically. Whoever captures wins the round.</p>

            <div className="guardianDicePanel">
              <div className="guardianDiceValue">{guardianDiceValue || "🎲"}</div>
              <div>
                <strong>Last Guardian roll</strong>
                <span>{guardianDiceValue ? `Guardian rolled ${guardianDiceValue}` : "Waiting for participant move"}</span>
              </div>
            </div>

            <div className="probBox captureBox">
              <div className="probHeader">
                <span>🛡️ Capture route</span>
                <b>{guardianStats.captureChance}%</b>
              </div>
              <div className="bar"><div style={{ width: `${guardianStats.captureChance}%` }} /></div>
            </div>

            <div className="probBox">
              <div className="probHeader">
                <span>🏁 Protect goal path</span>
                <b>{guardianStats.alternativeChance}%</b>
              </div>
              <div className="bar"><div style={{ width: `${guardianStats.alternativeChance}%` }} /></div>
            </div>

            <div className="captureCountBox">
              Captures this session: <b>{captureCount}</b>
            </div>

            <div className="guardianMoveBox">
              Last move: <b>{lastGuardianMove}</b>
            </div>
          </section>

          <section className="panelCard premiumPanel lightPanel">
            <h2>{participantInitials || "Your"} Dice Routes</h2>

            {!hasRolled && <p>Roll the dice to see available routes.</p>}
            {hasRolled && playerOptions.length === 0 && <p>No valid route available for this dice roll. Restart level or roll again after this rule is adjusted.</p>}

            {playerOptions.map((o) => (
              <button key={`${o.r},${o.c}`} onClick={() => movePlayer(o)} className="moveButton">
                <span><b>{o.icon} {o.move}</b></span>
                <span className={`risk ${o.risk.toLowerCase()}`}>{o.risk} risk</span>
                <small>Steps: {o.stepsMoved} · Goal distance: {o.distanceToGoal} · Guardian distance: {o.distanceFromAI}</small>
              </button>
            ))}
          </section>

          <section className="panelCard premiumPanel lightPanel legend">
            <h2>Legend</h2>
            <p>{participantEmoji} {participantInitials || "Participant"}</p>
            <p>🛡️ Guardian</p>
            <p>🏁 Escape Goal</p>
            <p><span className="miniWall" /> Blocked Path</p>

            {lastRoundWinner && (
              <div className="previousRoundBox">
                <span>Previous Round</span>
                <strong>{lastRoundWinner} won Round {lastRoundGame}</strong>
                <small>{lastRoundReason}</small>
              </div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
