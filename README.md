# Vigília · Monitor de vagas UERJ

Painel para uma instalação privada em VPS. A cada 15 minutos, consulta as turmas cadastradas no Aluno Online e envia alerta com texto e imagem **quando uma vaga abre**, incluindo a primeira consulta se a turma já estiver aberta. O fechamento atualiza o painel, mas não gera alerta. Não faz inscrição em disciplinas.

O sistema tem dois contêineres: o painel/agendador com SQLite e o serviço auxiliar que conecta o WhatsApp Web por QR Code. Conta de aluno e configuração de canais são cifradas em repouso. O painel possui um único token de administração e **não fornece isolamento entre administradores**: quem tem esse token administra todas as contas.

## Preparar a VPS

Instale Docker e Docker Compose. Na pasta do projeto, crie `.env` com três valores secretos diferentes. Gere os valores no servidor, por exemplo:

```sh
openssl rand -hex 32     # ADMIN_TOKEN
openssl rand -base64 32  # ENCRYPTION_KEY
openssl rand -hex 32     # BRIDGE_TOKEN
```

Crie `.env` na raiz:

```dotenv
ADMIN_TOKEN=COLE_O_PRIMEIRO_VALOR
ENCRYPTION_KEY=COLE_O_SEGUNDO_VALOR
BRIDGE_TOKEN=COLE_O_TERCEIRO_VALOR
```

Os tokens precisam ter pelo menos 32 caracteres; a chave deve conter 32 bytes em base64. Proteja o arquivo (`chmod 600 .env`) e mantenha uma cópia segura da chave: se ela for perdida ou alterada, os dados cifrados existentes não poderão ser lidos. Nunca publique `.env`.

```sh
docker compose up -d --build
docker compose logs -f
```

O painel escuta apenas em `127.0.0.1:3000` na VPS. Para acessá-lo de fora, configure um proxy reverso HTTPS autenticado no seu domínio apontando para `http://127.0.0.1:3000`, ou use um túnel SSH. Não exponha o painel em HTTP na internet: o token e as credenciais dos alunos atravessam a conexão. O serviço WhatsApp não publica porta para fora da rede interna do Compose.

Volumes Docker `dados` e `whatsapp_auth` preservam respectivamente o banco e a sessão WhatsApp entre reinícios. Faça backup protegido dos dois e da chave; a sessão contém credenciais que dão acesso ao WhatsApp vinculado. Execute somente uma instância do agendador e uma do serviço WhatsApp por volume: não há coordenação para múltiplas réplicas.

## Configurar no painel

1. Entre com `ADMIN_TOKEN`, cadastre uma ou mais contas de aluno com matrícula e senha e adicione as disciplinas pelo código (por exemplo `FEN03-05787`) e número da turma. Clique em **Rastrear agora** para consultar as turmas imediatamente; a rotina automática continua verificando a cada 15 minutos.
2. Em **Notificações**, escolha a conta de aluno e configure os destinos onde quer receber avisos. Cada destino recebe automaticamente notificações de todas as matérias monitoradas nessa conta:
   - **Discord:** crie um webhook no canal desejado e informe a URL. O botão **Testar** envia uma mensagem identificada como teste.
   - **Telefone:** instale o aplicativo ntfy, assine um tópico exclusivo e informe o mesmo tópico no painel. Um tópico público funciona como segredo: quem o conhece pode publicar e ler mensagens. A entrega depende do serviço e das permissões do celular.
   - **WhatsApp:** clique em **Conectar** e escaneie o QR Code em WhatsApp → Aparelhos conectados. Informe o número destinatário, incluindo DDI e DDD, somente dígitos. A sessão conectada é compartilhada pelos destinos desta instalação.
3. Use **Testar** em cada destino para conferir a entrega. A consulta manual pode ser iniciada a qualquer momento pelo botão **Rastrear agora**.

