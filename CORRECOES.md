## Hotfix — parser de turmas sem legenda (17/11/2026)

Corrigida a regressão que impedia consultas de disciplinas (por exemplo, `QUI07-03865`) quando a página da UERJ retornava duas tabelas sem `<caption>`. Agora o parser mantém a prioridade da tabela explicitamente rotulada como "Vagas Atualizadas da Turma", mas aceita uma única tabela sem legenda que contenha o cabeçalho `Tipo de Vaga / Oferecidas / Ocupadas` e a linha numérica `UERJ`. Uma tabela com outra legenda não é reinterpretada como vagas atualizadas; múltiplas candidatas sem legenda continuam sendo erro por ambiguidade. Foram adicionados testes de regressão para o HTML sem legendas e casos ambíguos.

# Correções da auditoria — Vigília / AO Automated Notification

Versão corrigida em 17/11/2026. A aplicação permanece em **Node.js + SQLite + Docker**;
**nenhuma migração para Cloudflare Workers** foi implementada.

## Correções incorporadas

- **Regras de vagas:** gera avisos somente na abertura (inclusive a primeira observação aberta), sem avisar o fechamento. Parser aceita a legenda "Vagas Atualizadas da Turma" quando presente e, na ausência dela, identifica uma única tabela pelo cabeçalho e linha UERJ; resultados ambíguos são rejeitados.
- **Fila confiável:** invalida alertas antigos após fechamento e mudança de destino; uma falha de consulta impede envio até observação válida; processa a fila ordenada por criação (até oito entregas em paralelo).
- **Falhas de notificação:** timeout de 15 segundos para Discord/ntfy, reenvio com espera de 15/30/60/120/240 minutos, limite de seis tentativas e situação `failed` visível no painel. O usuário pode solicitar nova tentativa em estado aberto válido.
- **Destinos adicionados posteriormente:** recebem a situação aberta conhecida, sem aguardar novo fechamento/abertura.
- **Consulta UERJ:** login/listagem reutilizados por conta em cada rodada, até três contas processadas em paralelo, timeout de 15 segundos por requisição e de 45 segundos para a autenticação, suporte a redirecionamentos apenas HTTPS no domínio oficial.
- **Banco:** índice único por conta/código da disciplina/número da turma, incluindo turmas com zeros à esquerda; consolidação de duplicatas existentes preservando histórico de entregas e escolhendo o monitoramento com consulta mais recente.
- **API:** valida JSON objeto, retorna HTTP 400 para `null`/array e 404 para conta inexistente; HTTP 409 para monitoramento duplicado. Novos endpoints autenticados: `GET /api/status`, `GET /api/deliveries`, `POST /api/deliveries/retry`.
- **Painel:** atualização a cada 30 segundos enquanto estiver visível, estado do agendador obtido do servidor, contadores e histórico de entregas, reenvio manual de notificações falhadas.
- **Configuração:** valida `ENCRYPTION_KEY` já no startup; cabeçalhos MIME do ntfy suportam acentuação em português.
- **Documentação:** processo de migração, política de retentativas e distinção entre vaga numérica e elegibilidade.

## Validação

```sh
npm test
```

A suíte contém 24 testes (12 originais + 12 novos) e passou também com Node.js 22.16.0, embora a implantação suportada use Node.js 24 no Docker. Foi realizado teste de inicialização HTTP e dos endpoints de status e entregas, incluindo rejeição de chave inválida.

## Atualização de uma instalação existente

1. Faça backup dos volumes de dados e da chave de criptografia.
2. Substitua os arquivos do projeto pelos desta versão.
3. Execute `docker compose up -d --build`.
4. Confira `docker compose logs -f painel` e a área "Saúde do monitor e entregas".
5. Valide o login real da UERJ e teste cada destino configurado.

A migração do SQLite é executada ao iniciar o processo principal. O arquivo `.env` **não** foi adicionado ao pacote.

## Limitações e riscos conhecidos

- O fluxo real de autenticação, leitura de vagas e os envios WhatsApp/Discord/ntfy **não foram testados com serviços externos autenticados**. A integração pode exigir atualização se o HTML ou o fluxo de login da UERJ mudar.
- O envio de mensagens não é transacional com serviços externos. Em caso de timeout após aceitação por um serviço, pode ocorrer notificação duplicada. A garantia de entrega exatamente uma vez não existe.
- O monitor deve ser executado como **uma instância** com um volume SQLite; não há coordenação distribuída para múltiplos processos do agendador.
- Em uma instalação com um número excepcionalmente alto de turmas/destinos, uma rodada ainda poderá ultrapassar 15 minutos. Os timeouts e a concorrência limitada reduzem esse risco, mas não fornecem prazo máximo absoluto por rodada.
- Uma vaga numérica não garante direito à inscrição; confirme regras acadêmicas no sistema oficial.
