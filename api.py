"""API HTTP para conectar o motor Python ao frontend React."""

from __future__ import annotations

import random
import threading
import uuid
import asyncio
import queue
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from game import WordGame, default_words_for_length, evaluate_guess, normalize_word
from genetic_algorithm import GeneticSolver, SolverConfig, TrainingCancelled


class NewGameRequest(BaseModel):
    target: str | None = None
    word_length: int = Field(default=5, ge=5, le=7)
    seed: int | None = None


class GuessRequest(BaseModel):
    guess: str = Field(min_length=1, max_length=20)


class TrainingRequest(BaseModel):
    training_id: str = Field(min_length=1, max_length=100)
    target: str | None = Field(default=None, max_length=20)
    word_length: int = Field(default=5, ge=5, le=7)
    sample_size: int = Field(default=100, ge=1, le=50000)
    population_size: int = Field(default=100, ge=4, le=300)
    generations: int = Field(default=35, ge=1, le=100)
    mutation_rate: float = Field(default=0.18, ge=0, le=1)
    seed: int = 42


@dataclass
class Session:
    game: WordGame


app = FastAPI(title="Termo Genetic Lab API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
sessions: dict[str, Session] = {}
training_stops: dict[str, threading.Event] = {}
@app.websocket("/api/training/ws/{training_id}")
async def training_socket(websocket: WebSocket, training_id: str) -> None:
    await websocket.accept()
    messages: queue.Queue[dict] = queue.Queue()
    stop_event = threading.Event()
    training_stops[training_id] = stop_event

    try:
        config_data = await websocket.receive_json()
        request = TrainingRequest(training_id=training_id, **config_data)
        rng = random.Random(request.seed)
        config = SolverConfig(
            population_size=request.population_size,
            generations=request.generations,
            elite_size=min(12, request.population_size),
            tournament_size=min(4, request.population_size),
            mutation_rate=request.mutation_rate,
        )
        words = default_words_for_length(request.word_length)
        solver = GeneticSolver(words=words, config=config, rng=rng)
        if request.target:
            target = normalize_word(request.target)
            if target not in solver.words:
                await websocket.send_json({
                    "type": "error",
                    "message": f"A palavra {request.target!r} não está no vocabulário.",
                })
                await websocket.close()
                return
            targets = [target]
        else:
            targets = rng.sample(solver.words, min(request.sample_size, len(solver.words)))
        def train() -> None:
            try:
                def publish(generation: int, best: float, average: float, word: str) -> None:
                    messages.put({
                        "type": "progress",
                        "generation": generation,
                        "total_generations": request.generations,
                        "best_fitness": best,
                        "average_fitness": average,
                        "best_word": word,
                        "target_index": 0,
                        "target_total": len(targets),
                        "phase": "training",
                    })

                strategy = solver.train_strategy(
                    should_stop=stop_event.is_set,
                    on_generation=publish,
                )
                completed_results = []
                for index, target in enumerate(targets, start=1):
                    if stop_event.is_set():
                        break
                    history = solver.solve(
                        target,
                        should_stop=stop_event.is_set,
                        strategy=strategy,
                    )
                    completed_results.append((target, history))
                    messages.put({
                        "type": "progress",
                        "generation": request.generations,
                        "total_generations": request.generations,
                        "best_fitness": 0,
                        "average_fitness": 0,
                        "best_word": history[-1].guess if history else "—",
                        "target_index": index,
                        "target_total": len(targets),
                        "phase": "testing",
                    })
                if stop_event.is_set():
                    messages.put({"type": "cancelled"})
                    return
                histories = [item[1] for item in completed_results]
                attempts = [len(history) for history in histories]
                wins = [history[-1].won for history in histories]
                cases = [
                    {
                        "target": target,
                        "won": bool(history and history[-1].won),
                        "attempts": len(history),
                        "guesses": [
                            {
                                "word": result.guess,
                                "feedback": [item.value for item in result.feedback],
                            }
                            for result in history
                        ],
                    }
                    for target, history in completed_results
                ]
                messages.put({
                    "type": "complete",
                    "sample_size": len(histories),
                    "average_attempts": sum(attempts) / len(attempts),
                    "win_rate": sum(wins) / len(wins),
                    "best_attempts": min(attempts),
                    "worst_attempts": max(attempts),
                    "generations": request.generations,
                    "cases": cases,
                })
            except TrainingCancelled:
                messages.put({"type": "cancelled"})

        worker = threading.Thread(target=train, daemon=True)
        worker.start()
        while worker.is_alive() or not messages.empty():
            try:
                message = messages.get_nowait()
                await websocket.send_json(message)
            except queue.Empty:
                try:
                    command = await asyncio.wait_for(websocket.receive_json(), timeout=0.05)
                    if command.get("type") == "stop":
                        stop_event.set()
                except asyncio.TimeoutError:
                    await asyncio.sleep(0)
                except WebSocketDisconnect:
                    stop_event.set()
                    break
        while not messages.empty():
            await websocket.send_json(messages.get_nowait())
    except WebSocketDisconnect:
        stop_event.set()
    finally:
        training_stops.pop(training_id, None)


def serialize_result(result) -> dict:
    return {
        "guess": result.guess,
        "feedback": [item.value for item in result.feedback],
        "attempt_number": result.attempt_number,
        "won": result.won,
        "finished": result.finished,
    }


def remaining_candidates(game: WordGame) -> int:
    candidates = game.words
    for attempt in game.history:
        candidates = tuple(
            word for word in candidates
            if evaluate_guess(word, attempt.guess) == attempt.feedback
        )
    return len(candidates)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "online",
        "word_counts": {
            "5": len(default_words_for_length(5)),
            "6": len(default_words_for_length(6)),
            "7": len(default_words_for_length(7)),
        },
    }


