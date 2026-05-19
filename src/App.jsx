import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

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

const keyOf = (p) => `${p.r},${p.c}`;
const same = (a, b) => a.r === b.r && a.c === b.c;
const manhattan = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const inBounds = (p) => p.r >= 0 && p.r < GRID_SIZE && p.c >= 0 && p.c < GRID_SIZE;

const DIRS = [
  { name: "Up", dr: -1, dc: 0, key: "ArrowUp", icon: "↑" },
  { name: "Down", dr: 1, dc: 0, key: "ArrowDown", icon: "↓" },
  { name: "Left", dr: 0, dc: -1, key: "ArrowLeft", icon: "←" },
  { name: "Right", dr: 0, dc: 1, key: "ArrowRight", icon: "→" },
];

function neighbors(pos, walls) {
  return DIRS.map((d) => ({ r: pos.r + d.dr, c: pos.c + d.dc, move: d.name, icon: d.icon }))
    .filter((p) => inBounds(p) && !walls.has(keyOf(p)));
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
  const protectedCells = new Set([keyOf(PARTICIPANT_START), keyOf(AI_START), keyOf(GOAL)]);
  for (let attempts = 0; attempts < 700; attempts++) {
    const walls = new Set();
    const midCol = 3 + ((level + Math.floor(Math.random() * 3)) % 3);
    for (let r = 1; r < GRID_SIZE - 1; r++) {
      if (Math.random() < 0.55) walls.add(`${r},${midCol}`);
    }
    while (walls.size < wallCount) {
      const p = { r: Math.floor(Math.random() * GRID_SIZE), c: Math.floor(Math.random() * GRID_SIZE) };
      const k = keyOf(p);
      if (!protectedCells.has(k)) walls.add(k);
    }
    if (shortestPathExists(PARTICIPANT_START, GOAL, walls) && shortestPathExists(AI_START, PARTICIPANT_START, walls)) {
      return walls;
    }
  }
  return new Set();
}

function aiMoveOptions(ai, participant, walls, difficultySettings) {
  const opts = neighbors(ai, walls).map((p) => ({ ...p, label: p.move, distanceToPlayer: manhattan(p, participant) }));
  if (opts.length === 0) return [];
  opts.sort((a, b) => a.distanceToPlayer - b.distanceToPlayer);
  const top = opts.slice(0, 2);
  if (top.length === 1) return [{ ...top[0], probability: 100 }];

  const firstScore = Math.max(1, 10 - top[0].distanceToPlayer);
  const secondScore = Math.max(1, 10 - top[1].distanceToPlayer);
  const total = firstScore + secondScore;
  let p1 = Math.round((firstScore / total) * 100);
  p1 = Math.max(difficultySettings.aiMin, Math.min(difficultySettings.aiMax, p1));
  return [{ ...top[0], probability: p1 }, { ...top[1], probability: 100 - p1 }];
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
    risk: manhattan(p, ai) <= 2 ? "High" : manhattan(p, ai) <= 4 ? "Medium" : "Low",
  }));
}

