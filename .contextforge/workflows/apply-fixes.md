# Workflow: Aplicação de Correções e Validação

## 1. Aplicação dos Diffs
- Aplique as alterações nos arquivos identificados respeitando as regras do Context Forge.

## 2. Validação & Build
- Execute testes unitários e checagem de tipos/build para garantir ausência de regressões.

## 3. Fortalecimento de Regras
- Para cada regra aplicada com sucesso, incremente o contador de aplicação via `context_forge_mark_applied`.