@app.post("/api/game")
def create_game(request: NewGameRequest) -> dict:
    rng = random.Random(request.seed)
    try:
        game = WordGame(target=request.target, word_length=request.word_length, rng=rng)
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    game_id = str(uuid.uuid4())
    sessions[game_id] = Session(game=game)
    return {"game_id": game_id, "attempts": [], "status": "playing"}


@app.post("/api/game/{game_id}/guess")
def submit_guess(game_id: str, request: GuessRequest) -> dict:
    session = sessions.get(game_id)
    if session is None:
        raise HTTPException(status_code=404, detail="partida não encontrada")
    try:
        result = session.game.try_guess(request.guess)
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {
        "result": serialize_result(result),
        "attempts_used": session.game.attempts_used,
        "candidates": remaining_candidates(session.game),
        "status": "won" if session.game.won else "finished" if session.game.is_finished else "playing",
    }


@app.post("/api/training")
def run_training(request: TrainingRequest) -> dict:
    stop_event = threading.Event()
    training_stops[request.training_id] = stop_event
    rng = random.Random(request.seed)
    config = SolverConfig(
        population_size=request.population_size,
        generations=request.generations,
        elite_size=min(12, request.population_size),
        tournament_size=min(4, request.population_size),
        mutation_rate=request.mutation_rate,
    )
    words = default_words_for_length(request.word_length)
    solver = GeneticSolver(words=words, config=config, rng=rng)
    targets = rng.sample(solver.words, min(request.sample_size, len(solver.words)))
    try:
        strategy = solver.train_strategy(should_stop=stop_event.is_set)
        histories = [
            solver.solve(target, should_stop=stop_event.is_set, strategy=strategy)
            for target in targets
            if not stop_event.is_set()
        ]
        if not histories:
            return {"cancelled": True, "sample_size": 0}
        attempts = [len(history) for history in histories]
        wins = [history[-1].won for history in histories]
        return {
            "cancelled": stop_event.is_set(),
            "sample_size": len(histories),
            "average_attempts": sum(attempts) / len(attempts),
            "win_rate": sum(wins) / len(wins),
            "best_attempts": min(attempts),
            "worst_attempts": max(attempts),
            "generations": request.generations,
            "population_size": request.population_size,
            "mutation_rate": request.mutation_rate,
        }
    finally:
        training_stops.pop(request.training_id, None)


@app.post("/api/training/{training_id}/stop")
def stop_training(training_id: str) -> dict:
    stop_event = training_stops.get(training_id)
    if stop_event is None:
        return {"stopped": False, "message": "treinamento não encontrado ou já finalizado"}
    stop_event.set()
    return {"stopped": True}
