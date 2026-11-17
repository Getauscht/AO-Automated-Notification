# Workflow: Auditoria de Código e Conformidade

## 1. Carregamento de Regras
- Obtenha o contexto procedural consolidado lendo `.contextforge/knowledge/` e `.contextforge/learnings/`.

## 2. Varredura da Codebase
- Compare o código real contra as regras consolidadas do Context Forge.
- Identifique desvios em: validações de entrada, middlewares de segurança/auth, formato de respostas HTTP, transações de banco e padrões de frontend.

## 3. Relatório de Inconsistências
Para cada desvio encontrado, apresente:
- **Regra Violada:** ID da regra ou seção de Knowledge
- **Arquivo & Linha:** `caminho/arquivo.ts:linha`
- **Problema:** Descrição do desvio
- **Gravidade:** Crítica | Média | Baixa
- **Diff Sugerido:** Código corrigido pronto para aplicação