function downloadCSV(rows) {
  const headers = ["participantId", "age", "gender", "difficulty", "mode", "game", "turn", "participantRow", "participantCol", "aiRow", "aiCol", "participantMove", "aiPreview", "aiChosenMove", "risk", "goalDistance", "aiDistance", "reactionTimeMs", "reactionTimeSeconds", "totalElapsedMs", "totalElapsedSeconds", "result", "timestamp"];
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
  const [difficulty, setDifficulty] = useState("Normal");
  const [mode, setMode] = useState("Experiment");
  const [game, setGame] = useState(1);
  const [turn, setTurn] = useState(1);
  const [walls, setWalls] = useState(() => createWalls(1, DIFFICULTY.Normal.wallCount));
  const [player, setPlayer] = useState(PARTICIPANT_START);
  const [ai, setAi] = useState(AI_START);
  const [message, setMessage] = useState("Study the guardian preview, then choose your route.");
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [modal, setModal] = useState(null);
  const [feedback, setFeedback] = useState("");
  const [turnStartedAt, setTurnStartedAt] = useState(Date.now());
  const [gameStartedAt, setGameStartedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());

  const settings = DIFFICULTY[difficulty];
  const totalGames = mode === "Practice" ? 1 : GAMES_PER_SESSION;
  const aiOptions = useMemo(() => aiMoveOptions(ai, player, walls, settings), [ai, player, walls, settings]);
  const playerOptions = useMemo(() => possiblePlayerMoves(player, ai, walls), [player, ai, walls]);
  const progress = Math.min(100, Math.round((turn / settings.maxTurns) * 100));
  const currentReactionSeconds = Math.round((now - turnStartedAt) / 1000);
  const totalElapsedSeconds = Math.round((now - gameStartedAt) / 1000);

  function resetLevel(nextGame = game) {
    setGame(nextGame);
    setTurn(1);
    setWalls(createWalls(nextGame, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
    setMessage("Study the guardian preview, then choose your route.");
    setTurnStartedAt(Date.now());
  }

  function startSession(selectedMode = "Experiment") {
    setMode(selectedMode);
    setLogs([]);
    setWins(0);
    setLosses(0);
    setTurn(1);
    setGame(1);
    setWalls(createWalls(1, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
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
    setMessage("Study the guardian preview, then choose your route.");
    setGameStartedAt(Date.now());
    setTurnStartedAt(Date.now());
    setScreen("game");
  }

  function finishGame(status) {
    setResult(status);
    if (status === "escaped") {
      setWins((w) => w + 1);
      setMessage("Victory! You escaped the ancient maze.");
    } else if (status === "caught") {
      setLosses((l) => l + 1);
      setMessage("The guardian caught you. Analyze the safer route next time.");
    } else {
      setLosses((l) => l + 1);
      setMessage("Turn limit reached. The temple doors closed.");
    }
    setTimeout(() => {
      if (game >= totalGames) setScreen("summary");
      else resetLevel(game + 1);
    }, 1100);
  }

  function movePlayer(target) {
    if (result || screen !== "game") return;

    const moveTime = Date.now();
    const reactionTimeMs = moveTime - turnStartedAt;
    const totalElapsedMs = moveTime - gameStartedAt;

    const aiPreview = aiOptions.map((o) => `${o.label} ${o.probability}%`).join(" | ");
    const chosenAi = chooseWeighted(aiOptions);
    const nextPlayer = { r: target.r, c: target.c };
    let nextAi = ai;
    let status = "playing";
    let aiChosenMove = "None";

    if (same(nextPlayer, GOAL)) status = "escaped";
    else if (chosenAi) {
      nextAi = { r: chosenAi.r, c: chosenAi.c };
      aiChosenMove = chosenAi.label;
      if (same(nextAi, nextPlayer)) status = "caught";
    }
    if (status === "playing" && turn >= settings.maxTurns) status = "timeout";

    const row = {
      participantId,
      age,
      gender,
      difficulty,
      mode,
      game,
      turn,
      participantRow: nextPlayer.r,
      participantCol: nextPlayer.c,
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
      timestamp: new Date().toISOString()
    };
    setLogs((oldLogs) => [...oldLogs, row]);
    setPlayer(nextPlayer);
    setAi(nextAi);
    setTurn((t) => t + 1);
    setTurnStartedAt(Date.now());

    if (status !== "playing") finishGame(status);
    else setMessage(`You moved ${target.move}. Guardian moved ${aiChosenMove}. Choose your next route.`);
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

  function sendFeedback() {
    const subject = encodeURIComponent("Ancient Escape Feedback");
    const body = encodeURIComponent(feedback || "Feedback about Ancient Escape:");
    window.location.href = `mailto:pavulurivinay@gmail.com?subject=${subject}&body=${body}`;
  }

  function cellContent(r, c) {
    const p = { r, c };
    if (same(p, player)) return "🧍";
    if (same(p, ai)) return "🛡️";
    if (same(p, GOAL)) return "🏁";
    return "";
  }

  if (screen === "welcome") {
    return (
      <div className="homePage">
        <div className="homeOverlay" />
        <button className="settingsButton" onClick={() => setModal("settings")}>⚙️</button>

        <main className="homeContent">
          <div className="logoBlock">
            <h1>ANCIENT ESCAPE</h1>
            <p>INDIAN STRATEGY BATTLE</p>
          </div>

          <section className="installCard">
            <h2>Download Ancient Escape</h2>
            <p>Install the game to your home screen for the best full-screen experience.</p>
            <div className="installHint">👆 Tap browser menu, then choose <b>Install App</b> or <b>Add to Home Screen</b></div>
          </section>

          <section className="quickSetup">
            <input value={participantId} onChange={(e) => setParticipantId(e.target.value)} placeholder="Participant ID" />
            <div className="compactRow">
              <input value={age} onChange={(e) => setAge(e.target.value)} placeholder="Age" />
              <select value={gender} onChange={(e) => setGender(e.target.value)}>
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
                <option>Prefer not to say</option>
              </select>
            </div>
            <div className="difficultyPills">
              {Object.keys(DIFFICULTY).map((d) => <button key={d} className={difficulty === d ? "active" : ""} onClick={() => setDifficulty(d)}>{d}</button>)}
            </div>
          </section>

          <div className="homeButtons">
            <button className="mainPlayButton" onClick={() => startSession("Experiment")} disabled={!participantId.trim()}>🧠 Play Now</button>
            <button className="menuButton" onClick={() => setModal("online")}>👥 Online Multiplayer</button>
            <button className="menuButton" onClick={() => startSession("Practice")}>🤖 Practice with AI</button>
            <div className="twoButtonRow">
              <button className="menuButton smallMenu" onClick={() => setModal("feedback")}>💬 Feedback</button>
              <button className="menuButton smallMenu" onClick={() => setModal("learn")}>📖 Learn</button>
            </div>
          </div>
        </main>

        {modal && (
          <div className="modalOverlay" onClick={() => setModal(null)}>
            <div className="modalCard" onClick={(e) => e.stopPropagation()}>
              {modal === "online" && <>
                <h2>Online Multiplayer</h2>
                <p>This button is ready on the home screen. True live multiplayer needs a backend room system, such as Firebase or Supabase.</p>
                <p>For now, share your current app link with friends so they can play the same version.</p>
                <button className="primaryButton" onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy App Link</button>
              </>}
              {modal === "feedback" && <>
                <h2>Send Feedback</h2>
                <p>Write feedback, then send it through your email app.</p>
                <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Type your feedback here..." />
                <button className="primaryButton" onClick={sendFeedback}>Send Feedback</button>
              </>}
              {modal === "learn" && <>
                <h2>How to Play</h2>
                <p>Reach 🏁 before the guardian 🛡️ catches you. Each turn shows two possible guardian moves and their probabilities.</p>
                <p>Choose the faster path when you want speed, or the safer path when the guardian is close.</p>
                <p>You can use highlighted cells, move buttons, or keyboard arrow keys.</p>
              </>}
              {modal === "settings" && <>
                <h2>Game Settings</h2>
                <p>Difficulty controls wall count, turn limit, and guardian chase strength.</p>
                <div className="difficultyPills modalPills">
                  {Object.keys(DIFFICULTY).map((d) => <button key={d} className={difficulty === d ? "active" : ""} onClick={() => setDifficulty(d)}>{d}</button>)}
                </div>
              </>}
              <button className="secondaryButton modalClose" onClick={() => setModal(null)}>Close</button>
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
            You are about to take part in Ancient Escape, a decision-making strategy task. The game records your moves, guardian probability previews, difficulty, result, and timestamps for each turn.
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
            <div><strong>🧍 Your role</strong><span>Move through the maze and reach the goal.</span></div>
            <div><strong>🏁 Goal</strong><span>Escape before the guardian catches you.</span></div>
            <div><strong>🛡️ Guardian</strong><span>The guardian moves after every participant move.</span></div>
            <div><strong>📊 Probability</strong><span>Two likely guardian moves are shown before you choose.</span></div>
            <div><strong>⚠️ Risk</strong><span>Some faster routes may be more dangerous.</span></div>
            <div><strong>🎮 Controls</strong><span>Use highlighted cells, move cards, or arrow keys.</span></div>
          </div>
          <div className="flowNote">
            {mode === "Practice"
              ? "Practice mode runs one game only and helps users understand the rules before the main task."
              : "Experiment mode runs three games and saves detailed move-by-move data for CSV export."}
          </div>
          <div className="buttonRow">
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>Back Home</button>
            <button className="primaryButton" onClick={beginGame}>{mode === "Practice" ? "Start Practice" : "Start Experiment"}</button>
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
          <p>{mode} mode complete for {participantId || "Practice Player"}.</p>
          <div className="scoreGrid">
            <div className="scoreBox winBox"><strong>{wins}</strong><span>Escapes</span></div>
            <div className="scoreBox lossBox"><strong>{losses}</strong><span>Caught / Timeout</span></div>
          </div>
          <div className="buttonRow">
            <button className="primaryButton" onClick={() => downloadCSV(logs)}>Download CSV</button>
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page gamePage">
      <main className="gameLayout">
        <section className="boardCard premiumPanel lightPanel">
          <div className="gameHeader">
            <div>
              <div className="smallCaps">{mode} Mode</div>
              <h1>Temple Maze</h1>
              <p>Game {game} of {totalGames} · Turn {turn} of {settings.maxTurns} · {difficulty}</p>
              <p className="timerLine">⏱️ Total: {totalElapsedSeconds}s · Current decision: {currentReactionSeconds}s</p>
            </div>
            <button className="secondaryButton" onClick={() => resetLevel(game)}>Restart Level</button>
          </div>
          <div className="progressTrack"><div style={{ width: `${progress}%` }} /></div>
          <div className="messageBox">{message}</div>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)` }}>
            {Array.from({ length: GRID_SIZE }).map((_, r) => Array.from({ length: GRID_SIZE }).map((_, c) => {
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
              return <button key={`${r}-${c}`} onClick={() => moveOption && movePlayer(moveOption)} disabled={!moveOption || !!result} className={className}>{cellContent(r, c)}</button>;
            }))}
          </div>
        </section>

        <aside className="sidePanel">
          <section className="panelCard premiumPanel darkPanel">
            <h2>Guardian Probability</h2>
            <p>Shown before participant choice.</p>
            {aiOptions.map((o, index) => <div className="probBox" key={index}><div className="probHeader"><span>{o.icon} {o.label}</span><b>{o.probability}%</b></div><div className="bar"><div style={{ width: `${o.probability}%` }} /></div></div>)}
          </section>
          <section className="panelCard premiumPanel lightPanel">
            <h2>Your Move Options</h2>
            {playerOptions.map((o) => <button key={`${o.r},${o.c}`} onClick={() => movePlayer(o)} className="moveButton"><span><b>{o.icon} {o.move}</b></span><span className={`risk ${o.risk.toLowerCase()}`}>{o.risk} risk</span><small>Goal distance: {o.distanceToGoal} · AI distance: {o.distanceFromAI}</small></button>)}
          </section>
          <section className="panelCard premiumPanel lightPanel legend">
            <h2>Legend</h2>
            <p>🧍 Participant</p><p>🛡️ Guardian AI</p><p>🏁 Escape Goal</p><p><span className="miniWall" /> Blocked Path</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
