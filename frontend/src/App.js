import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BrainCircuit, ChartNoAxesCombined, RotateCcw, Sparkles, Target } from "lucide-react";
const alphabet = "abcdefghijklmnopqrstuvwxyz";
const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
function normalize(value) {
    return value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");
}
function App() {
    const [tab, setTab] = useState("game");
    const [guess, setGuess] = useState("");
    const [wordLength, setWordLength] = useState(5);
    const [attempts, setAttempts] = useState([]);
    const [gameId, setGameId] = useState(null);
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
    const [fitnessHistory, setFitnessHistory] = useState([]);
    const [solvedCases, setSolvedCases] = useState([]);
    const [progress, setProgress] = useState({ generation: 0, total_generations: 35, best_fitness: 0, average_fitness: 0, best_word: "—", target_index: 0, target_total: 100 });
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const trainingId = useRef(null);
    const trainingSocket = useRef(null);
    const trainingStartedAt = useRef(null);
    const status = attempts.length >= 6 ? "Limite atingido" : attempts.some((attempt) => attempt.tiles.every((tile) => tile.state === "correct")) ? "Resolvido" : "Em andamento";
    const lettersUsed = useMemo(() => new Set(attempts.flatMap((attempt) => attempt.word.split(""))), [attempts]);
    const trainingProgress = Math.min(100, Math.round(((Math.max(progress.target_index - 1, 0) + progress.generation / Math.max(progress.total_generations, 1))
        / Math.max(progress.target_total, 1)) * 100));
    const efficiency = hasTrainingResult
        ? Math.round(metric.winRate * Math.max(0, 1 - Math.max(metric.average - 1, 0) / 6))
        : trainingProgress;
    const attemptBars = attempts.map((attempt) => Math.max(18, attempt.tiles.filter((tile) => tile.state === "correct").length * 20
        + attempt.tiles.filter((tile) => tile.state === "present").length * 10));
    const chartSeries = fitnessHistory.slice(-30);
    const chartValues = chartSeries.flatMap((point) => [point.best, point.average]);
    const chartMin = chartValues.length ? Math.min(...chartValues) : 0;
    const chartMax = chartValues.length ? Math.max(...chartValues) : 1;
    const chartRange = chartMax - chartMin || 1;
    const chartPoint = (value, index) => ({
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
            if (!response.ok)
                throw new Error("Não foi possível iniciar a partida.");
            const data = await response.json();
            setGameId(data.game_id);
            setAttempts([]);
            setCandidates(wordCount);
            setApiOnline(true);
            setApiError("");
        }
        catch (error) {
            setApiOnline(false);
            setApiError(error instanceof Error ? error.message : "API indisponível. Inicie o servidor Python.");
        }
    }
    useEffect(() => {
        void (async () => {
            try {
                const response = await fetch(`${API_URL}/api/health`);
                if (!response.ok)
                    throw new Error("API indisponível.");
                const data = await response.json();
                const counts = { 5: data.word_counts["5"] ?? 0, 6: data.word_counts["6"] ?? 0, 7: data.word_counts["7"] ?? 0 };
                const count = counts[5];
                setVocabularySizes(counts);
                setVocabularySize(count);
                setCandidates(count);
                setApiOnline(true);
                await createGame(5, count);
            }
            catch {
                setApiOnline(false);
                setApiError("API indisponível. Inicie o servidor Python.");
            }
        })();
    }, []);
    async function submitGuess() {
        const value = normalize(guess);
        if (value.length !== wordLength || attempts.length >= 6 || status === "Resolvido" || !gameId)
            return;
        try {
            const response = await fetch(`${API_URL}/api/game/${gameId}/guess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guess: value }) });
            const data = await response.json();
            if (!response.ok || !data.result)
                throw new Error(data.detail ?? "Palpite inválido.");
            const tiles = data.result.feedback.map((state, index) => ({ letter: value[index], state: state === "correta" ? "correct" : state === "presente" ? "present" : "absent" }));
            setAttempts((current) => [...current, { word: value, tiles }]);
            setCandidates(data.candidates ?? candidates);
            setGuess("");
            setApiError("");
        }
        catch (error) {
            setApiError(error instanceof Error ? error.message : "Não foi possível enviar o palpite.");
        }
    }
    function resetGame() {
        void createGame();
        setGuess("");
    }
    function changeWordLength(length) {
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
            if (currentId)
                await fetch(`${API_URL}/api/training/${currentId}/stop`, { method: "POST" }).catch(() => undefined);
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
            const data = JSON.parse(event.data);
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
        if (!training)
            return;
        const timer = window.setInterval(() => {
            if (trainingStartedAt.current)
                setElapsedSeconds(Math.floor((Date.now() - trainingStartedAt.current) / 1000));
        }, 250);
        return () => window.clearInterval(timer);
    }, [training]);
    return (_jsxs("main", { className: "shell", children: [_jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "brand", children: [_jsx("div", { className: "brand-mark", children: _jsx(BrainCircuit, { size: 20 }) }), _jsxs("div", { children: [_jsx("strong", { children: "TERMO" }), _jsx("span", { children: "GENETIC LAB" })] })] }), _jsxs("nav", { children: [_jsxs("button", { className: tab === "game" ? "nav-active" : "", onClick: () => setTab("game"), children: [_jsx(Target, { size: 16 }), " Jogo"] }), _jsxs("button", { className: tab === "training" ? "nav-active" : "", onClick: () => setTab("training"), children: [_jsx(ChartNoAxesCombined, { size: 16 }), " Treinamento"] })] }), _jsxs("div", { className: `live ${apiOnline ? "" : "offline"}`, children: [_jsx("i", {}), " ", apiOnline ? "SISTEMA ONLINE" : "API OFFLINE"] })] }), _jsxs("section", { className: "hero", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "LABORAT\u00D3RIO DE ALGORITMOS GEN\u00C9TICOS" }), _jsx("h1", { children: tab === "game" ? "Desafie a máquina." : "Observe a evolução." }), _jsx("p", { className: "hero-copy", children: tab === "game" ? "Jogue uma partida e acompanhe como o solucionador aprende com cada feedback." : "Ajuste os parâmetros e acompanhe a população encontrando a estratégia ideal." })] }), _jsxs("div", { className: "hero-stat", children: [_jsx("span", { children: tab === "training" && hasTrainingResult ? "EFICIÊNCIA DO MODELO" : "PROGRESSO DO TREINO" }), _jsx("strong", { children: tab === "training" ? `${efficiency}%` : generation.toString().padStart(3, "0") }), _jsx("small", { children: tab === "training" ? (hasTrainingResult ? `${metric.winRate.toFixed(0)}% de vitórias` : `${Math.max(0, 100 - trainingProgress)}% restante`) : "solver pronto" })] })] }), apiError && _jsxs("div", { className: "api-error", children: [apiError, " ", _jsx("button", { onClick: () => setApiError(""), children: "Fechar" })] }), tab === "game" ? (_jsxs("section", { className: "game-layout", children: [_jsxs("div", { className: "panel board-panel", children: [_jsxs("div", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("span", { className: "kicker", children: "PARTIDA MANUAL" }), _jsx("h2", { children: "Descubra a palavra" })] }), _jsx("button", { className: "icon-btn", onClick: resetGame, title: "Nova partida", children: _jsx(RotateCcw, { size: 17 }) })] }), _jsxs("div", { className: "length-selector", children: [_jsx("span", { children: "TAMANHO" }), _jsx("button", { className: wordLength === 5 ? "selected" : "", onClick: () => changeWordLength(5), children: "5 letras" }), _jsx("button", { className: wordLength === 6 ? "selected" : "", onClick: () => changeWordLength(6), children: "6 letras" }), _jsx("button", { className: wordLength === 7 ? "selected" : "", onClick: () => changeWordLength(7), children: "7 letras" })] }), _jsx("div", { className: "board", children: Array.from({ length: 6 }, (_, row) => {
                                    const attempt = attempts[row];
                                    return _jsx("div", { className: "row", style: { gridTemplateColumns: `repeat(${wordLength}, minmax(0, 1fr))` }, children: Array.from({ length: wordLength }, (_, col) => {
                                            const tile = attempt?.tiles[col];
                                            return _jsx("div", { className: `tile ${tile?.state ?? "empty"}`, children: tile?.letter.toUpperCase() ?? "" }, col);
                                        }) }, row);
                                }) }), _jsxs("div", { className: "game-footer", children: [_jsx("span", { children: status === "Resolvido" ? "Excelente! Palavra encontrada." : status === "Limite atingido" ? "Limite de tentativas atingido." : `Use uma palavra de ${wordLength} letras.` }), _jsxs("b", { children: [attempts.length, "/6"] })] }), _jsxs("form", { className: "guess-form", onSubmit: (event) => { event.preventDefault(); submitGuess(); }, children: [_jsx("input", { value: guess, onChange: (event) => setGuess(event.target.value), maxLength: wordLength, placeholder: "Digite seu palpite" }), _jsx("button", { type: "submit", children: "Verificar" })] }), _jsx("div", { className: "keyboard", children: alphabet.split("").map((letter) => _jsx("span", { className: lettersUsed.has(letter) ? "key-used" : "", children: letter }, letter)) })] }), _jsxs("aside", { className: "side-column", children: [_jsxs("div", { className: "panel insight", children: [_jsxs("div", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("span", { className: "kicker", children: "FEEDBACK DO AGENTE" }), _jsx("h3", { children: "Estado da popula\u00E7\u00E3o" })] }), _jsx(Activity, { size: 18, className: "green-icon" })] }), _jsxs("div", { className: "insight-value", children: [candidates.toLocaleString("pt-BR"), " ", _jsx("small", { children: "candidatos" })] }), _jsx("div", { className: "progress", children: _jsx("i", { style: { width: `${Math.max(4, 100 - (candidates / 3000) * 100)}%` } }) }), _jsxs("p", { children: ["O conjunto de respostas poss\u00EDveis \u00E9 atualizado pelo ", _jsx("b", { children: "feedback real" }), " de cada palpite."] })] }), _jsxs("div", { className: "panel mini-chart", children: [_jsx("span", { className: "kicker", children: "QUALIDADE DOS PALPITES" }), _jsx("div", { className: "bars", children: attemptBars.length ? attemptBars.map((height, index) => _jsx("i", { style: { height: `${height}%` }, className: index === attemptBars.length - 1 ? "bar-hot" : "" }, `${index}-${height}`)) : _jsx("span", { className: "empty-chart", children: "As tentativas aparecer\u00E3o aqui" }) }), _jsxs("div", { className: "chart-labels", children: [_jsx("span", { children: "corretas" }), _jsx("span", { children: "presentes" }), _jsx("span", { children: "rodada" })] })] })] })] })) : (_jsxs("section", { className: "training-layout", children: [_jsxs("div", { className: "panel training-main", children: [_jsxs("div", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("span", { className: "kicker", children: "EVOLU\u00C7\u00C3O EM TEMPO REAL" }), _jsx("h2", { children: "Popula\u00E7\u00E3o de solu\u00E7\u00F5es" })] }), _jsxs("button", { className: `run-btn ${training ? "running" : ""}`, onClick: runTraining, children: [_jsx(Sparkles, { size: 16 }), " ", training ? "Parar treinamento" : modelTarget ? "Resolver palavra" : "Executar treinamento"] })] }), _jsxs("div", { className: "length-selector training-length", children: [_jsx("span", { children: "TAMANHO" }), _jsx("button", { className: wordLength === 5 ? "selected" : "", onClick: () => changeWordLength(5), disabled: training, children: "5 letras" }), _jsx("button", { className: wordLength === 6 ? "selected" : "", onClick: () => changeWordLength(6), disabled: training, children: "6 letras" }), _jsx("button", { className: wordLength === 7 ? "selected" : "", onClick: () => changeWordLength(7), disabled: training, children: "7 letras" })] }), _jsxs("div", { className: "target-solver", children: [_jsxs("label", { children: ["Palavra para o modelo resolver ", _jsx("span", { children: "opcional" }), _jsx("input", { value: modelTarget, onChange: (event) => setModelTarget(event.target.value), maxLength: wordLength, placeholder: wordLength === 7 ? "ex.: durante" : wordLength === 6 ? "ex.: abafar" : "ex.: termo", disabled: training })] }), _jsx("small", { children: modelTarget ? `O solver será avaliado somente contra esta palavra de ${wordLength} letras.` : `Sem palavra: o solver usará 100 palavras de ${wordLength} letras.` })] }), _jsxs("div", { className: "training-live", children: [_jsxs("div", { children: [_jsx("span", { children: "GERA\u00C7\u00C3O" }), _jsxs("strong", { children: [generation, " ", _jsxs("small", { children: ["/ ", progress.total_generations] })] })] }), _jsxs("div", { children: [_jsx("span", { children: "ALVOS" }), _jsxs("strong", { children: [progress.target_index, " ", _jsxs("small", { children: ["/ ", progress.target_total] })] })] }), _jsxs("div", { children: [_jsx("span", { children: "TEMPO" }), _jsxs("strong", { children: [elapsedSeconds, "s"] })] }), _jsxs("div", { children: [_jsx("span", { children: "MELHOR PALAVRA" }), _jsx("strong", { children: progress.best_word.toUpperCase() })] })] }), _jsx("div", { className: "training-progress", children: _jsx("i", { style: { width: `${trainingProgress}%` } }) }), "                              ", _jsxs("div", { className: "training-chart", children: [_jsxs("div", { className: "chart-heading", children: [_jsxs("div", { children: [_jsx("strong", { children: "Fitness por gera\u00E7\u00E3o" }), _jsxs("small", { children: ["\u00FAltimas ", chartSeries.length, " medi\u00E7\u00F5es"] })] }), _jsxs("div", { className: "chart-current", children: [_jsx("span", { children: "ATUAL" }), _jsx("b", { children: progress.best_fitness.toFixed(2) })] })] }), chartSeries.length ? _jsxs("div", { className: "line-chart", children: [_jsxs("div", { className: "chart-y-axis", children: [_jsx("span", { children: chartMax.toFixed(1) }), _jsx("span", { children: (chartMin + chartRange * .5).toFixed(1) }), _jsx("span", { children: chartMin.toFixed(1) })] }), _jsxs("div", { className: "chart-plot", children: [_jsxs("div", { className: "chart-grid", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none", role: "img", "aria-label": "Evolu\u00E7\u00E3o do fitness m\u00E9dio e melhor por gera\u00E7\u00E3o", children: [_jsx("polyline", { className: "chart-line average-line", points: averageLine }), _jsx("polyline", { className: "chart-line best-line", points: bestLine })] })] }), _jsxs("div", { className: "chart-x-axis", children: [_jsx("span", { children: "in\u00EDcio" }), _jsxs("span", { children: ["gera\u00E7\u00E3o ", Math.max(1, generation - chartSeries.length + 1)] }), _jsxs("span", { children: ["gera\u00E7\u00E3o ", generation] })] })] }) : _jsx("span", { className: "empty-chart", children: "Inicie o treinamento para acompanhar a evolu\u00E7\u00E3o" })] }), _jsxs("div", { className: "legend", children: [_jsxs("span", { children: [_jsx("i", { className: "dot orange" }), " Melhor fitness"] }), _jsxs("span", { children: [_jsx("i", { className: "dot teal" }), " Fitness m\u00E9dio"] }), _jsx("small", { children: "Quanto maior, melhor" })] })] }), _jsxs("aside", { className: "training-side", children: [_jsxs("div", { className: "metric-grid", children: [_jsxs("div", { className: "metric-card", children: [_jsx("span", { children: "M\u00C9DIA DE TENTATIVAS" }), _jsx("strong", { children: metric.average ? metric.average.toFixed(2) : "—" }), _jsx("small", { children: "amostra real" })] }), _jsxs("div", { className: "metric-card", children: [_jsx("span", { children: "TAXA DE VIT\u00D3RIA" }), _jsx("strong", { children: metric.winRate ? `${metric.winRate.toFixed(1)}%` : "—" }), _jsx("small", { className: "positive", children: "solver Python" })] }), _jsxs("div", { className: "metric-card", children: [_jsx("span", { children: "MELHOR / PIOR CASO" }), _jsx("strong", { children: metric.best ? `${metric.best} / ${metric.worst}` : "—" }), _jsx("small", { children: "tentativas" })] })] }), _jsxs("div", { className: "panel settings", children: [_jsxs("div", { className: "panel-head", children: [_jsx("h3", { children: "Par\u00E2metros" }), _jsx("span", { className: "pill", children: "GEN\u00C9TICO" })] }), _jsxs("label", { children: ["Popula\u00E7\u00E3o ", _jsx("b", { children: population }), _jsx("input", { type: "range", min: "4", max: "200", step: "1", value: population, onChange: (event) => setPopulation(Number(event.target.value)) })] }), _jsxs("label", { children: ["Gera\u00E7\u00F5es ", _jsx("b", { children: generations }), _jsx("input", { type: "range", min: "1", max: "80", step: "1", value: generations, onChange: (event) => setGenerations(Number(event.target.value)) })] }), _jsxs("label", { children: ["Muta\u00E7\u00E3o ", _jsxs("b", { children: [mutationRate, "%"] }), _jsx("input", { type: "range", min: "0", max: "50", step: "1", value: mutationRate, onChange: (event) => setMutationRate(Number(event.target.value)) })] })] }), _jsxs("div", { className: "panel cases-panel", children: [_jsxs("div", { className: "panel-head", children: [_jsxs("div", { children: [_jsx("span", { className: "kicker", children: "VALIDA\u00C7\u00C3O P\u00D3S-TREINO" }), _jsx("h3", { children: "Modelo resolvendo casos" })] }), _jsxs("span", { className: "pill", children: [solvedCases.length, " casos"] })] }), solvedCases.length ? _jsx("div", { className: "cases-list", children: solvedCases.map((item, index) => _jsxs("details", { className: "case", children: [_jsxs("summary", { children: [_jsx("span", { className: "case-status", children: item.won ? "✓" : "×" }), _jsxs("b", { children: ["CASO ", String(index + 1).padStart(2, "0")] }), _jsx("strong", { children: item.target.toUpperCase() }), _jsxs("small", { children: [item.attempts, " tentativas"] })] }), _jsx("div", { className: "case-guesses", children: item.guesses.map((guessItem, guessIndex) => _jsxs("div", { className: "case-guess", children: [_jsx("b", { children: guessIndex + 1 }), _jsx("span", { children: guessItem.word.toUpperCase() }), _jsx("em", { children: guessItem.feedback.map((state) => state === "correta" ? "C" : state === "presente" ? "P" : "A").join("") })] }, `${guessItem.word}-${guessIndex}`)) })] }, `${item.target}-${index}`)) }) : _jsx("p", { className: "empty-cases", children: "Execute um treinamento para liberar casos reais do modelo." })] })] })] })), _jsxs("footer", { children: [_jsxs("span", { children: ["WORDLE ENGINE ", _jsx("b", { children: "v1.0.0" })] }), _jsxs("span", { children: ["VOCABUL\u00C1RIO ", _jsxs("b", { children: [vocabularySize.toLocaleString("pt-BR"), " PALAVRAS"] })] }), _jsxs("span", { children: ["MODELO ", _jsx("b", { children: "GENETIC-SOLVER" })] })] })] }));
}
export default App;
