"""Solucionador genético para o jogo de palavras.

O cromossomo é um palpite de cinco letras. Em cada rodada, uma população de
palavras é evoluída para minimizar o tamanho esperado do conjunto de alvos
restantes. Depois do feedback, apenas palavras compatíveis continuam sendo
alvos possíveis.

Uso:
    python genetic_algorithm.py --target termo
    python genetic_algorithm.py --evaluate 100 --seed 42
"""

from __future__ import annotations

import argparse
import math
import random
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Iterable

from game import DEFAULT_WORDS, SUPPORTED_WORD_LENGTHS, GuessResult, WordGame, default_words_for_length, evaluate_guess


@dataclass(frozen=True)
class SolverConfig:
    population_size: int = 100
    generations: int = 35
    elite_size: int = 12
    tournament_size: int = 4
    mutation_rate: float = 0.18


class TrainingCancelled(Exception):
    """Interrupção solicitada durante a evolução da população."""


GenerationCallback = Callable[[int, float, float, str], None]


class GeneticSolver:
    """Escolhe palpites por evolução genética e filtra alvos por feedback."""

    def __init__(
        self,
        words: Iterable[str] = DEFAULT_WORDS,
        config: SolverConfig = SolverConfig(),
        rng: random.Random | None = None,
    ) -> None:
        self.words = tuple(dict.fromkeys(words))
        if not self.words:
            raise ValueError("o vocabulário não pode estar vazio")
        if config.population_size < config.elite_size or config.elite_size < 1:
            raise ValueError("population_size deve ser maior ou igual a elite_size")
        if config.generations < 1 or config.tournament_size < 2:
            raise ValueError("configuração genética inválida")
        self.config = config
        self.rng = rng or random.Random()
        self._word_set = set(self.words)

    @staticmethod
    def _pattern(target: str, guess: str) -> tuple[str, ...]:
        return tuple(result.value for result in evaluate_guess(target, guess))

    def _compatible_targets(
        self, candidates: tuple[str, ...], guess: str, feedback: tuple[str, ...]
    ) -> tuple[str, ...]:
        return tuple(
            target for target in candidates
            if self._pattern(target, guess) == feedback
        )

    def _fitness(self, guess: str, candidates: tuple[str, ...]) -> float:
        """Fitness: menor ambiguidade esperada e maior informação de letras."""
        if len(candidates) <= 1:
            return 10_000.0 if guess == candidates[0] else 0.0

        partitions = Counter(self._pattern(target, guess) for target in candidates)
        total = len(candidates)
        expected_remaining = sum(size * size for size in partitions.values()) / total
        entropy = -sum(
            (size / total) * math.log2(size / total)
            for size in partitions.values()
        )
        candidate_bonus = 0.35 if guess in candidates else 0.0
        # A menor expectativa é melhor; a entropia desempata partições.
        return -expected_remaining + entropy * 0.15 + candidate_bonus

    def _initial_population(
        self, candidates: tuple[str, ...], previous: set[str]
    ) -> list[str]:
        pool = [word for word in self.words if word not in previous]
        if not pool:
            pool = list(self.words)
        if len(pool) <= self.config.population_size:
            return pool[:]

        # Frequência de letras distintas favorece palpites informativos.
        frequencies = Counter(char for word in candidates for char in set(word))
        weighted = sorted(
            pool,
            key=lambda word: sum(frequencies[char] for char in set(word)),
            reverse=True,
        )
        seed_count = min(self.config.population_size // 2, len(weighted))
        population = weighted[:seed_count]
        population.extend(
            self.rng.sample(pool, self.config.population_size - len(population))
        )
        return list(dict.fromkeys(population))

    def _mutate(self, word: str) -> str:
        chars = list(word)
        index = self.rng.randrange(len(chars))
        chars[index] = self.rng.choice("abcdefghijklmnopqrstuvwxyz")
        mutated = "".join(chars)
        if mutated in self._word_set:
            return mutated
        return self.rng.choice(self.words)

    def _crossover(self, first: str, second: str) -> str:
        cut = self.rng.randrange(1, len(first))
        child = first[:cut] + second[cut:]
        return child if child in self._word_set else self.rng.choice((first, second))

    def choose_guess(
        self,
        candidates: tuple[str, ...],
        previous: set[str] | None = None,
        should_stop: Callable[[], bool] | None = None,
        on_generation: GenerationCallback | None = None,
    ) -> str:
        """Evolui uma população e retorna o melhor palpite da rodada."""
        if not candidates:
            raise ValueError("não há alvos compatíveis com o feedback")
        if len(candidates) == 1:
            return candidates[0]

        previous = previous or set()
        population = self._initial_population(candidates, previous)
        for _ in range(self.config.generations):
            if should_stop and should_stop():
                raise TrainingCancelled
            ranked = sorted(
                population,
                key=lambda word: self._fitness(word, candidates),
                reverse=True,
            )
            if on_generation:
                scores = [self._fitness(word, candidates) for word in ranked]
                on_generation(
                    _ + 1,
                    scores[0],
                    sum(scores) / len(scores),
                    ranked[0],
                )
            elites = ranked[:self.config.elite_size]
            next_population = list(elites)
            while len(next_population) < self.config.population_size:
                tournament = self.rng.sample(
                    ranked, min(self.config.tournament_size, len(ranked))
                )
                first = max(tournament, key=lambda word: self._fitness(word, candidates))
                tournament = self.rng.sample(
                    ranked, min(self.config.tournament_size, len(ranked))
                )
                second = max(tournament, key=lambda word: self._fitness(word, candidates))
                child = self._crossover(first, second)
                if self.rng.random() < self.config.mutation_rate:
                    child = self._mutate(child)
                next_population.append(child)
            population = list(dict.fromkeys(next_population))

        return max(population, key=lambda word: self._fitness(word, candidates))

    def solve(
        self,
        target: str,
        max_attempts: int = 6,
        should_stop: Callable[[], bool] | None = None,
        on_generation: GenerationCallback | None = None,
    ) -> list[GuessResult]:
        """Resolve um alvo conhecido pelo motor e retorna o histórico de palpites."""
        game = WordGame(target=target, words=self.words, max_attempts=max_attempts)
        candidates = self.words
        previous: set[str] = set()
        while not game.is_finished:
            if should_stop and should_stop():
                raise TrainingCancelled
            guess = self.choose_guess(candidates, previous, should_stop, on_generation)
            result = game.try_guess(guess)
            previous.add(guess)
            if result.won:
                break
            feedback = tuple(item.value for item in result.feedback)
            candidates = self._compatible_targets(candidates, guess, feedback)
        return game.history


def evaluate_solver(
    solver: GeneticSolver,
    targets: Iterable[str],
    max_attempts: int = 6,
) -> tuple[float, float, int]:
    """Retorna média de tentativas, taxa de vitória e pior número de tentativas."""
    histories = [solver.solve(target, max_attempts) for target in targets]
    wins = sum(bool(history) and history[-1].won for history in histories)
    attempts = [len(history) for history in histories]
    return (
        sum(attempts) / len(attempts),
        wins / len(histories),
        max(attempts),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Algoritmo genético para resolver o Termo.")
    parser.add_argument("--target", help="resolve uma palavra específica")
    parser.add_argument("--evaluate", type=int, help="avalia N alvos aleatórios")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--generations", type=int, default=35)
    parser.add_argument("--population", type=int, default=100)
    parser.add_argument("--length", type=int, choices=SUPPORTED_WORD_LENGTHS, default=5)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    config = SolverConfig(
        generations=args.generations,
        population_size=args.population,
        elite_size=min(12, args.population),
        tournament_size=min(4, args.population),
    )
    solver = GeneticSolver(words=default_words_for_length(args.length), config=config, rng=rng)
    if args.target:
        history = solver.solve(args.target)
        for result in history:
            feedback = "".join(
                {"correta": "C", "presente": "P", "ausente": "A"}[item.value]
                for item in result.feedback
            )
            print(f"{result.attempt_number}: {result.guess.upper()} [{feedback}]")
        print(f"Vitória: {history[-1].won} | Tentativas: {len(history)}")
    else:
        count = args.evaluate or 20
        targets = rng.sample(solver.words, min(count, len(solver.words)))
        average, win_rate, worst = evaluate_solver(solver, targets)
        print(f"Alvos avaliados: {len(targets)}")
        print(f"Média de tentativas: {average:.2f}")
        print(f"Taxa de vitória: {win_rate:.1%}")
        print(f"Pior caso: {worst} tentativas")


if __name__ == "__main__":
    main()
