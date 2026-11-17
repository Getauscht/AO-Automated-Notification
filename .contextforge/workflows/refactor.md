# Workflow: Refatoração de Código

## 1. Verificação de Restrições
- Obtenha contexto com intensidade `deep` via `context_forge_get_context`.
- Verifique se a refatoração respeita as decisões arquiteturais (`ADR`).

## 2. Execução
- Preserve os contratos externos e execute os testes antes e após as alterações.
- Não introduza novas dependências estruturais sem antes consultar se há uma ADR contrária.
