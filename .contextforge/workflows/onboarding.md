# Workflow: Varredura Inicial e Onboarding de Codebase

## 1. Objetivo
Mapear toda a arquitetura, regras de negócio, convenções de código e restrições da codebase e registrá-las na memória do Context Forge.

## 2. Roteiro de Análise
1. **Arquitetura Geral:** Inspecione package.json, variáveis de ambiente e estrutura de pastas. Registre ADRs via `context_forge_record_decision`.
2. **Backend & APIs:** Inspecione rotas, controllers e serviços. Registre regras de validação, auth, tratamento de erros e transações via `context_forge_propose_learning`.
3. **Banco de Dados:** Inspecione schemas, migrations e relacionamentos. Registre regras de integridade e unicidade.
4. **Frontend:** Inspecione estado global, formulários e convenções visuais. Registre regras de validação cliente e estilização.

## 3. Conclusão
- Revise as propostas criadas no painel do Context Forge e aprove os aprendizados essenciais.
