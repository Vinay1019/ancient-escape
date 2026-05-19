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

  if (top.length === 1) {
    return [{ ...top[0], probability: 100 }];
  }

  const firstScore = Math.max(1, 10 - top[0].distanceToPlayer);
  const secondScore = Math.max(1, 10 - top[1].distanceToPlayer);
  const total = firstScore + secondScore;

  let p1 = Math.round((firstScore / total) * 100);
  p1 = Math.max(difficultySettings.aiMin, Math.min(difficultySettings.aiMax, p1));
  const p2 = 100 - p1;

  return [
    { ...top[0], probability: p1 },
    { ...top[1], probability: p2 },
  ];
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
  const headers = [
    "participantId",
    "age",
    "gender",
    "difficulty",
    "game",
    "turn",
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
    "result",
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
  const [difficulty, setDifficulty] = useState("Normal");
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
  const [showHelp, setShowHelp] = useState(false);

  const settings = DIFFICULTY[difficulty];
  const aiOptions = useMemo(() => aiMoveOptions(ai, player, walls, settings), [ai, player, walls, settings]);
  const playerOptions = useMemo(() => possiblePlayerMoves(player, ai, walls), [player, ai, walls]);
  const progress = Math.min(100, Math.round((turn / settings.maxTurns) * 100));

  function resetLevel(nextGame = game) {
    setGame(nextGame);
    setTurn(1);
    setWalls(createWalls(nextGame, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
    setMessage("Study the guardian preview, then choose your route.");
  }

  function startSession() {
    setLogs([]);
    setWins(0);
    setLosses(0);
    setTurn(1);
    setGame(1);
    setWalls(createWalls(1, settings.wallCount));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
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
      if (game >= GAMES_PER_SESSION) {
        setScreen("summary");
      } else {
        resetLevel(game + 1);
      }
    }, 1100);
  }

  function movePlayer(target) {
    if (result || screen !== "game") return;

    const aiPreview = aiOptions.map((o) => `${o.label} ${o.probability}%`).join(" | ");
    const chosenAi = chooseWeighted(aiOptions);

    const nextPlayer = { r: target.r, c: target.c };
    let nextAi = ai;
    let status = "playing";
    let aiChosenMove = "None";

    if (same(nextPlayer, GOAL)) {
      status = "escaped";
    } else if (chosenAi) {
      nextAi = { r: chosenAi.r, c: chosenAi.c };
      aiChosenMove = chosenAi.label;
      if (same(nextAi, nextPlayer)) status = "caught";
    }

    if (status === "playing" && turn >= settings.maxTurns) {
      status = "timeout";
    }

    const row = {
      participantId,
      age,
      gender,
      difficulty,
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
      result: status,
      timestamp: new Date().toISOString(),
    };

    setLogs((oldLogs) => [...oldLogs, row]);
    setPlayer(nextPlayer);
    setAi(nextAi);
    setTurn((t) => t + 1);

    if (status !== "playing") {
      finishGame(status);
    } else {
      setMessage(`You moved ${target.move}. Guardian moved ${aiChosenMove}. Choose your next route.`);
    }
  }

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

  function cellContent(r, c) {
    const p = { r, c };
    if (same(p, player)) return "🧍";
    if (same(p, ai)) return "🛡️";
    if (same(p, GOAL)) return "🏁";
    return "";
  }

  if (screen === "welcome") {
    return (
      <div className="page welcomePage">
        <div className="templeGlow" />
        <div className="welcomeShell">
          <section className="heroPanel premiumPanel">
            <div>
              <div className="badge">🏛️ Ancient Decision-Making Experiment</div>
              <h1>Ancient Escape</h1>
              <p className="heroText">
                A browser-based strategy experiment where participants balance speed, safety, and uncertainty while escaping a shifting ancient maze.
              </p>
            </div>

            <div className="featureGrid">
              <div><strong>9×9</strong><span>Dynamic maze</span></div>
              <div><strong>AI</strong><span>Guardian chase</span></div>
              <div><strong>2</strong><span>Move probabilities</span></div>
              <div><strong>CSV</strong><span>Data export</span></div>
            </div>
          </section>

          <section className="setupPanel premiumPanel lightPanel">
            <h2>Participant Setup</h2>
            <p>Enter details and select difficulty before starting.</p>

            <label>
              Participant ID
              <input value={participantId} onChange={(e) => setParticipantId(e.target.value)} placeholder="Example: P001" />
            </label>

            <div className="twoColumnInputs">
              <label>
                Age
                <input value={age} onChange={(e) => setAge(e.target.value)} placeholder="25" />
              </label>

              <label>
                Gender
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option>Female</option>
                  <option>Male</option>
                  <option>Other</option>
                  <option>Prefer not to say</option>
                </select>
              </label>
            </div>

            <div className="difficultyBox">
              <span>Difficulty</span>
              <div className="difficultyButtons">
                {Object.keys(DIFFICULTY).map((d) => (
                  <button key={d} className={difficulty === d ? "activeDifficulty" : ""} onClick={() => setDifficulty(d)}>{d}</button>
                ))}
              </div>
            </div>

            <button className="primaryButton largeButton" onClick={startSession} disabled={!participantId.trim()}>
              Start Experiment
            </button>

            <button className="textButton" onClick={() => setShowHelp(true)}>View instructions</button>
          </section>
        </div>

        {showHelp && (
          <div className="modalOverlay" onClick={() => setShowHelp(false)}>
            <div className="modalCard" onClick={(e) => e.stopPropagation()}>
              <h2>How to Play</h2>
              <p>Reach the goal 🏁 before the guardian 🛡️ catches you.</p>
              <p>Before every move, you will see two possible guardian moves and their probabilities.</p>
              <p>Choose using the highlighted cells, move cards, or keyboard arrow keys.</p>
              <button className="primaryButton" onClick={() => setShowHelp(false)}>Got it</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === "summary") {
    return (
      <div className="page centerPage">
        <div className="summaryCard premiumPanel lightPanel">
          <div className="badge darkBadge">🏁 Session Complete</div>
          <h1>Ancient Escape Results</h1>
          <p>Participant {participantId} completed {GAMES_PER_SESSION} games on {difficulty} difficulty.</p>

          <div className="scoreGrid">
            <div className="scoreBox winBox">
              <strong>{wins}</strong>
              <span>Escapes</span>
            </div>
            <div className="scoreBox lossBox">
              <strong>{losses}</strong>
              <span>Caught / Timeout</span>
            </div>
          </div>

          <div className="buttonRow">
            <button className="primaryButton" onClick={() => downloadCSV(logs)}>Download CSV</button>
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>New Session</button>
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
              <div className="smallCaps">Ancient Escape</div>
              <h1>Temple Maze</h1>
              <p>Game {game} of {GAMES_PER_SESSION} · Turn {turn} of {settings.maxTurns} · {difficulty}</p>
            </div>
            <button className="secondaryButton" onClick={() => resetLevel(game)}>Restart Level</button>
          </div>

          <div className="progressTrack"><div style={{ width: `${progress}%` }} /></div>
          <div className="messageBox">{message}</div>

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
                    title={moveOption ? `${moveOption.move}: Goal distance ${moveOption.distanceToGoal}, risk ${moveOption.risk}` : ""}
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
            <h2>Guardian Probability</h2>
            <p>Shown before participant choice.</p>
            {aiOptions.map((o, index) => (
              <div className="probBox" key={index}>
                <div className="probHeader">
                  <span>{o.icon} {o.label}</span>
                  <b>{o.probability}%</b>
                </div>
                <div className="bar"><div style={{ width: `${o.probability}%` }} /></div>
              </div>
            ))}
          </section>

          <section className="panelCard premiumPanel lightPanel">
            <h2>Your Move Options</h2>
            {playerOptions.length === 0 && <p>No available moves.</p>}
            {playerOptions.map((o) => (
              <button key={`${o.r},${o.c}`} onClick={() => movePlayer(o)} className="moveButton">
                <span><b>{o.icon} {o.move}</b></span>
                <span className={`risk ${o.risk.toLowerCase()}`}>{o.risk} risk</span>
                <small>Goal distance: {o.distanceToGoal} · AI distance: {o.distanceFromAI}</small>
              </button>
            ))}
          </section>

          <section className="panelCard premiumPanel lightPanel legend">
            <h2>Legend</h2>
            <p>🧍 Participant</p>
            <p>🛡️ Guardian AI</p>
            <p>🏁 Escape Goal</p>
            <p><span className="miniWall" /> Blocked Path</p>
            <small>Use highlighted cells, move cards, or keyboard arrow keys.</small>
          </section>
        </aside>
      </main>
    </div>
  );
}