Ao atualizar uma instalação existente, os destinos ligados a uma turma são mantidos e vinculados à conta daquela turma. Destinos globais sem conta podem ser associados no painel. Ao cadastrar/vincular um destino, ele recebe um alerta inicial para as turmas atualmente abertas e verificadas sem erro.

O WhatsApp usa [Baileys](https://github.com/WhiskeySockets/Baileys), biblioteca comunitária não oficial que implementa o protocolo WhatsApp Web. A sessão pode ser desconectada e precisar de novo QR Code; o funcionamento pode mudar com alterações do WhatsApp. O contêiner precisa permanecer em execução. A confirmação de envio pelo serviço não garante entrega ou leitura no aparelho destinatário.

## Estado de validação

O fluxo de login e consulta da UERJ foi implementado a partir da interface observada, mas ainda não foi validado de ponta a ponta com credenciais reais no servidor. A geração do QR Code foi observada localmente sem vincular uma conta; envio real por WhatsApp, Discord e ntfy ainda precisa ser verificado na instalação. O Docker não foi executado neste ambiente porque o daemon não estava disponível. Não dependa dos alertas até testar os canais e confirmar uma consulta real.

Falhas de consulta preservam o último estado e aparecem no painel; notificações pendentes são retidas até uma observação bem-sucedida. Avisos de abertura que foram superados por fechamento são descartados. Falhas de entrega são repetidas com backoff de 15, 30, 60, 120 e 240 minutos, com limite de seis tentativas. Depois desse limite, a entrega fica marcada como `failed` para inspeção no painel, sem reenvio automático; o botão **Tentar novamente** permite liberar uma nova tentativa somente se a turma continuar com vaga e sem erro de consulta. Uma falha depois de o serviço destinatário aceitar a mensagem pode ocasionar duplicata: não há garantia de entrega exatamente uma vez. Os dados podem ficar desatualizados entre consultas. Uma mudança na página da UERJ pode exigir atualização da integração.

## Confiabilidade e atualizações

- O monitor processa até três contas em paralelo e reaproveita uma única autenticação/listagem da UERJ por conta em cada ciclo. Cada requisição da UERJ tem timeout de 15 s e a autenticação tem orçamento total de 45 s. Redirecionamentos só são seguidos para o mesmo domínio HTTPS.
- Os endpoints autenticados `GET /api/status` e `GET /api/deliveries` expõem, respectivamente, informações da última rodada e os últimos 50 registros de entrega (sem credenciais). O painel atualiza as informações automaticamente a cada 30 segundos enquanto está aberto e visível.
- O próximo agendamento informado pelo painel vem do agendador em execução, não de um contador calculado apenas pelo relógio do navegador. A rotina permanece a cada 15 minutos no servidor Node.js.
- Duplicatas de `conta + disciplina + turma` passam a ser rejeitadas. Em atualização de um banco antigo, registros duplicados existentes são consolidados usando a consulta mais recente e seu histórico de entregas é preservado, associado ao monitoramento mantido. **Faça backup do volume `dados` antes de atualizar.**
- O servidor valida `ENCRYPTION_KEY` na inicialização. Em troca de chave, dados anteriormente cifrados não podem ser recuperados sem a chave antiga.
- `Oferecidas > Ocupadas` sinaliza vaga numérica, **não confirmação de elegibilidade ou direito à inscrição**. Confirme prioridade, regras de matrícula e a disponibilidade atual no Aluno Online antes de agir.
- Para conferir as migrações, integrações simuladas e regressões, use `npm test`. O fluxo real da UERJ e os envios externos requerem verificação com uma conta autorizada e canais configurados.

## Desenvolvimento

Com Node.js 24 ou superior, `npm test` executa os testes. A aplicação usa `node:sqlite`; `bridge/` tem suas dependências e lockfile próprios. O contêiner principal não exige `npm install`. Para experimentar sem Docker, configure as mesmas variáveis, `DB_PATH`, `WHATSAPP_BRIDGE_URL` e inicie `node src/server.mjs` após criar a pasta do banco. O caminho de instalação suportado é Docker.
