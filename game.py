"""Motor de um jogo de palavras de cinco ou seis letras, semelhante ao Termo.

O módulo pode ser usado de duas formas:

* `python game.py` inicia uma partida interativa no terminal.
* `WordGame` pode ser importado por um algoritmo genético para simular
  partidas sem entrada/saída e sem aleatoriedade escondida.

As palavras são mantidas sem acentos para que a representação do cromossomo
seja simples. O feedback usa a mesma regra do Termo/Wordle:
`CORRETA`, `PRESENTE` e `AUSENTE`, inclusive para letras repetidas.
"""

from __future__ import annotations

import argparse
import random
import unicodedata
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Iterable


WORD_LENGTH = 5
SUPPORTED_WORD_LENGTHS = (5, 6, 7)
MAX_ATTEMPTS = 6


class LetterResult(str, Enum):
    """Resultado de uma letra em uma tentativa."""

    CORRETA = "correta"
    PRESENTE = "presente"
    AUSENTE = "ausente"


@dataclass(frozen=True)
class GuessResult:
    """Resultado imutável de uma tentativa."""

    guess: str
    feedback: tuple[LetterResult, ...]
    attempt_number: int
    won: bool
    finished: bool

    @property
    def is_correct(self) -> bool:
        return self.won

    def symbols(self) -> str:
        """Representação curta: verde, amarelo e cinza."""
        symbols = {
            LetterResult.CORRETA: "🟩",
            LetterResult.PRESENTE: "🟨",
            LetterResult.AUSENTE: "⬜",
        }
        return "".join(symbols[result] for result in self.feedback)


def normalize_word(word: str) -> str:
    """Normaliza maiúsculas e acentos, mantendo apenas letras."""
    normalized = unicodedata.normalize("NFD", word.strip().lower())
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def evaluate_guess(target: str, guess: str) -> tuple[LetterResult, ...]:
    """Calcula feedback sem marcar duas vezes a mesma letra da palavra-alvo."""
    target = normalize_word(target)
    guess = normalize_word(guess)
    if len(target) not in SUPPORTED_WORD_LENGTHS or len(guess) != len(target):
        raise ValueError("target e guess devem ter 5, 6 ou 7 letras do mesmo tamanho")

    feedback = [LetterResult.AUSENTE] * len(target)
    remaining: dict[str, int] = {}

    for index, (target_char, guess_char) in enumerate(zip(target, guess)):
        if target_char == guess_char:
            feedback[index] = LetterResult.CORRETA
        else:
            remaining[target_char] = remaining.get(target_char, 0) + 1

    for index, guess_char in enumerate(guess):
        if feedback[index] is LetterResult.CORRETA:
            continue
        if remaining.get(guess_char, 0):
            feedback[index] = LetterResult.PRESENTE
            remaining[guess_char] -= 1

    return tuple(feedback)


def _load_words(filename: str, word_length: int) -> tuple[str, ...]:
    """Carrega palavras normalizadas de um vocabulário local."""
    word_file = Path(__file__).with_name(filename)
    try:
        words = tuple(
            word.strip()
            for word in word_file.read_text(encoding="utf-8").splitlines()
            if word.strip()
        )
    except OSError as error:
        raise RuntimeError(f"não foi possível carregar {word_file.name}") from error
    if not words or any(len(word) != word_length or not word.isalpha() for word in words):
        raise RuntimeError(f"{word_file.name} não contém palavras")
    return words


# Fonte: https://github.com/fserb/pt-br. O arquivo local foi derivado do
# ranking "icf", removendo a lista "listas/negativas". A origem não fornece a
# lista oficial
# de aceitação do Termo, portanto este é um vocabulário jogável aproximado.
DEFAULT_WORDS: tuple[str, ...] = _load_words("words.txt", 5)
DEFAULT_WORDS_6: tuple[str, ...] = _load_words("words6.txt", 6)
DEFAULT_WORDS_7: tuple[str, ...] = _load_words("words7.txt", 7)


def default_words_for_length(word_length: int) -> tuple[str, ...]:
    """Retorna o vocabulário padrão correspondente ao tamanho solicitado."""
    vocabularies = {5: DEFAULT_WORDS, 6: DEFAULT_WORDS_6, 7: DEFAULT_WORDS_7}
    try:
        return vocabularies[word_length]
    except KeyError as error:
        raise ValueError("o tamanho deve ser 5, 6 ou 7 letras") from error


