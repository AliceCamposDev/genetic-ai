import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BrainCircuit, ChartNoAxesCombined, RotateCcw, Sparkles, Target } from "lucide-react";

type TileState = "empty" | "correct" | "present" | "absent";
type Tile = { letter: string; state: TileState };
type Attempt = { word: string; tiles: Tile[] };
type ApiResult = { guess: string; feedback: Array<"correta" | "presente" | "ausente">; won: boolean };
type TrainingResult = { average_attempts: number; win_rate: number; best_attempts: number; worst_attempts: number; generations: number; cases?: SolvedCase[]; message?: string };
type TrainingProgress = { generation: number; total_generations: number; best_fitness: number; average_fitness: number; best_word: string; target_index: number; target_total: number };
type FitnessPoint = { best: number; average: number };
type SolvedCase = { target: string; won: boolean; attempts: number; guesses: Array<{ word: string; feedback: Array<"correta" | "presente" | "ausente"> }> };

const alphabet = "abcdefghijklmnopqrstuvwxyz";
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function App() {
  const [tab, setTab] = useState<"game" | "training">("game");
  const [guess, setGuess] = useState("");
  const [wordLength, setWordLength] = useState<5 | 6 | 7>(5);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState(3000);
  const [vocabularySize, setVocabularySize] = useState(2998);
  const [vocabularySizes, setVocabularySizes] = useState({ 5: 2998, 6: 3000, 7: 3000 });
  const [apiOnline, setApiOnline] = useState(false);
  const [apiError, setApiError] = useState("");
  const [training, setTraining] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [population, setPopulation] = useState(100);
  const [generations, setGenerations] = useState(35);
  const [mutationRate, setMutationRate] = useState(18);
  const [modelTarget, setModelTarget] = useState("");
  const [metric, setMetric] = useState({ average: 0, winRate: 0, best: 0, worst: 0 });
  const [hasTrainingResult, setHasTrainingResult] = useState(false);
  const [fitnessHistory, setFitnessHistory] = useState<FitnessPoint[]>([]);
  const [solvedCases, setSolvedCases] = useState<SolvedCase[]>([]);
  const [progress, setProgress] = useState<TrainingProgress>({ generation: 0, total_generations: 35, best_fitness: 0, average_fitness: 0, best_word: "—", target_index: 0, target_total: 100 });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const trainingId = useRef<string | null>(null);
  const trainingSocket = useRef<WebSocket | null>(null);
  const trainingStartedAt = useRef<number | null>(null);

  const status = attempts.length >= 6 ? "Limite atingido" : attempts.some((attempt) => attempt.tiles.every((tile) => tile.state === "correct")) ? "Resolvido" : "Em andamento";
  const lettersUsed = useMemo(() => new Set(attempts.flatMap((attempt) => attempt.word.split(""))), [attempts]);
  const trainingProgress = Math.min(100, Math.round(
    ((Math.max(progress.target_index - 1, 0) + progress.generation / Math.max(progress.total_generations, 1))
      / Math.max(progress.target_total, 1)) * 100,
  ));
  const efficiency = hasTrainingResult
    ? Math.round(metric.winRate * Math.max(0, 1 - Math.max(metric.average - 1, 0) / 6))
    : trainingProgress;
  const attemptBars = attempts.map((attempt) => Math.max(
    18,
    attempt.tiles.filter((tile) => tile.state === "correct").length * 20
      + attempt.tiles.filter((tile) => tile.state === "present").length * 10,
  ));
  const chartSeries = fitnessHistory.slice(-30);
  const chartValues = chartSeries.flatMap((point) => [point.best, point.average]);
  const chartMin = chartValues.length ? Math.min(...chartValues) : 0;
  const chartMax = chartValues.length ? Math.max(...chartValues) : 1;
  const chartRange = chartMax - chartMin || 1;
  const chartPoint = (value: number, index: number) => ({
    x: chartSeries.length <= 1 ? 50 : (index / (chartSeries.length - 1)) * 100,
    y: 100 - ((value - chartMin) / chartRange) * 86 - 7,
  });
  const bestLine = chartSeries.map((point, index) => {
    const position = chartPoint(point.best, index);
    return `${position.x},${position.y}`;
  }).join(" ");
  const averageLine = chartSeries.map((point, index) => {
    const position = chartPoint(point.average, index);
    return `${position.x},${position.y}`;
  }).join(" ");

  async function createGame(length = wordLength, wordCount = vocabularySize) {
    try {
      const response = await fetch(`${API_URL}/api/game`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ word_length: length }) });
      if (!response.ok) throw new Error("Não foi possível iniciar a partida.");
      const data = await response.json() as { game_id: string };
      setGameId(data.game_id);
      setAttempts([]);
      setCandidates(wordCount);
      setApiOnline(true);
      setApiError("");
    } catch (error) {
      setApiOnline(false);
      setApiError(error instanceof Error ? error.message : "API indisponível. Inicie o servidor Python.");
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${API_URL}/api/health`);
        if (!response.ok) throw new Error("API indisponível.");
        const data = await response.json() as { word_counts: Record<string, number> };
        const counts = { 5: data.word_counts["5"] ?? 0, 6: data.word_counts["6"] ?? 0, 7: data.word_counts["7"] ?? 0 };
        const count = counts[5];
        setVocabularySizes(counts);
        setVocabularySize(count);
        setCandidates(count);
        setApiOnline(true);
        await createGame(5, count);
      } catch {
        setApiOnline(false);
        setApiError("API indisponível. Inicie o servidor Python.");
      }
    })();
  }, []);

  async function submitGuess() {
    const value = normalize(guess);
    if (value.length !== wordLength || attempts.length >= 6 || status === "Resolvido" || !gameId) return;
    try {
      const response = await fetch(`${API_URL}/api/game/${gameId}/guess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guess: value }) });
      const data = await response.json() as { detail?: string; result?: ApiResult; candidates?: number };
      if (!response.ok || !data.result) throw new Error(data.detail ?? "Palpite inválido.");
      const tiles = data.result.feedback.map((state, index) => ({ letter: value[index], state: state === "correta" ? "correct" : state === "presente" ? "present" : "absent" } as Tile));
      setAttempts((current) => [...current, { word: value, tiles }]);
      setCandidates(data.candidates ?? candidates);
      setGuess("");
      setApiError("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Não foi possível enviar o palpite.");
    }
  }

  function resetGame() {
    void createGame();
    setGuess("");
  }

  function changeWordLength(length: 5 | 6 | 7) {
    setWordLength(length);
    setVocabularySize(vocabularySizes[length]);
    setModelTarget("");
    void createGame(length, vocabularySizes[length]);
    setGuess("");
  }

  async function runTraining() {
    if (training) {
      const currentId = trainingId.current;
      trainingSocket.current?.send(JSON.stringify({ type: "stop" }));
      trainingSocket.current?.close();
      if (currentId) await fetch(`${API_URL}/api/training/${currentId}/stop`, { method: "POST" }).catch(() => undefined);
      setTraining(false);
      return;
    }
    setTraining(true);
    setGeneration(0);
    setElapsedSeconds(0);
    setFitnessHistory([]);
    setSolvedCases([]);
    setHasTrainingResult(false);
    const id = crypto.randomUUID();
    trainingId.current = id;
    trainingStartedAt.current = Date.now();
    const socket = new WebSocket(`${API_URL.replace(/^http/, "ws")}/api/training/ws/${id}`);
    trainingSocket.current = socket;
    socket.onopen = () => socket.send(JSON.stringify({ target: normalize(modelTarget) || null, word_length: wordLength, sample_size: modelTarget ? 1 : 100, population_size: population, generations, mutation_rate: mutationRate / 100, seed: Date.now() }));
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data) as TrainingProgress & TrainingResult & { type: string };
      if (data.type === "progress") {
        setProgress({ generation: data.generation, total_generations: data.total_generations, best_fitness: data.best_fitness, average_fitness: data.average_fitness, best_word: data.best_word, target_index: data.target_index, target_total: data.target_total });
        setFitnessHistory((current) => [...current.slice(-29), { best: data.best_fitness, average: data.average_fitness }]);
        setGeneration(data.generation);
        return;
      }
      if (data.type === "complete") {
        setMetric({ average: data.average_attempts, winRate: data.win_rate * 100, best: data.best_attempts, worst: data.worst_attempts });
        setSolvedCases(data.cases ?? []);
        setHasTrainingResult(true);
        setGeneration(data.generations);
        setProgress((current) => ({ ...current, generation: data.generations, target_index: current.target_total }));
        setTraining(false);
        setApiError("");
      }
      if (data.type === "cancelled") {
        setTraining(false);
        setApiError("Treinamento interrompido.");
      }
      if (data.type === "error") {
        setTraining(false);
        setApiError(data.message ?? "A palavra não pôde ser resolvida.");
      }
    };
    socket.onerror = () => {
      setApiOnline(false);
      setTraining(false);
      setApiError("Não foi possível conectar ao fluxo de treinamento.");
    };
    socket.onclose = () => {
      trainingSocket.current = null;
      trainingId.current = null;
    };
  }

  useEffect(() => {
    if (!training) return;
    const timer = window.setInterval(() => {
      if (trainingStartedAt.current) setElapsedSeconds(Math.floor((Date.now() - trainingStartedAt.current) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [training]);

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><BrainCircuit size={20} /></div><div><strong>TERMO</strong><span>GENETIC LAB</span></div></div>
        <nav><button className={tab === "game" ? "nav-active" : ""} onClick={() => setTab("game")}><Target size={16} /> Jogo</button><button className={tab === "training" ? "nav-active" : ""} onClick={() => setTab("training")}><ChartNoAxesCombined size={16} /> Treinamento</button></nav>
        <div className={`live ${apiOnline ? "" : "offline"}`}><i /> {apiOnline ? "SISTEMA ONLINE" : "API OFFLINE"}</div>
      </header>

      <section className="hero">
        <div><p className="eyebrow">LABORATÓRIO DE ALGORITMOS GENÉTICOS</p><h1>{tab === "game" ? "Desafie a máquina." : "Observe a evolução."}</h1><p className="hero-copy">{tab === "game" ? "Jogue uma partida e acompanhe como o solucionador aprende com cada feedback." : "Ajuste os parâmetros e acompanhe a população encontrando a estratégia ideal."}</p></div>
        <div className="hero-stat"><span>{tab === "training" && hasTrainingResult ? "EFICIÊNCIA DO MODELO" : "PROGRESSO DO TREINO"}</span><strong>{tab === "training" ? `${efficiency}%` : generation.toString().padStart(3, "0")}</strong><small>{tab === "training" ? (hasTrainingResult ? `${metric.winRate.toFixed(0)}% de vitórias` : `${Math.max(0, 100 - trainingProgress)}% restante`) : "solver pronto"}</small></div>
      </section>
      {apiError && <div className="api-error">{apiError} <button onClick={() => setApiError("")}>Fechar</button></div>}

      {tab === "game" ? (
        <section className="game-layout">
          <div className="panel board-panel">
            <div className="panel-head"><div><span className="kicker">PARTIDA MANUAL</span><h2>Descubra a palavra</h2></div><button className="icon-btn" onClick={resetGame} title="Nova partida"><RotateCcw size={17} /></button></div>
            <div className="length-selector"><span>TAMANHO</span><button className={wordLength === 5 ? "selected" : ""} onClick={() => changeWordLength(5)}>5 letras</button><button className={wordLength === 6 ? "selected" : ""} onClick={() => changeWordLength(6)}>6 letras</button><button className={wordLength === 7 ? "selected" : ""} onClick={() => changeWordLength(7)}>7 letras</button></div>
            <div className="board">{Array.from({ length: 6 }, (_, row) => {
              const attempt = attempts[row];
              return <div className="row" style={{ gridTemplateColumns: `repeat(${wordLength}, minmax(0, 1fr))` }} key={row}>{Array.from({ length: wordLength }, (_, col) => {
                const tile = attempt?.tiles[col];
                return <div className={`tile ${tile?.state ?? "empty"}`} key={col}>{tile?.letter.toUpperCase() ?? ""}</div>;
              })}</div>;
            })}</div>
            <div className="game-footer"><span>{status === "Resolvido" ? "Excelente! Palavra encontrada." : status === "Limite atingido" ? "Limite de tentativas atingido." : `Use uma palavra de ${wordLength} letras.`}</span><b>{attempts.length}/6</b></div>
            <form className="guess-form" onSubmit={(event) => { event.preventDefault(); submitGuess(); }}><input value={guess} onChange={(event) => setGuess(event.target.value)} maxLength={wordLength} placeholder="Digite seu palpite" /><button type="submit">Verificar</button></form>
            <div className="keyboard">{alphabet.split("").map((letter) => <span className={lettersUsed.has(letter) ? "key-used" : ""} key={letter}>{letter}</span>)}</div>
          </div>
          <aside className="side-column"><div className="panel insight"><div className="panel-head"><div><span className="kicker">FEEDBACK DO AGENTE</span><h3>Estado da população</h3></div><Activity size={18} className="green-icon" /></div><div className="insight-value">{candidates.toLocaleString("pt-BR")} <small>candidatos</small></div><div className="progress"><i style={{ width: `${Math.max(4, 100 - (candidates / 3000) * 100)}%` }} /></div><p>O conjunto de respostas possíveis é atualizado pelo <b>feedback real</b> de cada palpite.</p></div><div className="panel mini-chart"><span className="kicker">QUALIDADE DOS PALPITES</span><div className="bars">{attemptBars.length ? attemptBars.map((height, index) => <i style={{ height: `${height}%` }} className={index === attemptBars.length - 1 ? "bar-hot" : ""} key={`${index}-${height}`} />) : <span className="empty-chart">As tentativas aparecerão aqui</span>}</div><div className="chart-labels"><span>corretas</span><span>presentes</span><span>rodada</span></div></div></aside>
        </section>
      ) : (
        <section className="training-layout">
          <div className="panel training-main"><div className="panel-head"><div><span className="kicker">EVOLUÇÃO EM TEMPO REAL</span><h2>População de soluções</h2></div><button className={`run-btn ${training ? "running" : ""}`} onClick={runTraining}><Sparkles size={16} /> {training ? "Parar treinamento" : modelTarget ? "Resolver palavra" : "Executar treinamento"}</button></div><div className="length-selector training-length"><span>TAMANHO</span><button className={wordLength === 5 ? "selected" : ""} onClick={() => changeWordLength(5)} disabled={training}>5 letras</button><button className={wordLength === 6 ? "selected" : ""} onClick={() => changeWordLength(6)} disabled={training}>6 letras</button><button className={wordLength === 7 ? "selected" : ""} onClick={() => changeWordLength(7)} disabled={training}>7 letras</button></div><div className="target-solver"><label>Palavra para o modelo resolver <span>opcional</span><input value={modelTarget} onChange={(event) => setModelTarget(event.target.value)} maxLength={wordLength} placeholder={wordLength === 7 ? "ex.: durante" : wordLength === 6 ? "ex.: abafar" : "ex.: termo"} disabled={training} /></label><small>{modelTarget ? `O solver será avaliado somente contra esta palavra de ${wordLength} letras.` : `Sem palavra: o solver usará 100 palavras de ${wordLength} letras.`}</small></div><div className="training-live"><div><span>GERAÇÃO</span><strong>{generation} <small>/ {progress.total_generations}</small></strong></div><div><span>ALVOS</span><strong>{progress.target_index} <small>/ {progress.target_total}</small></strong></div><div><span>TEMPO</span><strong>{elapsedSeconds}s</strong></div><div><span>MELHOR PALAVRA</span><strong>{progress.best_word.toUpperCase()}</strong></div></div><div className="training-progress"><i style={{ width: `${trainingProgress}%` }} /></div>                              <div className="training-chart"><div className="chart-heading"><div><strong>Fitness por geração</strong><small>últimas {chartSeries.length} medições</small></div><div className="chart-current"><span>ATUAL</span><b>{progress.best_fitness.toFixed(2)}</b></div></div>{chartSeries.length ? <div className="line-chart"><div className="chart-y-axis"><span>{chartMax.toFixed(1)}</span><span>{(chartMin + chartRange * .5).toFixed(1)}</span><span>{chartMin.toFixed(1)}</span></div><div className="chart-plot"><div className="chart-grid"><i /><i /><i /><i /></div><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Evolução do fitness médio e melhor por geração"><polyline className="chart-line average-line" points={averageLine} /><polyline className="chart-line best-line" points={bestLine} /></svg></div><div className="chart-x-axis"><span>início</span><span>geração {Math.max(1, generation - chartSeries.length + 1)}</span><span>geração {generation}</span></div></div> : <span className="empty-chart">Inicie o treinamento para acompanhar a evolução</span>}</div><div className="legend"><span><i className="dot orange" /> Melhor fitness</span><span><i className="dot teal" /> Fitness médio</span><small>Quanto maior, melhor</small></div></div>
          <aside className="training-side"><div className="metric-grid"><div className="metric-card"><span>MÉDIA DE TENTATIVAS</span><strong>{metric.average ? metric.average.toFixed(2) : "—"}</strong><small>amostra real</small></div><div className="metric-card"><span>TAXA DE VITÓRIA</span><strong>{metric.winRate ? `${metric.winRate.toFixed(1)}%` : "—"}</strong><small className="positive">solver Python</small></div><div className="metric-card"><span>MELHOR / PIOR CASO</span><strong>{metric.best ? `${metric.best} / ${metric.worst}` : "—"}</strong><small>tentativas</small></div></div><div className="panel settings"><div className="panel-head"><h3>Parâmetros</h3><span className="pill">GENÉTICO</span></div><label>População <b>{population}</b><input type="range" min="4" max="200" step="1" value={population} onChange={(event) => setPopulation(Number(event.target.value))} /></label><label>Gerações <b>{generations}</b><input type="range" min="1" max="80" step="1" value={generations} onChange={(event) => setGenerations(Number(event.target.value))} /></label><label>Mutação <b>{mutationRate}%</b><input type="range" min="0" max="50" step="1" value={mutationRate} onChange={(event) => setMutationRate(Number(event.target.value))} /></label></div><div className="panel cases-panel"><div className="panel-head"><div><span className="kicker">VALIDAÇÃO PÓS-TREINO</span><h3>Modelo resolvendo casos</h3></div><span className="pill">{solvedCases.length} casos</span></div>{solvedCases.length ? <div className="cases-list">{solvedCases.map((item, index) => <details className="case" key={`${item.target}-${index}`}><summary><span className="case-status">{item.won ? "✓" : "×"}</span><b>CASO {String(index + 1).padStart(2, "0")}</b><strong>{item.target.toUpperCase()}</strong><small>{item.attempts} tentativas</small></summary><div className="case-guesses">{item.guesses.map((guessItem, guessIndex) => <div className="case-guess" key={`${guessItem.word}-${guessIndex}`}><b>{guessIndex + 1}</b><span>{guessItem.word.toUpperCase()}</span><em>{guessItem.feedback.map((state) => state === "correta" ? "C" : state === "presente" ? "P" : "A").join("")}</em></div>)}</div></details>)}</div> : <p className="empty-cases">Execute um treinamento para liberar casos reais do modelo.</p>}</div></aside>
        </section>
      )}
      <footer><span>WORDLE ENGINE <b>v1.0.0</b></span><span>VOCABULÁRIO <b>{vocabularySize.toLocaleString("pt-BR")} PALAVRAS</b></span><span>MODELO <b>GENETIC-SOLVER</b></span></footer>
    </main>
  );
}

export default App;
