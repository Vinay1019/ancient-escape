import React, { useMemo, useState } from "react";
import "./App.css";

const GRID_SIZE = 9;
const GAMES_PER_SESSION = 3;
const PARTICIPANT_START = { r: 0, c: 0 };
const AI_START = { r: 0, c: 8 };
const GOAL = { r: 8, c: 4 };
const WALL_COUNT = 18;
const MAX_TURNS = 35;

const keyOf = (p) => `${p.r},${p.c}`;
const same = (a, b) => a.r === b.r && a.c === b.c;
const manhattan = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
const inBounds = (p) => p.r >= 0 && p.r < GRID_SIZE && p.c >= 0 && p.c < GRID_SIZE;

const DIRS = [
  { name: "Up", dr: -1, dc: 0 },
  { name: "Down", dr: 1, dc: 0 },
  { name: "Left", dr: 0, dc: -1 },
  { name: "Right", dr: 0, dc: 1 },
];

function neighbors(pos, walls) {
  return DIRS.map((d) => ({ r: pos.r + d.dr, c: pos.c + d.dc, move: d.name }))
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

function createWalls(level) {
  const protectedCells = new Set([keyOf(PARTICIPANT_START), keyOf(AI_START), keyOf(GOAL)]);

  for (let attempts = 0; attempts < 500; attempts++) {
    const walls = new Set();

    const midCol = 3 + ((level + Math.floor(Math.random() * 3)) % 3);
    for (let r = 1; r < GRID_SIZE - 1; r++) {
      if (Math.random() < 0.55) walls.add(`${r},${midCol}`);
    }

    while (walls.size < WALL_COUNT) {
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

function aiMoveOptions(ai, participant, walls) {
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
  p1 = Math.max(55, Math.min(80, p1));
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
    "game",
    "turn",
    "participantRow",
    "participantCol",
    "aiRow",
    "aiCol",
    "participantMove",
    "aiPreview",
    "aiChosenMove",
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
  const [game, setGame] = useState(1);
  const [turn, setTurn] = useState(1);
  const [walls, setWalls] = useState(() => createWalls(1));
  const [player, setPlayer] = useState(PARTICIPANT_START);
  const [ai, setAi] = useState(AI_START);
  const [message, setMessage] = useState("Choose your move. The guardian preview shows likely AI moves before you decide.");
  const [result, setResult] = useState(null);
  const [logs, setLogs] = useState([]);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);

  const aiOptions = useMemo(() => aiMoveOptions(ai, player, walls), [ai, player, walls]);
  const playerOptions = useMemo(() => possiblePlayerMoves(player, ai, walls), [player, ai, walls]);

  function resetLevel(nextGame = game) {
    setGame(nextGame);
    setTurn(1);
    setWalls(createWalls(nextGame));
    setPlayer(PARTICIPANT_START);
    setAi(AI_START);
    setResult(null);
    setMessage("Choose your move. The guardian preview shows likely AI moves before you decide.");
  }

  function startSession() {
    setLogs([]);
    setWins(0);
    setLosses(0);
    resetLevel(1);
    setScreen("game");
  }

  function finishGame(status) {
    setResult(status);

    if (status === "escaped") {
      setWins((w) => w + 1);
      setMessage("You escaped the ancient maze!");
    } else if (status === "caught") {
      setLosses((l) => l + 1);
      setMessage("The guardian caught you.");
    } else {
      setLosses((l) => l + 1);
      setMessage("Turn limit reached.");
    }

    setTimeout(() => {
      if (game >= GAMES_PER_SESSION) {
        setScreen("summary");
      } else {
        resetLevel(game + 1);
      }
    }, 900);
  }

  function movePlayer(target) {
    if (result) return;

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

    if (status === "playing" && turn >= MAX_TURNS) {
      status = "timeout";
    }

    const row = {
      participantId,
      age,
      gender,
      game,
      turn,
      participantRow: nextPlayer.r,
      participantCol: nextPlayer.c,
      aiRow: nextAi.r,
      aiCol: nextAi.c,
      participantMove: target.move,
      aiPreview,
      aiChosenMove,
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
      setMessage(`You moved ${target.move}. Guardian moved ${aiChosenMove}. Choose your next move.`);
    }
  }

  function cellContent(r, c) {
    const p = { r, c };
    if (same(p, player)) return "🧍";
    if (same(p, ai)) return "🛡️";
    if (same(p, GOAL)) return "🏁";
    if (walls.has(`${r},${c}`)) return "";
    return "";
  }

  if (screen === "welcome") {
    return (
      <div className="page welcomePage">
        <div className="welcomeCard">
          <div className="heroPanel">
            <div className="badge">🏛️ Ancient Strategy Experiment</div>
            <h1>Ancient Escape</h1>
            <p>
              Escape the maze before the guardian catches you. Each turn shows two possible guardian moves with simple probability percentages before you choose your route.
            </p>

            <div className="featureGrid">
              <div>9×9 changing maze</div>
              <div>3 games per session</div>
              <div>AI chase preview</div>
              <div>CSV result export</div>
            </div>
          </div>

          <div className="setupPanel">
            <h2>Participant Setup</h2>
            <p>Enter participant details before starting the game.</p>

            <label>
              Participant ID
              <input value={participantId} onChange={(e) => setParticipantId(e.target.value)} placeholder="Example: P001" />
            </label>

            <label>
              Age
              <input value={age} onChange={(e) => setAge(e.target.value)} placeholder="Example: 25" />
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

            <button className="primaryButton" onClick={startSession} disabled={!participantId.trim()}>
              ▶ Start Ancient Escape
            </button>

            <div className="infoBox">
              <b>Goal:</b> Reach 🏁 before the guardian 🛡️ catches you. Blocked paths are shown as dark cells.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "summary") {
    return (
      <div className="page centerPage">
        <div className="summaryCard">
          <h1>Session Complete</h1>
          <p>Ancient Escape results for participant {participantId}</p>

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
            <button className="primaryButton" onClick={() => downloadCSV(logs)}>⬇ Download CSV</button>
            <button className="secondaryButton" onClick={() => setScreen("welcome")}>↻ New Session</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page gamePage">
      <main className="gameLayout">
        <section className="boardCard">
          <div className="gameHeader">
            <div>
              <h1>Ancient Escape</h1>
              <p>Game {game} of {GAMES_PER_SESSION} · Turn {turn} of {MAX_TURNS}</p>
            </div>
            <button className="secondaryButton" onClick={() => resetLevel(game)}>↻ Restart Level</button>
          </div>

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
          <section className="panelCard">
            <h2>🛡️ Guardian Preview</h2>
            <p>These probabilities are shown before you choose your move.</p>
            {aiOptions.map((o, index) => (
              <div className="probBox" key={index}>
                <div className="probHeader">
                  <span>{o.label}</span>
                  <b>{o.probability}%</b>
                </div>
                <div className="bar"><div style={{ width: `${o.probability}%` }} /></div>
              </div>
            ))}
          </section>

          <section className="panelCard">
            <h2>Your Move Options</h2>
            {playerOptions.length === 0 && <p>No available moves.</p>}
            {playerOptions.map((o) => (
              <button key={`${o.r},${o.c}`} onClick={() => movePlayer(o)} className="moveButton">
                <span><b>{o.move}</b></span>
                <span className={`risk ${o.risk.toLowerCase()}`}>{o.risk} risk</span>
                <small>Goal distance: {o.distanceToGoal} · AI distance: {o.distanceFromAI}</small>
              </button>
            ))}
          </section>

          <section className="panelCard legend">
            <h2>Legend</h2>
            <p>🧍 Participant</p>
            <p>🛡️ Guardian AI</p>
            <p>🏁 Escape Goal</p>
            <p><span className="miniWall" /> Blocked Path</p>
            <small>Click a highlighted adjacent cell or use the move cards.</small>
          </section>
        </aside>
      </main>
    </div>
  );
}