class WordGame:
    """Partida isolada e serializável de um jogo de palavras."""

    def __init__(
        self,
        target: str | None = None,
        words: Iterable[str] | None = None,
        word_length: int | None = None,
        max_attempts: int = MAX_ATTEMPTS,
        rng: random.Random | None = None,
    ) -> None:
        if words is None:
            word_length = WORD_LENGTH if word_length is None else word_length
            vocabulary_source = default_words_for_length(word_length)
        else:
            vocabulary_source = words
        vocabulary = tuple(dict.fromkeys(normalize_word(word) for word in vocabulary_source))
        if not vocabulary:
            raise ValueError("o vocabulário não pode estar vazio")
        word_length = len(vocabulary[0]) if word_length is None else word_length
        if any(len(word) != word_length or not word.isalpha() for word in vocabulary):
            raise ValueError(f"todas as palavras devem ter exatamente {word_length} letras")
        if max_attempts < 1:
            raise ValueError("max_attempts deve ser positivo")

        self.words = vocabulary
        self.word_length = word_length
        self.max_attempts = max_attempts
        self._rng = rng or random.Random()
        self.target = normalize_word(target) if target is not None else self._rng.choice(vocabulary)
        if self.target not in self.words:
            raise ValueError("a palavra-alvo deve estar no vocabulário")
        self.history: list[GuessResult] = []

    @property
    def attempts_used(self) -> int:
        return len(self.history)

    @property
    def is_finished(self) -> bool:
        return bool(self.history) and (
            self.history[-1].won or self.attempts_used >= self.max_attempts
        )

    @property
    def won(self) -> bool:
        return bool(self.history) and self.history[-1].won

    def try_guess(self, guess: str) -> GuessResult:
        """Registra uma tentativa e retorna seu feedback.

        O método não aceita tentativas depois do fim da partida nem palavras
        fora do vocabulário, evitando estados inválidos durante o treinamento.
        """
        if self.is_finished:
            raise RuntimeError("a partida já terminou")
        normalized_guess = normalize_word(guess)
        if len(normalized_guess) != self.word_length:
            raise ValueError(f"a tentativa deve ter {self.word_length} letras")
        if normalized_guess not in self.words:
            raise ValueError(f"palavra desconhecida: {guess!r}")

        feedback = evaluate_guess(self.target, normalized_guess)
        won = all(result is LetterResult.CORRETA for result in feedback)
        result = GuessResult(
            guess=normalized_guess,
            feedback=feedback,
            attempt_number=self.attempts_used + 1,
            won=won,
            finished=won or self.attempts_used + 1 >= self.max_attempts,
        )
        self.history.append(result)
        return result

    def score(self) -> float:
        """Pontuação útil para a função de fitness do algoritmo genético."""
        if self.won:
            return 1.0 + (self.max_attempts - self.attempts_used) / self.max_attempts
        if not self.history:
            return 0.0
        correct = sum(
            result is LetterResult.CORRETA
            for attempt in self.history
            for result in attempt.feedback
        )
        present = sum(
            result is LetterResult.PRESENTE
            for attempt in self.history
            for result in attempt.feedback
        )
        return (correct * 2 + present) / (self.max_attempts * self.word_length * 2)


def run_cli() -> None:
    parser = argparse.ArgumentParser(description="Jogo de palavras para treinar um algoritmo genético.")
    parser.add_argument("--target", help="alvo fixo para testes (não exibido durante a partida)")
    parser.add_argument("--seed", type=int, help="semente para escolher o alvo")
    parser.add_argument("--length", type=int, choices=SUPPORTED_WORD_LENGTHS, default=WORD_LENGTH)
    parser.add_argument("--max-attempts", type=int, default=MAX_ATTEMPTS)
    args = parser.parse_args()

    game = WordGame(target=args.target, word_length=args.length, max_attempts=args.max_attempts, rng=random.Random(args.seed))
    print(f"Descubra a palavra de {game.word_length} letras. Você tem {game.max_attempts} tentativas.")
    print("🟩 correta  🟨 existe em outra posição  ⬜ não existe")

    while not game.is_finished:
        try:
            result = game.try_guess(input(f"{game.attempts_used + 1}/{game.max_attempts}> "))
        except (ValueError, RuntimeError) as error:
            print(f"Erro: {error}")
            continue
        print(f"{result.guess.upper()}  {result.symbols()}")

    if game.won:
        print(f"Você venceu em {game.attempts_used} tentativa(s)! Pontuação: {game.score():.3f}")
    else:
        print(f"Fim de jogo. A palavra era {game.target.upper()}. Pontuação: {game.score():.3f}")


if __name__ == "__main__":
    run_cli()