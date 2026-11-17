# Workflow: Correção de Bugs (Bugfix)

## 1. Diagnóstico
- Identifique o comportamento incorreto e a causa-raiz.
- Consulte a memória procedural via `context_forge_search` para checar se já existe regra ou aprendizado sobre esse comportamento.

## 2. Correção
- Aplique a correção respeitando as regras estabelecidas.
- Garanta testes cobrindo a regressão.

## 3. Aprendizado
- Se o bug decorreu de um erro conceitual ou padrão que outros agentes podem cometer, proponha um novo aprendizado via `context_forge_propose_learning`.
