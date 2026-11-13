# Termo Genetic Lab

Aplicação semelhante ao Termo para treinar, avaliar e visualizar um algoritmo
genético capaz de resolver palavras de cinco, seis ou sete letras em português.

O projeto possui:

- motor de jogo reutilizável em Python;
- vocabulário local baseado no repositório [fserb/pt-br](https://github.com/fserb/pt-br);
- solucionador genético com seleção, elitismo, crossover e mutação;
- API FastAPI para integrar o Python ao frontend;
- frontend React/Vite para jogar, treinar e acompanhar o solver em tempo real;
- replay dos casos resolvidos depois do treinamento.

## Requisitos

- Python 3.10 ou superior;
- Node.js e npm;
- Windows, macOS ou Linux.

No Windows, caso o PowerShell bloqueie `npm.ps1`, use `npm.cmd`.

## Estrutura

```text
.
├── api.py                   # API FastAPI e WebSocket de treinamento
├── game.py                  # Regras do jogo e feedback das letras
├── genetic_algorithm.py     # Algoritmo genético e avaliação do solver
├── requirements.txt         # Dependências Python
├── words.txt                # Vocabulário de cinco letras
├── words6.txt               # Vocabulário de seis letras
├── words7.txt               # Vocabulário de sete letras
└── frontend/
    ├── package.json         # Scripts e dependências React
    └── src/
        ├── App.tsx          # Interface e integração com a API
        └── styles.css       # Estilos da aplicação
```

As pastas `frontend/node_modules` e `frontend/dist` são geradas localmente e
não são necessárias para entender o código-fonte.

## Vocabulário

Os arquivos `words.txt`, `words6.txt` e `words7.txt` contêm palavras normalizadas, sem
acentos, ordenadas alfabeticamente e com exatamente cinco, seis ou sete letras,
respectivamente. As listas não possuem mais um limite artificial de quantidade:

- 5 letras: 9.070 palavras;
- 6 letras: 18.323 palavras;
- 7 letras: 30.200 palavras.

Esses números dependem da fonte e das filtragens aplicadas. O limite de 20.000
foi removido das listas, mas a amostra de treinamento continua sendo 100 alvos
por padrão para não tornar a interface lenta.

A fonte foi o repositório
[fserb/pt-br](https://github.com/fserb/pt-br), usando o ranking `icf` e
removendo entradas da lista `listas/negativas`. Essa fonte não é a lista
oficial de palavras aceitas pelo Termo; portanto, o vocabulário deste projeto é
uma aproximação jogável baseada em frequência.

O carregamento ocorre automaticamente quando `game.py` é importado. Se
qualquer vocabulário estiver ausente, vazio ou inválido, a aplicação informa erro em vez
de iniciar com um vocabulário silenciosamente incorreto.

## Instalação

### 1. Dependências Python

Na raiz do projeto:

```powershell
python -m venv .venv
```

Ative o ambiente virtual.

No Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

No Windows, se a política de execução impedir a ativação, use diretamente o
interpretador do ambiente:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Com o ambiente ativado:

```powershell
python -m pip install -r requirements.txt
```

### 2. Dependências do frontend

```powershell
cd frontend
npm.cmd install
```

## Executando o projeto

É necessário manter a API e o frontend em terminais separados.

### Terminal 1: API

Na raiz:

```powershell
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

A API ficará disponível em:

```text
http://127.0.0.1:8000
```

Documentação automática do FastAPI:

```text
http://127.0.0.1:8000/docs
```

### Terminal 2: frontend

```powershell
cd frontend
npm.cmd run dev
```

Abra o endereço exibido pelo Vite, normalmente:

```text
http://127.0.0.1:5173
```

## Interface web

### Aba Jogo

A aba **Jogo** permite jogar manualmente:

1. escolher cinco, seis ou sete letras;
2. iniciar uma partida;
3. digitar uma palavra do tamanho escolhido;
4. enviar o palpite;
5. acompanhar o feedback visual;
6. observar a quantidade de candidatos restantes;
7. reiniciar a partida pelo botão de nova partida.

O jogo permite até seis tentativas.

O feedback segue as regras do Termo:

- **correta**: a letra está na posição certa;
- **presente**: a letra existe, mas está em outra posição;
- **ausente**: a letra não pode ser usada naquela ocorrência.

As letras repetidas são tratadas corretamente, sem marcar a mesma letra duas
vezes quando o alvo não possui ocorrências suficientes.

### Aba Treinamento

A aba **Treinamento** executa o solver Python e mostra:

- geração atual e total de gerações;
- alvos processados;
- tempo decorrido;
- melhor palavra da geração;
- fitness médio e melhor fitness;
- gráfico da evolução;
- média de tentativas;
- taxa de vitória;
- melhor e pior caso;
- replay dos palpites de cada caso.

Por padrão, o treinamento avalia uma amostra de **100 palavras**. A amostra
não altera o vocabulário; ela apenas define quantos alvos serão avaliados
naquela execução.

### Resolver uma palavra específica

No campo **Palavra para o modelo resolver**, digite uma palavra de cinco, seis ou sete
letras presente no vocabulário correspondente. O tamanho selecionado na aba
**Jogo** também define o vocabulário usado pelo treinamento. Exemplos:

```text
termo
```

ou:

```text
abafar
```

O botão mudará para **Resolver palavra** e o treinamento será executado para
um único alvo. Uma palavra fora do vocabulário gera uma mensagem de erro
visível na interface.

Com o campo vazio, o sistema seleciona aleatoriamente 100 palavras.

### Parar o treinamento

Durante o treinamento, o botão muda para **Parar treinamento**. O cancelamento
é cooperativo: a API sinaliza o solver e encerra a execução assim que o ciclo
atual permite. O WebSocket também é fechado pelo frontend.

## Parâmetros do treinamento

Os controles disponíveis na interface são:

| Parâmetro | Padrão | Faixa | Descrição |
|---|---:|---:|---|
| População | 100 | 4–200 | Quantidade de indivíduos por geração |
| Gerações | 35 | 1–80 | Ciclos de evolução de cada palpite |
| Mutação | 18% | 0–50% | Probabilidade de alterar um indivíduo |
| Amostra | 100 | 1–50000 na API | Quantidade de alvos avaliados |

Populações pequenas e uma geração são aceitas para testes rápidos. Uma
população maior ou mais gerações normalmente produz uma busca mais elaborada,
mas aumenta o tempo de execução.

## Como o algoritmo funciona

Cada palavra candidata é um cromossomo. Para escolher o próximo palpite, o
solver:

1. começa com uma população de palavras do vocabulário;
2. prioriza palavras com letras informativas;
3. calcula o fitness de cada indivíduo;
4. ordena a população;
5. preserva os melhores indivíduos por elitismo;
6. seleciona pais por torneio;
7. combina pais por crossover;
8. aplica mutação conforme a taxa configurada;
9. repete o processo pelo número de gerações;
10. escolhe o melhor indivíduo como palpite;
11. filtra os alvos compatíveis com o feedback recebido;
12. repete até vencer ou atingir seis tentativas.

O fitness considera principalmente:

- tamanho esperado do conjunto de candidatos restantes;
- entropia das partições de feedback;
- bônus para palavras que ainda são candidatas ao alvo.

O objetivo não é apenas formar uma palavra válida, mas escolher um palpite que
separe melhor as possibilidades restantes.

## Como o modelo resolve depois da primeira palavra

O modelo não recebe a palavra-alvo diretamente durante a partida. Ele começa
considerando todas as palavras do vocabulário escolhido como possíveis alvos.

### Primeira tentativa

O algoritmo genético cria uma população de palpites e calcula o fitness de cada
um. Um palpite é melhor quando consegue dividir os candidatos em muitos grupos
de feedback diferentes, reduzindo o conjunto esperado de possibilidades.

### Filtragem pelo feedback

Depois que o jogo retorna o feedback, o solver simula o mesmo palpite contra
cada candidato. Ele mantém somente as palavras que produziriam exatamente o
mesmo padrão de `correta`, `presente` e `ausente`.

Por exemplo:

```text
vocabulário inicial -> 9.070 candidatos
primeiro feedback    -> 420 candidatos
segundo feedback     -> 38 candidatos
terceiro feedback    -> 4 candidatos
quarto feedback      -> 1 candidato
```

O número acima é apenas ilustrativo; ele varia conforme a palavra e o
vocabulário selecionado.

### Próximas tentativas

Com o conjunto reduzido, uma nova população genética é criada. O solver:

1. exclui os palpites já usados;
2. calcula o fitness contra os candidatos restantes;
3. preserva os melhores indivíduos;
4. escolhe pais por torneio;
5. aplica crossover e mutação;
6. repete pelas gerações configuradas;
7. usa o melhor indivíduo como próximo palpite.

A população genética é recriada a cada rodada, porque o conjunto de candidatos
muda depois de cada feedback. O que permanece é o conhecimento acumulado:
os candidatos compatíveis e o conjunto de palpites anteriores.

Quando sobra apenas um candidato, ele é usado diretamente como resposta.

## Separação entre treinamento e teste

O botão de treinamento executa uma única fase de evolução genética. Nessa
fase, a população é otimizada usando o vocabulário inteiro e produz uma
estratégia ordenada de palpites.

Depois disso, a amostra de 100 palavras (ou a quantidade configurada) é usada
somente para teste:

```text
1 treinamento genético
        ↓
estratégia treinada
        ↓
teste no alvo 1
teste no alvo 2
teste no alvo 3
...
teste no alvo 100
```

Durante os testes, o solver não executa novas gerações, não faz crossover e
não aplica mutação. Ele apenas usa a estratégia já treinada, filtra os
candidatos conforme cada feedback e escolhe o melhor palpite disponível.

As tentativas de uma mesma palavra continuam sequenciais porque cada uma
depende do feedback da anterior. O progresso da interface distingue as duas
fases: `training` para as gerações e `testing` para os alvos avaliados.

## Uso pelo terminal

### Jogar manualmente no terminal

Na raiz:

```powershell
python game.py
```

Com alvo fixo para testes:

```powershell
python game.py --target termo
```

Com semente definida:

```powershell
python game.py --seed 42
```

### Resolver uma palavra com o solver

```powershell
python genetic_algorithm.py --target termo
```

O resultado mostra cada tentativa, seguida do código de feedback:

- `C`: correta;
- `P`: presente;
- `A`: ausente.

### Avaliar uma amostra pelo terminal

```powershell
python genetic_algorithm.py --evaluate 100 --seed 42
```

Também é possível alterar os parâmetros principais:

```powershell
python genetic_algorithm.py --evaluate 100 --population 100 --generations 35 --seed 42
```

O comando informa a média de tentativas, a taxa de vitória e o pior caso.

## API

### Verificar saúde da API

```http
GET /api/health
```

Resposta aproximada:

```json
{
  "status": "online",
  "word_counts": {
    "5": 9070,
    "6": 18323,
    "7": 30200
  }
}
```

### Criar partida

```http
POST /api/game
Content-Type: application/json
```

Corpo opcional:

```json
{
  "target": "termo",
  "word_length": 5,
  "seed": 42
}
```

Resposta:

```json
{
  "game_id": "id-da-partida",
  "attempts": [],
  "status": "playing"
}
```

### Enviar palpite

```http
POST /api/game/{game_id}/guess
Content-Type: application/json
```

Corpo:

```json
{
  "guess": "serao"
}
```

A resposta inclui o resultado, o número de tentativas usadas, os candidatos
restantes e o status da partida.

### Treinamento HTTP

```http
POST /api/training
Content-Type: application/json
```

Exemplo:

```json
{
  "training_id": "treino-001",
  "sample_size": 100,
  "population_size": 100,
  "generations": 35,
  "mutation_rate": 0.18,
  "seed": 42
}
```

Esse endpoint retorna o resultado agregado depois que o processamento termina.
A interface utiliza o WebSocket abaixo para receber atualizações em tempo real.

### Parar treinamento HTTP

```http
POST /api/training/{training_id}/stop
```

## WebSocket de treinamento

Conexão:

```text
ws://127.0.0.1:8000/api/training/ws/{training_id}
```

Ao abrir a conexão, o cliente envia:

```json
{
  "target": null,
  "sample_size": 100,
  "population_size": 100,
  "generations": 35,
  "mutation_rate": 0.18,
  "seed": 42
}
```

Para resolver uma palavra específica:

```json
{
  "target": "abafar",
  "word_length": 6,
  "sample_size": 1,
  "population_size": 100,
  "generations": 35,
  "mutation_rate": 0.18,
  "seed": 42
}
```

Durante a execução, são enviados eventos `progress`:

```json
{
  "type": "progress",
  "generation": 12,
  "total_generations": 35,
  "best_fitness": -21.4,
  "average_fitness": -28.7,
  "best_word": "serao",
  "target_index": 4,
  "target_total": 100
}
```

Ao terminar, o evento `complete` contém as métricas e os casos resolvidos,
incluindo os palpites e seus feedbacks.

Para solicitar o cancelamento pelo WebSocket:

```json
{
  "type": "stop"
}
```

Eventos possíveis:

- `progress`: atualização de uma geração;
- `complete`: treinamento concluído;
- `cancelled`: treinamento interrompido;
- `error`: configuração inválida ou palavra fora do vocabulário.

## Métricas da interface

Enquanto o treinamento está em andamento, o indicador principal é o
**progresso do treinamento**, calculado com base nas gerações e nos alvos
processados.

Depois do evento `complete`, ele passa a exibir a **eficiência do modelo**,
calculada a partir da taxa de vitória e da média de tentativas. Portanto, essa
métrica não é simplesmente o percentual de gerações concluídas.

O gráfico mostra o histórico real de fitness recebido pelo WebSocket. Ele não é
uma animação simulada no frontend.

## Build de produção

Para gerar o frontend:

```powershell
cd frontend
npm.cmd run build
```

Para visualizar o build localmente:

```powershell
npm.cmd run preview
```

## Solução de problemas

### API offline na interface

Confirme que a API está em execução na porta 8000:

```powershell
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

Depois abra ou recarregue o frontend na porta 5173.

### Porta 8000 ocupada

Encerre o processo que está usando a porta ou inicie a API em outra porta:

```powershell
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8001
```

Nesse caso, configure o frontend com a variável `VITE_API_URL` antes do build
ou da execução:

```powershell
$env:VITE_API_URL = "http://127.0.0.1:8001"
npm.cmd run dev
```

### Palavra recusada

Confirme se ela:

- possui o tamanho selecionado, cinco, seis ou sete letras;
- está escrita sem caracteres inválidos;
- aparece no arquivo correspondente ao tamanho: `words.txt`, `words6.txt` ou
  `words7.txt`.

A normalização remove acentos e converte letras maiúsculas para minúsculas,
mas a palavra ainda precisa existir no vocabulário carregado.

## Estado do projeto

O projeto está preparado para:

- jogar partidas manualmente;
- resolver uma palavra específica;
- avaliar uma amostra padrão de 100 palavras com cinco, seis ou sete letras;
- acompanhar gerações em tempo real;
- interromper o treinamento;
- consultar métricas reais;
- revisar os palpites produzidos pelo solver.

O vocabulário continua sendo uma aproximação derivada do `fserb/pt-br`, não
uma cópia da lista oficial de aceitação do Termo.
