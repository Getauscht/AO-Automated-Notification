---
name: context-forge
description: Use esta skill sempre que for implementar, corrigir ou revisar código neste projeto. Ela dá acesso à memória procedural do projeto (conhecimento consolidado, aprendizados ativos e decisões arquiteturais registradas em .contextforge/).
---

# Context Forge

## Quando usar

Sempre que o usuário pedir uma implementação, correção ou revisão neste projeto. Também quando o usuário disser algo como "não faça assim", "o padrão aqui é outro", ou "lembre disso".

## Antes de implementar

Chame a ferramenta MCP `context_forge_get_context` com uma descrição curta da tarefa. Aplique as regras retornadas antes de inventar um padrão novo.

## Quando o usuário corrigir uma abordagem

1. Identifique: o que estava errado, por que, o que fazer no lugar, onde a regra se aplica.
2. Chame `context_forge_search` para checar se já existe um aprendizado parecido.
3. Se for reutilizável e novo, chame `context_forge_propose_learning`.
4. Aplique a correção na tarefa atual imediatamente — a proposta de aprendizado é independente de você já ter corrigido o código.

## Regras de precisão

- Não proponha aprendizado para uma correção claramente pontual e específica daquela linha de código.
- Não prometa que uma regra foi salva antes de `propose_learning` retornar sucesso.
- Nunca edite arquivos dentro de `.contextforge/learnings/` ou `.contextforge/knowledge/` diretamente — sempre pela ferramenta MCP.
