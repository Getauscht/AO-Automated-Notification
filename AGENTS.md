<!-- context-forge:start -->
## Context Forge — Memória Procedural do Projeto

Antes de implementar qualquer mudança, obtenha o contexto relevante:

- Se você tem acesso a ferramentas MCP, chame `context_forge_get_context` com uma descrição curta da tarefa.
- Caso contrário, leia `.contextforge/context/ACTIVE_CONTEXT.md`.

Quando o usuário corrigir uma abordagem, avalie se a correção é uma regra reutilizável. Se for, chame `context_forge_propose_learning` (ou, sem MCP, siga `.contextforge/workflows/learn.md`). Nunca grave a regra diretamente em `.contextforge/knowledge/` — toda proposta passa por aprovação humana.

Ordem de precedência quando houver conflito: instrução explícita do usuário na tarefa atual > decisões em `.contextforge/decisions/` > `.contextforge/knowledge/` > aprendizados ativos em `.contextforge/learnings/` > padrões observados no código > suposições do agente.
<!-- context-forge:end -->
